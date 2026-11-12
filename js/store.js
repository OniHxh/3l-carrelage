// Données locales + synchronisation.
// - Toutes les données autorisées sont copiées dans IndexedDB : l'application fonctionne hors connexion.
// - Chaque modification est appliquée immédiatement en local puis placée dans une file d'envoi (outbox).
// - Au retour du réseau, la file est envoyée ; le serveur refuse une écriture basée sur une version périmée (409)
//   et le conflit est présenté à l'utilisateur, qui choisit la version à conserver.
import { api, uuid, ApiError } from './core.js';
import { TYPES } from '../shared/permissions.js';
// Note : le « serveur » est désormais local (local.js), toujours joignable, même hors connexion.

const DB_NAME = '3l-erp';
let idb;
const mem = new Map();          // id -> record
let users = [];
let outbox = [];                // opérations en attente
let conflicts = [];
let lastSync = 0;
let dataVersion = 0;
export const version = () => dataVersion;
const listeners = new Set();
const pendingResolvers = new Map(); // opId -> {resolve, reject}

export const status = { online: navigator.onLine, syncing: false, lastSync: 0, error: null };

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('records', { keyPath: 'id' });
      d.createObjectStore('outbox', { keyPath: 'opId' });
      d.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const tx = (store, mode = 'readonly') => idb.transaction(store, mode).objectStore(store);
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbPut = (store, val, key) => reqP(key === undefined ? tx(store, 'readwrite').put(val) : tx(store, 'readwrite').put(val, key)).catch(() => {});
const idbDel = (store, key) => reqP(tx(store, 'readwrite').delete(key)).catch(() => {});

function emit(changed = true) {
  if (changed) dataVersion++; for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export async function init(userId) {
  idb = await openDb();
  const owner = await reqP(tx('meta').get('owner'));
  if (owner && owner !== userId) await clearLocal(); // autre utilisateur sur cet appareil
  await idbPut('meta', userId, 'owner');
  for (const r of await reqP(tx('records').getAll())) mem.set(r.id, r);
  outbox = (await reqP(tx('outbox').getAll())).sort((a, b) => a.ts - b.ts);
  conflicts = (await reqP(tx('meta').get('conflicts'))) || [];
  users = (await reqP(tx('meta').get('users'))) || [];
  lastSync = (await reqP(tx('meta').get('lastSync'))) || 0;
  status.lastSync = lastSync;
  window.addEventListener("online", () => { status.online = true; emit(false); sync(); });
  window.addEventListener("offline", () => { status.online = false; emit(false); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 30000);
}

export async function clearLocal() {
  if (!idb) idb = await openDb();
  mem.clear(); outbox = []; conflicts = []; users = []; lastSync = 0;
  for (const s of ['records', 'outbox', 'meta']) await reqP(tx(s, 'readwrite').clear()).catch(() => {});
}

// ---------- Lecture ----------
export const get = (id) => { const r = mem.get(id); return r && !r._deleted ? r : null; };
export const all = (type) => [...mem.values()].filter((r) => r.type === type && !r._deleted);
export function grouped() {
  const out = Object.fromEntries(TYPES.map((t) => [t, []]));
  for (const r of mem.values()) if (!r._deleted && out[r.type]) out[r.type].push(r);
  return out;
}
export const settings = () => get('parametres') || {};
// Membres de l'équipe sans compte (ex. ouvrier qui n'utilise pas l'application) : visibles dans le planning et les heures.
const membres = () => all('membre').map((m) => ({ id: m.id, name: m.name, active: m.actif !== false, sansCompte: true, roleLabel: 'Sans compte', profile: { couleur: m.couleur, tel: m.tel, competences: m.competences } }));
export const getUsers = () => [...users, ...membres()];
export const userName = (id) => getUsers().find((u) => u.id === id)?.name || '—';
export const pendingCount = () => outbox.length;
export const getConflicts = () => conflicts;

// ---------- Écriture ----------
function enqueue(op) {
  // Regroupe les modifications successives d'une même fiche non encore envoyées
  const i = outbox.findIndex((o) => o.id === op.id && !o.sending);
  if (i >= 0) {
    const prev = outbox[i];
    if (op.op === 'delete' && prev.op === 'save' && prev.baseVersion == null) {
      outbox.splice(i, 1); idbDel('outbox', prev.opId); // création jamais envoyée puis supprimée
      return null;
    }
    op.baseVersion = prev.baseVersion;
    pendingResolvers.get(prev.opId)?.resolve({ superseded: true });
    outbox.splice(i, 1); idbDel('outbox', prev.opId);
  }
  outbox.push(op);
  idbPut('outbox', op);
  return op;
}

/** Enregistre localement puis synchronise. Résout avec la version serveur si en ligne. */
export function save(type, data) {
  const id = data.id || uuid();
  const existing = mem.get(id);
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('_')));
  const local = { ...existing, ...clean, id, type, _pending: 1, _deleted: 0, _updatedAt: Date.now() };
  mem.set(id, local); idbPut('records', local);
  const op = enqueue({ opId: uuid(), op: 'save', type, id, data: clean, baseVersion: existing?._v ?? null, ts: Date.now(), offline: !navigator.onLine });
  emit();
  return awaitOp(op, local);
}

export function remove(id) {
  const existing = mem.get(id);
  if (!existing) return Promise.resolve();
  const local = { ...existing, _deleted: 1, _pending: 1 };
  mem.set(id, local); idbPut('records', local);
  const op = enqueue({ opId: uuid(), op: 'delete', id, type: existing.type, baseVersion: existing._v ?? null, ts: Date.now() });
  emit();
  return awaitOp(op, local);
}

function awaitOp(op, local) {
  if (!op) return Promise.resolve(local);
  const p = new Promise((resolve, reject) => pendingResolvers.set(op.opId, { resolve, reject }));
  flushSoon();
  return p.then((r) => r?.superseded ? get(local.id) || local : r);
}

let flushTimer;
function flushSoon() { clearTimeout(flushTimer); flushTimer = setTimeout(() => sync(), 120); }

function applyServer(rec) {
  if (!rec) return;
  const prev = mem.get(rec.id);
  if (prev && prev._v === rec._v && !prev._pending && prev._deleted === rec._deleted) return;
  dataVersion++;
  const hasPending = outbox.some((o) => o.id === rec.id);
  const cur = mem.get(rec.id);
  if (hasPending && cur) { mem.set(rec.id, { ...cur, _v: rec._v }); return; } // la modif locale reste prioritaire jusqu'à envoi
  // Les photos créées hors ligne gardent leur aperçu local jusqu'à ce que le serveur fournisse l'image
  const keep = cur?.dataUrl && !rec.blobId ? { dataUrl: cur.dataUrl } : {};
  const next = { ...rec, ...keep };
  mem.set(rec.id, next); idbPut('records', next);
}

let syncing = null;
export function sync() {
  if (syncing) return syncing.then(() => (outbox.some((o) => !o.sending) ? sync() : null));
  syncing = doSync().finally(() => { syncing = null; status.syncing = false; emit(false); });
  return syncing;
}

async function doSync() {
  status.syncing = true; status.error = null; emit(false);
  try {
    // 1. Envoi de la file d'attente
    const batch = outbox.filter((o) => !o.sending).slice(0, 100);
    if (batch.length) {
      batch.forEach((o) => (o.sending = true));
      let results;
      try {
        ({ results } = await api('/batch', { method: 'POST', body: { ops: batch.map(({ sending, ts, ...o }) => o) } }));
      } catch (e) {
        batch.forEach((o) => (o.sending = false));
        throw e;
      }
      for (const r of results) {
        const op = batch.find((o) => o.opId === r.opId);
        outbox = outbox.filter((o) => o.opId !== r.opId); idbDel('outbox', r.opId);
        const waiter = pendingResolvers.get(r.opId); pendingResolvers.delete(r.opId);
        if (r.ok) {
          applyServer(r.record); (r.extra || []).forEach(applyServer);
          waiter?.resolve(mem.get(r.record.id));
        } else if (r.status === 409 && r.current) {
          const c = { id: op.id, type: op.type, op, current: r.current, at: Date.now() };
          conflicts = [...conflicts.filter((x) => x.id !== op.id), c];
          idbPut('meta', conflicts, 'conflicts');
          waiter?.reject(new ApiError(409, r.error, r));
        } else {
          // Refus métier (droits, données invalides…) : on restaure la version serveur
          await refetch(op.id);
          waiter?.reject(new ApiError(r.status, r.error, r));
          if (!waiter) window.dispatchEvent(new CustomEvent('sync:error', { detail: r.error }));
        }
      }
      if (outbox.some((o) => !o.sending)) return doSync();
    }
    // 2. Réception des changements des autres appareils
    const data = await api(`/sync?since=${lastSync}`);
    for (const r of data.records) applyServer(r);
    users = data.users; idbPut('meta', users, 'users');
    lastSync = data.serverTime - 1000; // marge contre les écritures concurrentes
    status.lastSync = Date.now();
    idbPut('meta', lastSync, 'lastSync');
  } catch (e) {
    status.error = e.status === 0 ? null : e.message;
    if (e.status === 0) status.online = false;
    for (const [opId, w] of pendingResolvers) {
      if (!outbox.find((o) => o.opId === opId && o.sending)) { w.resolve(get(outbox.find((o) => o.opId === opId)?.id)); pendingResolvers.delete(opId); }
    }
  }
  emit(false);
}

async function refetch(id) {
  try {
    const { record } = await api(`/records/x/${id}`);
    mem.set(id, record); idbPut('records', record);
  } catch {
    const cur = mem.get(id);
    if (cur && cur._v == null) { mem.delete(id); idbDel('records', id); }
  }
}

/** Résolution d'un conflit : 'mine' renvoie ma version sur la base serveur, 'theirs' garde la version serveur. */
export async function resolveConflict(id, choice) {
  const c = conflicts.find((x) => x.id === id);
  if (!c) return;
  conflicts = conflicts.filter((x) => x.id !== id); idbPut('meta', conflicts, 'conflicts');
  mem.set(id, c.current); idbPut('records', c.current);
  if (choice === 'mine') {
    if (c.op.op === 'delete') await remove(id);
    else await save(c.type, { ...c.op.data, id });
  }
  emit();
}
