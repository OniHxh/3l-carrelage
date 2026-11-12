// Lecture du texte d'un PDF (devis) sans dépendance, dans le navigateur comme dans Node.
// Lecture « au mieux » : gère les flux compressés (FlateDecode), les flux d'objets et les tables
// ToUnicode des polices. Un PDF scanné (image) ne contient pas de texte : les montants se saisissent alors à la main.

const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };

async function inflate(u8) {
  for (const [fmt, skip] of [['deflate', 0], ['deflate-raw', 2]]) {
    try {
      const stream = new Blob([u8.subarray(skip)]).stream().pipeThrough(new DecompressionStream(fmt));
      const chunks = []; const reader = stream.getReader();
      // Lecture tolérante : on garde ce qui a été décompressé même si la fin du flux est abîmée
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); } } catch { if (!chunks.length) throw new Error('x'); }
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
      return out;
    } catch { /* format suivant */ }
  }
  return null;
}

/** Découpe le fichier en objets { dict, data } (data = flux décodé, en texte latin1). */
async function readObjects(bin, bytes) {
  const objs = new Map();
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let m;
  while ((m = re.exec(bin))) {
    const start = re.lastIndex;
    const end = bin.indexOf('endobj', start);
    if (end < 0) break;
    const body = bin.slice(start, end);
    const si = body.search(/\bstream\r?\n/);
    let dict = body, data = null;
    if (si >= 0) {
      dict = body.slice(0, si);
      let ds = start + si + 6;
      if (bin[ds] === '\r') ds++;
      if (bin[ds] === '\n') ds++;
      const de = bin.lastIndexOf('endstream', end);
      let raw = bytes.subarray(ds, de > ds ? de : end);
      if (/\/FlateDecode/.test(dict)) raw = (await inflate(raw)) || new Uint8Array();
      else if (/\/Filter/.test(dict)) raw = new Uint8Array(); // autres filtres (images…) : ignorés
      data = latin1(raw);
    }
    objs.set(Number(m[1]), { dict, data });
    re.lastIndex = end + 6;
  }
  // Objets rangés dans des flux d'objets (PDF 1.5+)
  for (const o of [...objs.values()]) {
    if (!o.data || !/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] || 0);
    const nums = o.data.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      const a = first + nums[i + 1], b = i + 3 < nums.length ? first + nums[i + 3] : o.data.length;
      if (!objs.has(nums[i])) objs.set(nums[i], { dict: o.data.slice(a, b), data: null });
    }
  }
  return objs;
}

const hexToBytes = (h) => { h = h.replace(/[^0-9a-f]/gi, ''); if (h.length % 2) h += '0'; let s = ''; for (let i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16)); return s; };
const utf16 = (bin) => { let s = ''; for (let i = 0; i + 1 < bin.length; i += 2) s += String.fromCharCode((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1)); return s; };

function parseCMap(text) {
  const map = new Map();
  let bytes = 1;
  const cs = /begincodespacerange\s*<([0-9a-f]+)>/i.exec(text);
  if (cs) bytes = Math.max(1, cs[1].length / 2);
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, src, dst] of blk[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) map.set(parseInt(src, 16), utf16(hexToBytes(dst)));
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, rest] of blk[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(\[[^\]]*\]|<[0-9a-f]*>)/gi)) {
      const a = parseInt(lo, 16), b = parseInt(hi, 16);
      if (rest.startsWith('[')) {
        [...rest.matchAll(/<([0-9a-f]*)>/gi)].forEach((d, i) => map.set(a + i, utf16(hexToBytes(d[1]))));
      } else {
        const base = hexToBytes(rest.slice(1, -1));
        for (let c = a; c <= b && c - a < 65536; c++) {
          const last = (base.charCodeAt(base.length - 2) << 8 | base.charCodeAt(base.length - 1)) + (c - a);
          map.set(c, utf16(base.slice(0, -2) + String.fromCharCode(last >> 8, last & 255)));
        }
      }
    }
  }
  return { map, bytes };
}

// Caractères WinAnsi différents du latin1 (les plus courants dans un devis)
const WINANSI = { 0x80: '€', 0x92: '’', 0x91: '‘', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—', 0x85: '…', 0x9c: 'œ', 0x8c: 'Œ', 0xa0: ' ' };

function decode(str, font) {
  if (font?.map?.size) {
    let out = '';
    for (let i = 0; i < str.length; i += font.bytes) {
      let code = 0;
      for (let k = 0; k < font.bytes; k++) code = (code << 8) | (str.charCodeAt(i + k) || 0);
      out += font.map.get(code) ?? '';
    }
    return out;
  }
  let out = '';
  for (const ch of str) { const c = ch.charCodeAt(0); out += WINANSI[c] ?? (c >= 32 || c === 9 ? ch : ''); }
  return out;
}

/** Lit les opérateurs de texte d'un flux de contenu et reconstitue des lignes. */
function contentText(src, fonts) {
  let out = '', i = 0, font = null;
  const stack = [];
  const n = src.length;
  const isWs = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';
  const readLiteral = () => {
    let depth = 1, s = ''; i++;
    while (i < n && depth) {
      const c = src[i];
      if (c === '\\') {
        const d = src[i + 1];
        if (/[0-7]/.test(d)) { let oct = ''; while (oct.length < 3 && /[0-7]/.test(src[i + 1])) { oct += src[i + 1]; i++; } s += String.fromCharCode(parseInt(oct, 8) & 255); i++; continue; }
        const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[d];
        if (d === '\r' || d === '\n') { i += 2; if (d === '\r' && src[i] === '\n') i++; continue; }
        s += esc ?? d; i += 2; continue;
      }
      if (c === '(') depth++;
      if (c === ')' && --depth === 0) { i++; break; }
      s += c; i++;
    }
    return { str: s };
  };
  const readHex = () => { const e = src.indexOf('>', i); const s = hexToBytes(src.slice(i + 1, e)); i = e + 1; return { str: s }; };
  let lastY = null;
  const nl = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  const sp = () => { if (out && !/[\s]$/.test(out)) out += ' '; };
  while (i < n) {
    const c = src[i];
    if (isWs(c)) { i++; continue; }
    if (c === '%') { while (i < n && src[i] !== '\n' && src[i] !== '\r') i++; continue; }
    if (c === '(') { stack.push(readLiteral()); continue; }
    if (c === '<' && src[i + 1] === '<') { // dictionnaire inline : ignoré
      let depth = 0;
      while (i < n) { if (src[i] === '<' && src[i + 1] === '<') { depth++; i += 2; } else if (src[i] === '>' && src[i + 1] === '>') { depth--; i += 2; if (!depth) break; } else i++; }
      continue;
    }
    if (c === '<') { stack.push(readHex()); continue; }
    if (c === '[') { stack.push({ arr: true, mark: true }); i++; continue; }
    if (c === ']') {
      const items = [];
      while (stack.length && !stack[stack.length - 1].mark) items.unshift(stack.pop());
      stack.pop(); stack.push({ items }); i++; continue;
    }
    if (c === '/') { let j = i + 1; while (j < n && !isWs(src[j]) && !'/[]()<>{}%'.includes(src[j])) j++; stack.push({ name: src.slice(i + 1, j) }); i = j; continue; }
    if (/[0-9+\-.]/.test(c)) { let j = i + 1; while (j < n && /[0-9.]/.test(src[j])) j++; stack.push({ num: parseFloat(src.slice(i, j)) }); i = j; continue; }
    // Opérateur
    let j = i; while (j < n && !isWs(src[j]) && !'/[]()<>{}%'.includes(src[j])) j++;
    const op = src.slice(i, j) || src[i]; i = Math.max(j, i + 1);
    const num = (k) => stack[stack.length - k]?.num ?? 0;
    switch (op) {
      case 'Tf': font = fonts.get(stack[stack.length - 2]?.name) || null; break;
      case 'Tj': case "'": case '"': if (op !== 'Tj') nl(); out += decode(stack[stack.length - 1]?.str || '', font); break;
      case 'TJ':
        for (const it of stack[stack.length - 1]?.items || []) {
          if (it.str != null) out += decode(it.str, font);
          else if (it.num != null && it.num < -180) sp();
        }
        break;
      // Déplacement sur la même ligne : souvent un simple crénage (les vrais espaces sont des glyphes)
      case 'Td': case 'TD': if (Math.abs(num(1)) > 0.5) nl(); break;
      case 'T*': nl(); break;
      case 'Tm': { const y = num(1); if (lastY != null && Math.abs(y - lastY) > 0.5) nl(); else sp(); lastY = y; break; }
      case 'ET': sp(); break;
      default: break;
    }
    stack.length = 0;
  }
  return out;
}

/** Texte brut d'un PDF (Uint8Array). Renvoie '' si rien de lisible. */
export async function pdfText(bytes) {
  const bin = latin1(bytes);
  if (!bin.startsWith('%PDF')) return '';
  const objs = await readObjects(bin, bytes);
  // Polices : nom de ressource (/F1) -> table ToUnicode
  const cmapOf = new Map();
  for (const [num, o] of objs) {
    const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(o.dict);
    if (tu && objs.get(Number(tu[1]))?.data) cmapOf.set(num, parseCMap(objs.get(Number(tu[1])).data));
  }
  const fonts = new Map();
  const addPairs = (txt) => { for (const [, name, ref] of txt.matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) if (!fonts.has(name) || cmapOf.has(Number(ref))) fonts.set(name, cmapOf.get(Number(ref)) || null); };
  for (const o of objs.values()) {
    for (const [, inner] of o.dict.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) addPairs(inner);
    for (const [, ref] of o.dict.matchAll(/\/Font\s+(\d+)\s+\d+\s+R/g)) addPairs(objs.get(Number(ref))?.dict || '');
  }
  let text = '';
  for (const o of objs.values()) {
    if (!o.data || !/BT[\s\S]*?(Tj|TJ)/.test(o.data) || /begincmap/.test(o.data)) continue;
    text += contentText(o.data, fonts) + '\n';
  }
  return text.replace(/[  ]/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

// ---------- Lecture des informations d'un devis ----------
const MONTANT = /(-?\d{1,3}(?:[  .]\d{3})+(?:,\d{1,2})?|-?\d+(?:[.,]\d{1,2})?)\s*(?:€|EUR|euros?)?/gi;

export function parseMontant(s) {
  let t = String(s).replace(/[  \s€]/g, '').replace(/EUR|euros?/i, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}(\.|$)/.test(t)) t = t.replace(/\./g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function montantApres(lines, re) {
  let found = null;
  lines.forEach((l, i) => {
    if (!re.test(l) || /remise|acompte|d[ée]j[àa]/i.test(l)) return;
    const after = l.slice(l.search(re));
    const nums = [...after.matchAll(MONTANT)].map((m) => parseMontant(m[1])).filter((v) => v != null && Math.abs(v) >= 1);
    const next = nums.length ? nums : [...(lines[i + 1] || '').matchAll(MONTANT)].map((m) => parseMontant(m[1])).filter((v) => v != null && Math.abs(v) >= 1);
    if (next.length) found = next[next.length - 1]; // la dernière occurrence du document est le total final
  });
  return found;
}

/** Extrait numéro, date, objet et montants d'un texte de devis. Les champs non trouvés valent null. */
export function lireDevis(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const all = lines.join('\n');
  const numero = /devis\s*(?:num[ée]ro|n\s*\S{0,2}|#)\s*[:.]?\s*([A-Z0-9][A-Z0-9\-\/_.]{1,})/i.exec(all)?.[1]
    || /\b(D[EV]{0,2}[-_ ]?\d{2,4}[-_/]\d{1,6})\b/i.exec(all)?.[1] || null;
  const dm = /(?:date|le|du)\s*:?\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/i.exec(all) || /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/.exec(all);
  let date = null;
  if (dm) { const y = dm[3].length === 2 ? '20' + dm[3] : dm[3]; date = `${y}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`; }
  const montantHT = montantApres(lines, /total\s*(?:g[ée]n[ée]ral\s*)?h\.?\s*t\.?|montant\s*(?:total\s*)?h\.?\s*t\.?|total\s+hors\s+tax/i);
  const montantTTC = montantApres(lines, /total\s*(?:g[ée]n[ée]ral\s*)?t\.?\s*t\.?\s*c|montant\s*(?:total\s*)?t\.?\s*t\.?\s*c|net\s+[àa]\s+payer|total\s+toutes\s+taxes/i);
  const objet = /objet\s*:?\s*(.{3,120})/i.exec(all)?.[1]?.trim() || null;
  return { numero, date, objet, montantHT, montantTTC };
}
