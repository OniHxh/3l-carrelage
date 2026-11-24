// Création de vrais fichiers PDF (dossier de chantier, devis) avec jsPDF, sans passer par l'impression.
// Le fichier est ensuite enregistré (Mac : Téléchargements) ou partagé (iPhone : « Enregistrer dans Fichiers », Mail…).
import { esc, icon } from './core.js';
import { modal, toast } from './ui.js';
import { getBlob } from './local.js';

const M = 14, PW = 210, PH = 297, W = PW - 2 * M, BAS = PH - 16;
const ROUGE = [217, 35, 50], NOIR = [23, 23, 23], GRIS = [85, 85, 85], GRIS_CLAIR = [226, 226, 226];
const PT = 0.3528; // 1 pt en mm

let chargement;
function jsPDFClass() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  chargement ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/jspdf.umd.min.js';
    s.onload = () => (window.jspdf?.jsPDF ? res(window.jspdf.jsPDF) : rej(new Error('Module PDF introuvable.')));
    s.onerror = () => { chargement = null; rej(new Error('Impossible de charger le module PDF (connexion ?).')); };
    document.head.append(s);
  });
  return chargement;
}

/** Texte compatible avec les polices standard du PDF (espaces insécables, flèches, cases…). */
export const clean = (t) => String(t ?? '')
  .replace(/[   ]/g, ' ').replace(/→/g, '->').replace(/☐/g, '[ ]').replace(/[‐-–]/g, '-').replace(/—/g, '-')
  .replace(/[^\n\x20-\x7e -ÿ€’‘“”…«»œŒ•]/g, '');

async function fichierEnDataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
async function decoder(src) {
  // Photo de l'appareil (api/blobs/<id>) : lue directement dans la base locale
  if (/^api\/blobs\//.test(src)) {
    const rec = await getBlob(src.slice('api/blobs/'.length)).catch(() => null);
    if (rec?.blob) return createImageBitmap(rec.blob);
  }
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
/** Image recadrée au format 4:3, compressée en JPEG (fichier léger). */
async function photo43(src, largeur = 1000) {
  let bmp, canvas;
  try {
    bmp = await decoder(src);
    const w = bmp.width, h = bmp.height;
    const r = 4 / 3;
    let sw = w, sh = h, sx = 0, sy = 0;
    if (w / h > r) { sw = h * r; sx = (w - sw) / 2; } else { sh = w / r; sy = (h - sh) / 2; }
    canvas = document.createElement('canvas');
    canvas.width = Math.min(largeur, Math.round(sw));
    canvas.height = Math.round(canvas.width / r);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch { return null; } finally {
    bmp?.close?.();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

/** Document PDF A4 avec une mise en page simple : en-tête, titres, tableaux, photos, signatures. */
export async function nouveauPdf(titreDoc) {
  const JsPDF = await jsPDFClass();
  const doc = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
  let y = M;
  const lh = (size) => size * PT * 1.32;
  const font = (size, style = 'normal', color = NOIR) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
  const page = () => { doc.addPage(); y = M; };
  const place = (h) => { if (y + h > BAS) page(); };
  const split = (t, w) => doc.splitTextToSize(clean(t), w);

  const w = {
    doc,
    get y() { return y; }, set y(v) { y = v; },
    place, page,
    espace(h = 4) { y += h; },

    async entete({ entreprise = {}, titre, ref, lignes = [] }) {
      doc.setFillColor(...ROUGE); doc.rect(M, 10, W, 1.2, 'F');
      let yg = 16;
      try {
        const logo = await fichierEnDataUrl('icons/logo.png');
        const p = doc.getImageProperties(logo);
        const lw = 30, lhh = (lw * p.height) / p.width;
        doc.addImage(logo, 'PNG', M, yg, lw, lhh); yg += lhh + 3;
      } catch { /* sans logo */ }
      font(10.5, 'bold'); doc.text(clean(entreprise.raisonSociale || '3L Carrelage') + (entreprise.formeJuridique ? ` - ${clean(entreprise.formeJuridique)}` : ''), M, yg + 3); yg += 4.5;
      font(8.5, 'normal', GRIS);
      for (const l of [entreprise.adresse, [entreprise.cp, entreprise.ville].filter(Boolean).join(' '), entreprise.tel && `Tél. ${entreprise.tel}`, entreprise.email, entreprise.siret && `SIRET ${entreprise.siret}`].filter(Boolean)) { doc.text(clean(l), M, yg + 3); yg += 3.8; }
      let yd = 22;
      font(19, 'bold'); doc.text(clean(titre), M + W, yd, { align: 'right' }); yd += 6.5;
      if (ref) { font(11, 'bold', ROUGE); doc.text(clean(ref), M + W, yd, { align: 'right' }); yd += 5; }
      font(9, 'normal', GRIS);
      for (const l of lignes.filter(Boolean)) { for (const s of split(l, 90)) { doc.text(s, M + W, yd, { align: 'right' }); yd += 4; } }
      y = Math.max(yg, yd) + 5;
    },

    /** Encadrés côte à côte : [{ label, lignes: [première en gras, …] }] */
    encadres(list) {
      const gap = 6, bw = (W - gap * (list.length - 1)) / list.length;
      const contenus = list.map((b) => b.lignes.filter(Boolean).map((l, i) => ({ t: split(l, bw - 8), gras: i === 0 })));
      const hauteur = Math.max(...contenus.map((c) => 9 + c.reduce((s, l) => s + l.t.length * lh(9.5), 0))) + 2;
      place(hauteur);
      list.forEach((b, i) => {
        const x = M + i * (bw + gap);
        doc.setDrawColor(...GRIS_CLAIR); doc.setLineWidth(0.3); doc.roundedRect(x, y, bw, hauteur, 2, 2, 'S');
        font(7, 'normal', [136, 136, 136]); doc.text(clean(b.label).toUpperCase(), x + 4, y + 5);
        let yy = y + 9.5;
        for (const l of contenus[i]) { font(9.5, l.gras ? 'bold' : 'normal'); for (const s of l.t) { doc.text(s, x + 4, yy); yy += lh(9.5); } }
      });
      y += hauteur + 6;
    },

    titre(t) {
      place(18); y += 3;
      font(12.5, 'bold'); doc.text(clean(t), M, y + 4); y += 6;
      doc.setDrawColor(...ROUGE); doc.setLineWidth(0.6); doc.line(M, y, M + W, y); y += 5;
    },
    sousTitre(t) { place(12); font(10, 'bold', [51, 51, 51]); doc.text(clean(t), M, y + 3.5); y += 6.5; },

    texte(t, { size = 9.5, style = 'normal', color = NOIR } = {}) {
      font(size, style, color);
      for (const s of split(t, W)) { place(lh(size)); doc.text(s, M, y + size * PT); y += lh(size); }
      y += 2;
    },

    /** Tableau. cols = [{ label, w (part de la largeur), align }], rows = [[cellule | { t, gras, color }]] */
    tableau(cols, rows, { entete = true, taille = 8.8 } = {}) {
      const tot = cols.reduce((s, c) => s + c.w, 0);
      const ws = cols.map((c) => (c.w / tot) * W);
      const pad = 2, l = lh(taille);
      const head = () => {
        if (!entete) return;
        doc.setFillColor(...NOIR); doc.rect(M, y, W, 7, 'F');
        font(8, 'bold', [255, 255, 255]);
        let x = M;
        cols.forEach((c, i) => { doc.text(clean(c.label), c.align === 'right' ? x + ws[i] - pad : x + pad, y + 4.7, { align: c.align === 'right' ? 'right' : 'left' }); x += ws[i]; });
        y += 7;
      };
      place(14); head();
      for (const row of rows) {
        const cells = row.map((c, i) => { const o = typeof c === 'object' && c !== null ? c : { t: c }; return { ...o, lines: split(o.t ?? '', ws[i] - 2 * pad) }; });
        const h = Math.max(...cells.map((c) => c.lines.length)) * l + 2 * pad + 0.6;
        if (y + h > BAS) { page(); head(); }
        let x = M;
        cells.forEach((c, i) => {
          font(taille, c.gras ? 'bold' : 'normal', c.color || NOIR);
          const right = cols[i].align === 'right';
          c.lines.forEach((s, k) => doc.text(s, right ? x + ws[i] - pad : x + pad, y + pad + taille * PT + k * l, { align: right ? 'right' : 'left' }));
          x += ws[i];
        });
        y += h;
        doc.setDrawColor(234, 234, 234); doc.setLineWidth(0.25); doc.line(M, y, M + W, y);
      }
      y += 5;
    },

    /** Bloc de totaux aligné à droite : [[libellé, valeur, fort?]] */
    totaux(lignes) {
      const x0 = M + W - 82;
      place(lignes.length * 7 + 6);
      for (const [lab, val, fort] of lignes) {
        if (fort) { doc.setDrawColor(...NOIR); doc.setLineWidth(0.6); doc.line(x0, y, M + W, y); y += 2; }
        font(fort ? 12.5 : 10, fort ? 'bold' : 'normal');
        doc.text(clean(lab), x0, y + 4.5); font(fort ? 12.5 : 10, 'bold'); doc.text(clean(val), M + W, y + 4.5, { align: 'right' });
        y += fort ? 8 : 6.5;
      }
      y += 4;
    },

    /** Photos en grille (recadrées 4:3) avec légende. items = [{ src, legende }] */
    async photos(items, parLigne = 2, onProgress) {
      const gap = 4, cw = (W - gap * (parLigne - 1)) / parLigne, ch = cw * 0.75, cap = 7;
      for (let i = 0; i < items.length; i += parLigne) {
        place(ch + cap);
        const ligne = items.slice(i, i + parLigne);
        for (const [k, it] of ligne.entries()) {
          const x = M + k * (cw + gap);
          const data = await photo43(it.src, parLigne <= 2 ? 1100 : 800);
          onProgress?.(i + k + 1);
          if (data) doc.addImage(data, 'JPEG', x, y, cw, ch, undefined, 'FAST');
          else { doc.setFillColor(242, 242, 242); doc.rect(x, y, cw, ch, 'F'); font(8, 'normal', GRIS); doc.text('Photo indisponible', x + cw / 2, y + ch / 2, { align: 'center' }); }
          font(7.5, 'normal', GRIS);
          doc.text(split(it.legende || '', cw).slice(0, 1), x, y + ch + 4);
        }
        y += ch + cap + 2;
      }
    },

    case(t) {
      place(7);
      doc.setDrawColor(...NOIR); doc.setLineWidth(0.3); doc.rect(M, y + 0.6, 3.6, 3.6);
      font(9.5); const s = split(t, W - 7);
      s.forEach((l, i) => doc.text(l, M + 6, y + 3.6 + i * lh(9.5)));
      y += s.length * lh(9.5) + 2.5;
    },
    lignesVides(n = 4) {
      place(n * 8 + 2); doc.setDrawColor(187, 187, 187); doc.setLineWidth(0.25);
      for (let i = 0; i < n; i++) { y += 8; doc.line(M, y, M + W, y); }
      y += 5;
    },
    signatures(labels) {
      const gap = 6, bw = (W - gap) / 2, h = 30;
      place(h + 4);
      labels.forEach((t, i) => {
        const x = M + i * (bw + gap);
        doc.setDrawColor(...GRIS_CLAIR); doc.setLineWidth(0.3); doc.roundedRect(x, y, bw, h, 2, 2, 'S');
        font(8.5, 'normal', GRIS); split(t, bw - 8).forEach((s, k) => doc.text(s, x + 4, y + 5.5 + k * lh(8.5)));
      });
      y += h + 4;
    },

    /** Numéros de page, puis fichier PDF (Blob). */
    fin() {
      const n = doc.getNumberOfPages();
      for (let i = 1; i <= n; i++) {
        doc.setPage(i); font(7.5, 'normal', [140, 140, 140]);
        doc.text(clean(`${titreDoc} - page ${i} / ${n}`), PW / 2, PH - 8, { align: 'center' });
      }
      return doc.output('blob');
    },
  };
  return w;
}

const nomFichier = (t) => `${clean(t).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'document'}.pdf`;

/** Propose le PDF : enregistrer / partager (iPhone) ou télécharger (Mac), et l'ouvrir. */
export function proposerPdf(blob, titre) {
  const nom = nomFichier(titre);
  const url = URL.createObjectURL(blob);
  const file = typeof File === 'function' ? new File([blob], nom, { type: 'application/pdf' }) : null;
  const tactile = matchMedia('(pointer: coarse)').matches;
  const partage = tactile && file && navigator.canShare?.({ files: [file] });
  const taille = blob.size > 1048576 ? `${(blob.size / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(blob.size / 1024))} Ko`;
  const m = modal({
    title: 'PDF prêt',
    body: `<div class="stack"><p style="margin:0"><b>${esc(nom)}</b> <span class="muted small">(${taille})</span></p>
      <p class="small muted" style="margin:0">${partage ? '« Enregistrer ou envoyer » ouvre le menu de partage : choisissez « Enregistrer dans Fichiers », Mail, WhatsApp…' : '« Télécharger » enregistre le fichier dans le dossier Téléchargements.'}</p></div>`,
    foot: `<a class="btn" href="${url}" target="_blank" rel="noopener">${icon('chevron')}Ouvrir</a><button class="btn primary" id="pdf-save">${icon('download')}${partage ? 'Enregistrer ou envoyer' : 'Télécharger'}</button>`,
    onClose: () => setTimeout(() => URL.revokeObjectURL(url), 60000),
  });
  m.el.querySelector('#pdf-save').addEventListener('click', async () => {
    if (partage) {
      try { await navigator.share({ files: [file], title: nom }); m.close(); return; }
      catch (e) { if (e?.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = url; a.download = nom; a.rel = 'noopener';
    document.body.append(a); a.click(); a.remove();
    toast('PDF téléchargé.');
  });
}

/** Petit écran d'attente pendant la création du PDF. */
export function attentePdf(texte = 'Création du PDF…') {
  const m = modal({ title: 'PDF', body: `<p style="margin:0" id="pdf-wait">${esc(texte)}</p>` });
  return { maj: (t) => { const el = m.el.querySelector('#pdf-wait'); if (el) el.textContent = t; }, close: m.close };
}
