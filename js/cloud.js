// Synchronisation chiffrée entre appareils (même principe que l'application Plan).
// - Copie stockée dans un Gist GitHub privé, chiffrée de bout en bout : PBKDF2 (250 000 itérations) + AES-GCM 256.
// - La clé GitHub (case « gist » uniquement) est créée par l'utilisateur lui-même ; clé et phrase secrète restent
//   dans le localStorage de l'appareil (« 3l-sync ») et ne sont jamais exportées.
// - Fichier principal « 3l-carrelage.json » : fiches, journal, compteurs. Les photos et devis partent dans des
//   paquets « f-….json » envoyés une seule fois (fichiers immuables).
// - Fusion fiche par fiche : la modification la plus récente l'emporte. Rien n'est effacé, un appareil vide
//   ne peut donc jamais écraser la copie en ligne.
import * as local from './local.js';

const KEY = '3l-sync';
const MAIN = '3l-carrelage.json';
const API = 'https://api.github.com';
const PACK_MAX = 3 * 1024 * 1024;

let cfg = null;
try { cfg = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
const saveCfg = () => { try { cfg ? localStorage.setItem(KEY, JSON.stringify(cfg)) : localStorage.removeItem(KEY); } catch {} };

export const state = { busy: false, error: null, last: 0 };
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(); } catch {} });
let onPulled = () => {};
export const setOnPulled = (fn) => { onPulled = fn; };

export const enabled = () => !!cfg?.gistId;
export const info = () => cfg ? { since: cfg.syncedAt || 0, gistId: cfg.gistId } : null;
/** Clé déjà enregistrée par l'application Plan sur ce même site (même origine), proposée pour éviter d'en recréer une. */
export function planToken() { try { return JSON.parse(localStorage.getItem('plan-sync') || 'null')?.token || ''; } catch { return ''; } }

// ---------- Chiffrement ----------
const b64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const keys = new Map();
async function kdf(pass, salt) {
  const id = b64(salt);
  if (!keys.has(id)) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    keys.set(id, await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  }
  return keys.get(id);
}
let salt = null; // un sel par Gist, réutilisé pour ne dériver la clé qu'une fois
async function enc(obj, pass) {
  salt ||= crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await kdf(pass, salt), new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function dec(p, pass) {
  let pt;
  try { pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv) }, await kdf(pass, unb64(p.salt)), unb64(p.ct)); }
  catch { throw new Error('Phrase secrète incorrecte.'); }
  salt ||= unb64(p.salt);
  return JSON.parse(new TextDecoder().decode(pt));
}

// ---------- GitHub ----------
async function gh(path, opts = {}, token = cfg?.token) {
  let r;
  try {
    r = await fetch(API + path, { ...opts, cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch { throw new Error('Pas de connexion.'); }
  if (r.status === 401 || r.status === 403) throw new Error('Clé GitHub invalide, expirée ou sans la case « gist ».');
  if (!r.ok) throw new Error(`GitHub a répondu ${r.status}.`);
  return r.status === 204 ? null : r.json();
}
async function fileText(f) {
  if (!f) return null;
  if (!f.truncated && f.content != null) return f.content;
  const r = await fetch(f.raw_url, { cache: 'no-store' });
  if (!r.ok) throw new Error('Lecture de la copie en ligne impossible.');
  return r.text();
}
async function findGist(token) {
  for (let pg = 1; pg <= 5; pg++) {
    const l = await gh(`/gists?per_page=100&page=${pg}`, {}, token);
    const g = l.find((x) => x.files?.[MAIN]);
    if (g) return g.id;
    if (l.length < 100) break;
  }
  return null;
}

// ---------- Synchronisation ----------
const fileIds = (recs) => new Set(recs.filter((r) => !r._deleted && r.blobId && (r.type === 'photo' || r.type === 'devis')).map((r) => r.blobId));

async function pullBlobs(gist, packs, pass) {
  const have = new Set(await local.blobIds());
  const need = [...fileIds((await local.snapshot()).records)].filter((id) => !have.has(id) && packs[id]);
  const byPack = {};
  for (const id of need) (byPack[packs[id]] ||= []).push(id);
  let n = 0;
  for (const [name, ids] of Object.entries(byPack)) {
    const text = await fileText(gist.files?.[name]);
    if (!text) continue;
    const list = await dec(JSON.parse(text), pass);
    for (const b of list) {
      if (!ids.includes(b.id)) continue;
      const x = local.dataUrlToBlob(b.dataUrl);
      if (x) { await local.putBlob({ id: b.id, mime: b.mime || x.mime, blob: x.blob, createdAt: Date.now() }); n++; }
    }
  }
  return n;
}

function needsPush(snap, remote) {
  if (!remote) return true;
  const rm = new Map((remote.data.records || []).map((r) => [r.id, r._updatedAt || 0]));
  if (snap.records.some((r) => (r._updatedAt || 0) > (rm.get(r.id) ?? -1))) return true;
  if (JSON.stringify(snap.users) !== JSON.stringify(remote.data.users)) return true;
  if (JSON.stringify(snap.counters) !== JSON.stringify(remote.data.counters)) return true;
  const ra = new Set((remote.data.audit || []).map((a) => a.id));
  return snap.audit.some((a) => !ra.has(a.id));
}

async function run() {
  const gist = await gh(`/gists/${cfg.gistId}`);
  const mainText = await fileText(gist.files?.[MAIN]);
  const parsed = mainText ? JSON.parse(mainText) : null;
  const remote = parsed?.ct ? await dec(parsed, cfg.pass) : null;
  let pulled = 0;
  if (remote) {
    pulled += await local.merge(remote.data);
    pulled += await pullBlobs(gist, remote.packs || {}, cfg.pass);
  }
  const snap = await local.snapshot({ auditLimit: 1500 });
  const packs = { ...(remote?.packs || {}) };
  const missing = (await local.blobIds()).filter((id) => !packs[id]);
  if (missing.length || needsPush(snap, remote)) {
    // 1. Fichiers pas encore en ligne, par paquets d'environ 3 Mo
    let pack = [], size = 0;
    const flush = async () => {
      if (!pack.length) return;
      const name = `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.json`;
      await gh(`/gists/${cfg.gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { [name]: { content: JSON.stringify(await enc(pack, cfg.pass)) } } }) });
      for (const b of pack) packs[b.id] = name;
      pack = []; size = 0;
    };
    for (const id of missing) {
      const b = await local.getBlob(id);
      if (!b) continue;
      const dataUrl = await local.blobToDataUrl(b.blob);
      if (size + dataUrl.length > PACK_MAX) await flush();
      pack.push({ id, mime: b.mime, dataUrl }); size += dataUrl.length;
    }
    await flush();
    // 2. Fiches
    await gh(`/gists/${cfg.gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { [MAIN]: { content: JSON.stringify(await enc({ data: snap, packs, by: navigator.userAgent.slice(0, 80), at: Date.now() }, cfg.pass)) } } }) });
  }
  if (pulled) onPulled();
}

let running = null, again = false;
export function syncNow() {
  if (!enabled()) return Promise.resolve();
  if (running) { again = true; return running; }
  if (!navigator.onLine) { state.error = null; emit(); return Promise.resolve(); }
  state.busy = true; emit();
  running = run().then(() => { state.error = null; state.last = cfg.syncedAt = Date.now(); saveCfg(); })
    .catch((e) => { state.error = e.message; console.warn('Synchro', e); })
    .finally(() => { running = null; state.busy = false; emit(); if (again) { again = false; syncNow(); } });
  return running;
}

let pushTimer;
export const schedule = () => { if (!enabled()) return; clearTimeout(pushTimer); pushTimer = setTimeout(syncNow, 2500); };

/** Active la synchronisation. Si une copie existe déjà en ligne, elle est fusionnée avec les données de l'appareil. */
export async function enable(token, pass) {
  token = token.trim();
  if (!/^(ghp_|github_pat_|gho_)/.test(token)) throw new Error('La clé GitHub commence par « ghp_ » ou « github_pat_ ».');
  if (pass.length < 8) throw new Error('Phrase secrète : 8 caractères minimum.');
  if (!navigator.onLine) throw new Error('Pas de connexion.');
  salt = null; keys.clear();
  let gistId = await findGist(token);
  if (gistId) {
    const g = await gh(`/gists/${gistId}`, {}, token);
    const text = await fileText(g.files?.[MAIN]);
    const p = text ? JSON.parse(text) : null;
    if (p?.ct) await dec(p, pass); // vérifie la phrase secrète avant d'enregistrer
  } else {
    if (await local.isEmpty()) throw new Error('Aucune copie en ligne : active d’abord la synchro sur l’appareil qui a les données.');
    const g = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: '3L Carrelage · sauvegarde chiffrée', public: false, files: { [MAIN]: { content: '{}' } } }) }, token);
    gistId = g.id;
  }
  cfg = { token, pass, gistId, syncedAt: 0 };
  saveCfg();
  await syncNow();
  if (state.error) throw new Error(state.error);
}

export function disable() { cfg = null; salt = null; keys.clear(); saveCfg(); state.error = null; emit(); }

export function start() {
  local.onChange(schedule);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  addEventListener('online', () => syncNow());
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  syncNow();
}
