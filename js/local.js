// « Serveur » local : remplace l'ancien serveur Node.js + SQLite.
// Toutes les données vivent dans IndexedDB sur l'appareil (base « 3l-local »).
// Les routes /api/... appelées par l'interface sont traitées ici, sans réseau :
// l'application démarre instantanément, même hors connexion.
// La copie entre appareils passe par la synchronisation chiffrée (voir cloud.js).
import { ROLES, MODULES } from '../shared/permissions.js';
import { num } from '../shared/calc.js';

const DB_NAME = '3l-local';
let dbp = null;
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };

export function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('records', { keyPath: 'id' });
      d.createObjectStore('blobs', { keyPath: 'id' });
      d.createObjectStore('audit', { keyPath: 'id' });
      d.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
const P = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function os(name, mode = 'readonly') { return (await openDb()).transaction(name, mode).objectStore(name); }
const getOne = async (s, k) => P((await os(s)).get(k));
const getAll = async (s) => P((await os(s)).getAll());
const put = async (s, v, k) => P(k === undefined ? (await os(s, 'readwrite')).put(v) : (await os(s, 'readwrite')).put(v, k));
const meta = (k) => getOne('meta', k);
const setMeta = (k, v) => put('meta', v, k);

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
let lastNow = 0;
const now = () => { const t = Math.max(Date.now(), lastNow + 1); lastNow = t; return t; }; // strictement croissant
const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// ---------- Utilisateur de l'appareil ----------
// Plus de comptes ni de mot de passe : l'application appartient à une seule personne (administrateur).
// La liste `users` garde les anciens comptes pour que les fiches existantes affichent toujours le bon nom.
export async function users() { return (await meta('users')) || []; }
export async function owner() {
  const id = await meta('owner');
  const list = await users();
  return list.find((u) => u.id === id) || list[0] || null;
}
export async function ensureOwner(name = 'Administrateur') {
  const cur = await owner();
  if (cur) return cur;
  const u = { id: uid(), name, email: '', role: 'admin', permissions: {}, profile: { couleur: '#171717', fonction: 'Gestion' }, active: true };
  await setMeta('users', [u]); await setMeta('owner', u.id);
  return u;
}
const publicUser = (u) => ({ ...u, role: u.role || 'admin', roleLabel: ROLES[u.role || 'admin']?.label || 'Administrateur', profile: u.profile || {}, permissions: u.permissions || {}, active: u.active !== false });
async function me() {
  const u = await owner();
  if (!u) throw err(401, 'Aucun utilisateur.');
  // L'utilisateur de l'appareil a tous les droits.
  return { ...publicUser(u), role: 'admin', roleLabel: 'Administrateur', permissions: {} };
}
export const isEmpty = async () => !(await owner());

// ---------- Fiches ----------
export const getRecord = (id) => getOne('records', id);
async function nextCounter(name) {
  const c = (await meta('counters')) || {};
  c[name] = (c[name] || 0) + 1;
  await setMeta('counters', c);
  return c[name];
}

const LABELS = {
  chantier: (d) => d.nom || d.ref, client: (d) => d.nom, tache: (d) => d.titre,
  evenement: (d) => d.titre, pointage: (d) => `${num(d.heures)} h le ${d.date}`, photo: (d) => d.legende || 'Photo',
  note: (d) => (d.texte || '').slice(0, 60), parametres: () => 'Paramètres',
  devis: (d) => `Devis ${d.numero || d.nomFichier || ''}`.trim(), membre: (d) => d.name, visite: (d) => `Visite ${d.client || ''}`.trim(),
};
const labelOf = (type, d) => (LABELS[type] ? LABELS[type](d) : type) || type;

function diffObjects(before, after) {
  if (!before) return null;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)].filter((k) => !k.startsWith('_') && k !== 'dataUrl'));
  const d = {};
  for (const k of keys) {
    const a = JSON.stringify(before[k] ?? null), b = JSON.stringify(after[k] ?? null);
    if (a !== b) d[k] = { avant: a.length > 200 ? '…' : before[k] ?? null, apres: b.length > 200 ? '…' : after[k] ?? null };
  }
  return Object.keys(d).length ? d : null;
}

async function audit({ user, action, type, id, summary, diff, via }) {
  await put('audit', { id: uid(), ts: now(), user_id: user?.id || null, user_name: user?.name || null, action, entity_type: type || null, entity_id: id || null, summary: summary || null, diff: diff || null, via: via || null });
}

// Fichiers (photos, devis) : stockés à part, servis par le service worker sous api/blobs/<id>.
export function dataUrlToBlob(dataUrl) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  const bin = atob(m[2]); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], blob: new Blob([bytes], { type: m[1] }) };
}
export const blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

async function storeDataUrl(dataUrl, { pdf = false } = {}) {
  const b = dataUrlToBlob(dataUrl);
  if (!b) throw err(400, 'Fichier invalide.');
  const isPdf = b.mime === 'application/pdf';
  if (!/^image\/(jpeg|png|webp)$/.test(b.mime) && !(pdf && isPdf)) throw err(400, pdf ? 'Format non accepté (PDF ou photo).' : 'Format d’image non accepté.');
  const max = isPdf ? 12 : 6;
  if (b.blob.size > max * 1024 * 1024) throw err(413, `Fichier trop lourd (${max} Mo max).`);
  const id = uid();
  await put('blobs', { id, mime: b.mime, blob: b.blob, createdAt: Date.now() });
  return id;
}
export const getBlob = (id) => getOne('blobs', id);
export const putBlob = (rec) => put('blobs', rec);
export const blobIds = async () => P((await os('blobs')).getAllKeys());

async function beforeWrite(type, data, prev = {}) {
  const d = { ...data };
  if (type === 'photo' && d.dataUrl) { d.blobId = await storeDataUrl(d.dataUrl); delete d.dataUrl; }
  if (type === 'devis' && d.dataUrl) { d.mime = /^data:([^;]+)/.exec(d.dataUrl)?.[1]; d.blobId = await storeDataUrl(d.dataUrl, { pdf: true }); delete d.dataUrl; }
  if (type === 'devis') { d.montantHT = d.montantHT == null || d.montantHT === '' ? null : num(d.montantHT); d.montantTTC = d.montantTTC == null || d.montantTTC === '' ? null : num(d.montantTTC); }
  const year = new Date().getFullYear();
  if (type === 'chantier' && !d.ref) d.ref = prev.ref || `CH-${year}-${String(await nextCounter(`chantier-${year}`)).padStart(3, '0')}`;
  if (type === 'pointage') d.heures = num(d.heures);
  if (type === 'chantier') d.avancement = Math.min(100, Math.max(0, num(d.avancement)));
  return d;
}
const stripMeta = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_') && k !== 'id' && k !== 'type'));

export async function saveRecord({ type, id, data, baseVersion, via = 'app' }) {
  const user = await me();
  id ||= uid();
  const before = await getRecord(id);
  if (before && before.type !== type) throw err(400, 'Type incohérent.');
  if (before && !before._deleted && baseVersion != null && Number(baseVersion) !== before._v) {
    throw err(409, 'Cette fiche a été modifiée entre-temps sur un autre appareil.', { current: before });
  }
  const prevLive = before && !before._deleted ? before : null;
  const clean = stripMeta(await beforeWrite(type, data || {}, prevLive || {}));
  const t = now();
  const record = {
    id, type, ...clean,
    _v: (before?._v || 0) + 1, _createdAt: before?._createdAt || t, _createdBy: before?._createdBy || user.id,
    _updatedAt: t, _updatedBy: user.id, _deleted: 0, _seq: t,
  };
  await put('records', record);
  const diff = diffObjects(before, record);
  if (!before || diff) await audit({ user, action: before ? 'update' : 'create', type, id, summary: labelOf(type, record), diff, via });
  changed();
  return { record, extra: [] };
}

export async function removeRecord({ id, baseVersion, via = 'app' }) {
  const user = await me();
  const rec = await getRecord(id);
  if (!rec) throw err(404, 'Introuvable.');
  if (baseVersion != null && Number(baseVersion) !== rec._v) throw err(409, 'Conflit de version', { current: rec });
  const t = now();
  const next = { ...rec, _deleted: 1, _v: rec._v + 1, _updatedAt: t, _updatedBy: user.id, _seq: t };
  await put('records', next);
  await audit({ user, action: 'delete', type: rec.type, id, summary: labelOf(rec.type, rec), via });
  changed();
  return next;
}

// ---------- Export / import / fusion ----------
export async function snapshot({ withBlobs = false, auditLimit = 0 } = {}) {
  let auditRows = (await getAll('audit')).sort((a, b) => b.ts - a.ts);
  if (auditLimit) auditRows = auditRows.slice(0, auditLimit);
  const out = {
    format: '3l-carrelage', version: 1, exportedAt: new Date().toISOString(),
    owner: await meta('owner'), users: await users(), counters: (await meta('counters')) || {},
    records: (await getAll('records')).map(({ _seq, ...r }) => r), audit: auditRows,
  };
  if (withBlobs) out.blobs = await Promise.all((await getAll('blobs')).map(async (b) => ({ id: b.id, mime: b.mime, dataUrl: await blobToDataUrl(b.blob) })));
  return out;
}

/**
 * Fusionne des données (fichier d'export ou copie en ligne) avec celles de l'appareil.
 * Rien n'est jamais effacé : pour chaque fiche, la version modifiée le plus récemment l'emporte.
 * Renvoie le nombre de fiches et fichiers ajoutés ou mis à jour.
 */
export async function merge(data, { takeOwner = false } = {}) {
  if (!data || data.format !== '3l-carrelage' || !Array.isArray(data.records)) throw err(400, 'Ce fichier n’est pas un export 3L Carrelage.');
  let n = 0;
  const local = new Map((await getAll('records')).map((r) => [r.id, r]));
  const writes = [];
  for (const r of data.records) {
    if (!r?.id || !r.type) continue;
    const cur = local.get(r.id);
    const newer = !cur || (r._updatedAt || 0) > (cur._updatedAt || 0) || ((r._updatedAt || 0) === (cur._updatedAt || 0) && (r._v || 0) > (cur._v || 0));
    if (!newer) continue;
    const { _seq, ...clean } = r;
    writes.push({ ...clean, _v: Math.max(r._v || 1, (cur?._v || 0) + 1), _seq: now() });
  }
  if (writes.length) {
    const tx = (await openDb()).transaction('records', 'readwrite');
    for (const w of writes) tx.objectStore('records').put(w);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    n += writes.length;
  }
  // Journal : union
  const have = new Set(await P((await os('audit')).getAllKeys()));
  for (const a of data.audit || []) if (a?.id != null && !have.has(String(a.id))) await put('audit', { ...a, id: String(a.id) });
  // Compteurs : on garde le plus grand (numérotation des chantiers)
  const c = (await meta('counters')) || {};
  let cc = false;
  for (const [k, v] of Object.entries(data.counters || {})) if ((c[k] || 0) < v) { c[k] = v; cc = true; }
  if (cc) await setMeta('counters', c);
  // Comptes connus
  const us = await users();
  for (const u of data.users || []) {
    const i = us.findIndex((x) => x.id === u.id);
    if (i < 0) us.push(u); else if ((u.updatedAt || 0) > (us[i].updatedAt || 0)) us[i] = { ...us[i], ...u };
  }
  await setMeta('users', us);
  if ((takeOwner || !(await meta('owner'))) && data.owner && us.some((u) => u.id === data.owner)) await setMeta('owner', data.owner);
  if (!(await meta('owner')) && us[0]) await setMeta('owner', us[0].id);
  // Fichiers
  const known = new Set(await blobIds());
  for (const b of data.blobs || []) {
    if (known.has(b.id)) continue;
    const x = dataUrlToBlob(b.dataUrl);
    if (x) { await putBlob({ id: b.id, mime: b.mime || x.mime, blob: x.blob, createdAt: Date.now() }); n++; }
  }
  if (n || cc) changed();
  return n;
}

// ---------- Routes /api ----------
export async function handle(path, method, body) {
  const url = new URL(path, 'http://x');
  const p = url.pathname, q = url.searchParams;
  if (p === '/me' && method === 'GET') return { user: await me(), roles: ROLES, modules: MODULES };
  if (p === '/me' && method === 'PUT') {
    const us = await users(); const id = await meta('owner');
    const i = us.findIndex((u) => u.id === id);
    if (i < 0) throw err(404, 'Utilisateur introuvable.');
    us[i] = { ...us[i], name: (body.name || us[i].name).trim(), profile: { ...us[i].profile, ...(body.profile || {}) }, updatedAt: Date.now() };
    await setMeta('users', us); changed();
    return { user: await me() };
  }
  if (p === '/sync' && method === 'GET') {
    const since = Number(q.get('since') || 0);
    const serverTime = now();
    const records = (await getAll('records')).filter((r) => (r._seq || r._updatedAt || 0) > since).map(({ _seq, ...r }) => r);
    const list = (await users()).map(publicUser).map((u) => ({ id: u.id, name: u.name, role: u.role, roleLabel: u.roleLabel, active: u.active, profile: { couleur: u.profile.couleur, tel: u.profile.tel, competences: u.profile.competences } }));
    return { records, users: list, serverTime: serverTime + 1000 };
  }
  if (p === '/batch' && method === 'POST') {
    const results = [];
    for (const op of body.ops || []) {
      try {
        if (op.op === 'delete') results.push({ opId: op.opId, ok: true, record: await removeRecord({ id: op.id, baseVersion: op.baseVersion }) });
        else { const r = await saveRecord({ type: op.type, id: op.id, data: op.data, baseVersion: op.baseVersion, via: op.offline ? 'hors-ligne' : 'app' }); results.push({ opId: op.opId, ok: true, record: r.record, extra: r.extra }); }
      } catch (e) { results.push({ opId: op.opId, ok: false, status: e.status || 500, error: e.message, current: e.current }); }
    }
    return { results };
  }
  let m;
  if ((m = p.match(/^\/records\/(\w+)\/([\w-]+)$/)) && method === 'GET') {
    const r = await getRecord(m[2]);
    if (!r) throw err(404, 'Introuvable.');
    return { record: r };
  }
  if (p === '/audit' && method === 'GET') {
    const type = q.get('type'), id = q.get('id'), u = q.get('user');
    const limit = Math.min(500, Number(q.get('limit') || 200));
    const entries = (await getAll('audit')).filter((e) => (!type || e.entity_type === type) && (!id || e.entity_id === id) && (!u || e.user_id === u)).sort((a, b) => b.ts - a.ts).slice(0, limit);
    return { entries };
  }
  if (p === '/users' && method === 'GET') return { users: (await users()).map(publicUser) };
  throw err(404, 'Fonction indisponible dans cette version.');
}
