// Composants d'interface : notifications, fenêtres, formulaires, photos.
import { esc, icon, qs, qsa } from './core.js';

export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${kind === 'error' ? icon('alert') : icon('check')}<span>${esc(msg)}</span>`;
  qs('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; }, kind === 'error' ? 5000 : 2600);
  setTimeout(() => el.remove(), kind === 'error' ? 5400 : 3000);
}
export const toastError = (e) => toast(e?.message || String(e), 'error');

/** Ouvre une fenêtre. `body` : HTML. Retourne { el, close }. */
export function modal({ title, body, foot = '', wide = false, onClose }) {
  const root = qs('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost icon-only sm" data-close aria-label="Fermer">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
  </div>`;
  root.append(wrap);
  document.body.style.overflow = 'hidden';
  const close = () => {
    wrap.remove();
    if (!root.children.length) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && root.lastElementChild === wrap) close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  qsa('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
  setTimeout(() => qs('input:not([type=hidden]):not([type=checkbox]), textarea, select', wrap)?.focus({ preventScroll: true }), 60);
  return { el: wrap, close };
}

export function confirmDialog(message, { title = 'Confirmer', ok = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, body: `<p style="margin:0">${esc(message)}</p>`,
      foot: `<button class="btn" data-close>Annuler</button><button class="btn ${danger ? 'primary' : 'dark'}" data-ok>${esc(ok)}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    qs('[data-ok]', m.el).addEventListener('click', () => { done = true; m.close(); resolve(true); });
  });
}

// ---------- Formulaires ----------
export const options = (list, selected, { empty } = {}) =>
  (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
  list.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
  }).join('');

export function fieldHtml(f, data = {}) {
  const v = data[f.name] ?? f.default ?? '';
  const id = `f-${f.name}`;
  const common = `id="${id}" name="${esc(f.name)}" ${f.required ? 'required' : ''} ${f.readonly ? 'readonly' : ''}`;
  let input;
  switch (f.type) {
    case 'select': input = `<select class="input" ${common}>${options(f.options || [], v, { empty: f.empty })}</select>`; break;
    case 'textarea': input = `<textarea class="input" ${common} rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`; break;
    case 'checkbox': return `<label class="check ${f.full ? 'full' : ''}"><input type="checkbox" ${common} ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    case 'range': input = `<div class="row"><input type="range" ${common} min="${f.min ?? 0}" max="${f.max ?? 100}" step="${f.step ?? 5}" value="${esc(v || 0)}" data-range-out><b class="num" style="width:48px;text-align:right">${esc(v || 0)} %</b></div>`; break;
    case 'number': input = `<input class="input" type="number" inputmode="decimal" step="${f.step ?? 'any'}" ${f.min != null ? `min="${f.min}"` : ''} ${common} value="${esc(v)}" placeholder="${esc(f.placeholder || '')}">`; break;
    default: input = `<input class="input" type="${f.type || 'text'}" ${common} value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" ${f.type === 'tel' ? 'inputmode="tel" autocomplete="tel"' : ''} ${f.type === 'email' ? 'autocomplete="email"' : ''} ${f.list ? `list="${id}-list"` : ''}>${f.list ? `<datalist id="${id}-list">${f.list.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`;
  }
  return `<label class="field ${f.full ? 'full' : ''}" for="${id}"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}${f.help ? `<small>${esc(f.help)}</small>` : ''}</label>`;
}

export function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') out[f.name] = el.checked;
    else if (f.type === 'number' || f.type === 'range') out[f.name] = el.value === '' ? null : Number(el.value);
    else out[f.name] = el.value.trim();
  }
  return out;
}

/** Fenêtre de formulaire standard. onSubmit(values) peut être asynchrone ; une exception affiche l'erreur. */
export function formModal({ title, fields, data = {}, submit = 'Enregistrer', onSubmit, onDelete, wide, extra = '' }) {
  const m = modal({
    title, wide,
    body: `<form class="form" novalidate>${fields.map((f) => fieldHtml(f, data)).join('')}${extra}<button type="submit" hidden></button></form>`,
    foot: `${onDelete ? `<button class="btn ghost danger left" data-del>${icon('trash')}<span>Supprimer</span></button>` : ''}<button class="btn" data-close>Annuler</button><button class="btn primary" data-save>${esc(submit)}</button>`,
  });
  const form = qs('form', m.el);
  const go = async () => {
    for (const f of fields) {
      const el = form.elements[f.name];
      if (f.required && el && !String(el.value).trim()) { el.focus(); toast(`« ${f.label} » est obligatoire.`, 'error'); return; }
    }
    const btn = qs('[data-save]', m.el); btn.disabled = true;
    try { await onSubmit(readForm(form, fields), form); m.close(); }
    catch (e) { toastError(e); }
    finally { btn.disabled = false; }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); go(); });
  qs('[data-save]', m.el).addEventListener('click', go);
  qs('[data-del]', m.el)?.addEventListener('click', async () => {
    if (await confirmDialog('Supprimer définitivement cet élément ? Il restera visible dans le journal d’activité.', { danger: true, ok: 'Supprimer' })) {
      try { await onDelete(); m.close(); } catch (e) { toastError(e); }
    }
  });
  return m;
}

// ---------- Photos ----------
/** Ouvre l'appareil photo (mobile) ou le sélecteur de fichiers et renvoie des images compressées en JPEG. */
export function pickImages({ multiple = true, capture = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = multiple;
    if (capture && matchMedia('(pointer: coarse)').matches && !multiple) input.capture = 'environment';
    // Champ placé dans la page : Safari peut sinon le perdre pendant le choix des photos
    input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
    document.body.append(input);
    const done = (out) => { input.remove(); resolve(out); };
    input.addEventListener('cancel', () => done([]));
    input.onchange = async () => {
      const files = [...input.files];
      const out = [];
      let ko = 0;
      if (files.length > 2) toast(`Préparation de ${files.length} photos…`);
      for (const f of files) {
        try { out.push(await compressImage(f)); } catch (e) { ko++; console.warn(e); }
        await new Promise((r) => setTimeout(r, 0)); // laisse le navigateur libérer la mémoire entre deux photos
      }
      if (ko) toast(`${ko} photo(s) sur ${files.length} n’ont pas pu être lues. Réessayez-les séparément.`, 'error');
      done(out);
    };
    input.click();
  });
}

/** Charge une image (photo iPhone comprise) pour la dessiner. Renvoie { src, w, h, release }. */
async function decodeImage(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (bmp) return { src: bmp, w: bmp.width, h: bmp.height, release: () => bmp.close?.() };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Image illisible.')); i.src = url; });
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

export async function compressImage(file, max = 1600, quality = 0.78) {
  const { src, w, h, release } = await decodeImage(file);
  const c = document.createElement('canvas');
  try {
    if (!w || !h) throw new Error('Image illisible.');
    const scale = Math.min(1, max / Math.max(w, h));
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/jpeg', quality);
    if (!out || out.length < 1000) throw new Error('Photo trop lourde pour l’appareil. Réessayez-la seule.');
    return out;
  } finally {
    // Libère tout de suite la mémoire : Safari sur iPhone bloque après quelques photos sinon
    release();
    c.width = 0; c.height = 0;
  }
}

export const photoSrc = (p) => p.dataUrl || (p.blobId ? `api/blobs/${p.blobId}` : '');

export function lightbox(src, caption = '') {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = `<div><img src="${esc(src)}" alt=""><div class="cap">${esc(caption)}</div></div>`;
  el.addEventListener('click', () => el.remove());
  document.body.append(el);
}

