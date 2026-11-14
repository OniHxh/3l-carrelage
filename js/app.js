// Point d'entrée : coquille de navigation, routeur. Données sur l'appareil (local.js), synchro chiffrée (cloud.js).
import { api, esc, icon, initials, qs, qsa, relTime } from './core.js';
import * as store from './store.js';
import * as cloud from './cloud.js';
import * as local from './local.js';
import { modal, toast, toastError } from './ui.js';
import { can as canPerm } from '../shared/permissions.js';
import { dashboardKpis } from '../shared/calc.js';

export const app = {
  user: null, roles: {}, modules: {},
  can(module, level = 1) { return canPerm(this.user, module, level); },
  go(hash) { if (location.hash === hash) render(); else location.hash = hash; },
};

const NAV = [
  { group: 'Pilotage', items: [
    { href: '#/', label: 'Accueil', icon: 'home', match: /^$/ },
    { href: '#/ca', label: 'Chiffre d’affaires', icon: 'trend', mod: 'ca', match: /^ca/ },
  ] },
  { group: 'Activité', items: [
    { href: '#/chantiers', label: 'Chantiers', icon: 'site', mod: 'chantiers', match: /^chantier/, badge: 'chantiers' },
    { href: '#/planning', label: 'Planning', icon: 'calendar', mod: 'planning', match: /^(planning|taches|recap)/, badge: 'taches' },
    { href: '#/clients', label: 'Clients', icon: 'users', mod: 'clients', match: /^client/ },
    { href: '#/visites', label: 'Visites clients', icon: 'camera', mod: 'chantiers', match: /^visite/ },
  ] },
  { group: 'Entreprise', items: [
    { href: '#/outils', label: 'Calculateur', icon: 'calc', match: /^outils/ },
    { href: '#/equipe', label: 'Équipe', icon: 'shield', mod: 'equipe', match: /^equipe/ },
    { href: '#/journal', label: 'Journal d’activité', icon: 'log', match: /^journal/ },
    { href: '#/parametres', label: 'Paramètres', icon: 'settings', mod: 'parametres', match: /^(parametres|profil)/ },
  ] },
];

const ROUTES = [
  ['', 'dashboard', 'main'],
  ['chantiers', 'chantiers', 'list'], ['chantier/:id', 'chantiers', 'detail'],
  ['clients', 'clients', 'list'], ['client/:id', 'clients', 'detail'],
  ['visites', 'visites', 'list'], ['visite/:id', 'visites', 'detail'],
  ['planning', 'planning', 'week'], ['recap', 'planning', 'recap'], ['taches', 'planning', 'taches'], ['tache/:id', 'planning', 'taches'], ['evenement/:id', 'planning', 'week'], ['pointage/:id', 'planning', 'week'],
  ['note/:id', 'chantiers', 'fromChild'], ['photo/:id', 'chantiers', 'fromChild'],
  ['equipe', 'equipe', 'list'], ['journal', 'equipe', 'journal'],
  ['parametres', 'parametres', 'main'], ['profil', 'parametres', 'profil'],
  ['outils', 'outils', 'calc'], ['ca', 'ca', 'main'],
  ['plus', 'menu', 'menu'],
];

const loaders = {
  dashboard: () => import('./views/dashboard.js'), chantiers: () => import('./views/chantiers.js'), clients: () => import('./views/clients.js'), visites: () => import('./views/visites.js'),
  planning: () => import('./views/planning.js'), equipe: () => import('./views/equipe.js'),
  parametres: () => import('./views/parametres.js'), ca: () => import('./views/ca.js'), outils: () => import('./views/outils.js'), menu: async () => ({ default: { menu: menuView } }),
};

function matchRoute(path) {
  for (const [pattern, mod, view] of ROUTES) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    const m = path.match(re);
    if (m) return { mod, view, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

let current = null; // { view, cleanup, path }

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, q = ''] = raw.split('?');
  return { path: path.replace(/\/$/, ''), query: Object.fromEntries(new URLSearchParams(q)) };
}

async function render({ keepScroll = false } = {}) {
  if (!app.user) return;
  const { path, query } = parseHash();
  const route = matchRoute(path);
  const content = qs('#content');
  if (!content) return;
  if (!route) { content.innerHTML = `<div class="empty">${icon('alert')}<b>Page introuvable</b><a class="btn" href="#/">Retour à l’accueil</a></div>`; return; }
  let mod;
  try { mod = (await loaders[route.mod]()).default; } catch (e) { console.error(e); content.innerHTML = `<div class="empty"><b>Module indisponible hors ligne</b>Reconnectez-vous une fois pour le télécharger.</div>`; return; }
  const view = mod[route.view];
  const scroll = keepScroll ? window.scrollY : 0;
  current?.cleanup?.();
  const ctx = { params: route.params, query, path };
  const title = typeof view.title === 'function' ? view.title(ctx) : view.title;
  qs('.topbar .title').textContent = title || '3L Carrelage';
  document.title = title ? `${title} · 3L Carrelage` : '3L Carrelage';
  content.innerHTML = view.render(ctx);
  if (!keepScroll) { content.style.animation = 'none'; void content.offsetWidth; content.style.animation = ''; }
  const cleanup = view.mount?.(content, ctx);
  current = { view, cleanup, path, ctx };
  window.scrollTo(0, scroll);
  updateNav(path);
}

function updateNav(path) {
  for (const a of qsa('.nav a, .tabbar a')) {
    const item = a.dataset.match ? new RegExp(a.dataset.match) : null;
    a.classList.toggle('active', !!item && item.test(path));
  }
}

function badges() {
  const k = dashboardKpis(store.grouped());
  return { chantiers: k.chantiersRisque.length, taches: k.tachesRetard.length };
}

function shellHtml() {
  const u = app.user;
  const nav = NAV.map((g) => {
    const items = g.items.filter((i) => !i.mod || app.can(i.mod, 1));
    if (!items.length) return '';
    return `<div class="nav-label">${esc(g.group)}</div><nav class="nav">${items.map((i) => `<a href="${i.href}" data-match="${i.match.source}" data-badge="${i.badge || ''}">${icon(i.icon)}<span>${esc(i.label)}</span></a>`).join('')}</nav>`;
  }).join('');
  const tab = (href, ic, label, match) => `<a href="${href}" data-match="${match}">${icon(ic)}<span>${label}</span></a>`;
  return `<div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#/"><span class="logo-tile"><img src="icons/icon-192.png" alt="3L Carrelage"></span><div><b>3L Carrelage</b><span>Revêtement &amp; rénovation</span></div></a>
      ${nav}
      <div class="spacer"></div>
      <a class="me" href="#/profil"><span class="avatar" style="background:${esc(u.profile?.couleur || '#171717')}">${esc(initials(u.name))}</span><div class="grow"><div style="font-weight:600;font-size:14px">${esc(u.name)}</div><div class="tiny muted">${esc(u.roleLabel)}</div></div></a>
    </aside>
    <div class="main">
      <header class="topbar">
        <a class="mobile-logo logo-tile" href="#/"><img src="icons/icon-192.png" alt="3L Carrelage"></a>
        <div class="title"></div>
        <button class="sync-pill" id="sync-pill" title="État de la synchronisation"><span class="dot"></span><span class="lbl">Synchronisé</span></button>
        <button class="btn ghost icon-only" id="theme-btn" title="Thème clair / sombre">${icon('moon')}</button>
      </header>
      <main class="content" id="content"></main>
    </div>
    <nav class="tabbar">
      ${tab('#/', 'home', 'Accueil', '^$')}
      ${tab('#/chantiers', 'site', 'Chantiers', '^chantier')}
      <button class="plus" id="quick-add" aria-label="Ajouter"><span>${icon('plus')}</span></button>
      ${tab('#/planning', 'calendar', 'Planning', '^(planning|taches|recap)')}
      ${tab('#/plus', 'grid', 'Plus', '^(plus|clients|client|equipe|journal|parametres|profil|outils|ca)')}
    </nav>
  </div>`;
}

function updateChrome() {
  const pill = qs('#sync-pill');
  if (pill) {
    const c = cloud.state, on = cloud.enabled(), online = navigator.onLine;
    pill.className = 'sync-pill' + (!on ? ' offline' : !online ? ' offline' : c.error ? ' error' : '') + (c.busy ? ' busy' : '');
    qs('.lbl', pill).textContent = !on ? 'Sur cet appareil' : !online ? 'Hors ligne' : c.busy ? 'Synchronisation…' : c.error ? 'Erreur de synchro' : 'Synchronisé';
  }
  const b = badges();
  for (const a of qsa('.nav a[data-badge]')) {
    a.querySelector('.badge')?.remove();
    const n = b[a.dataset.badge];
    if (n) a.insertAdjacentHTML('beforeend', `<span class="badge count">${n}</span>`);
  }
  notifyAlerts(b);
}

// Notifications système pour les nouvelles alertes (chantiers à risque, tâches en retard)
let lastAlertKey = null;
function notifyAlerts(b) {
  const key = JSON.stringify(b);
  if (lastAlertKey === null) { lastAlertKey = key; return; }
  if (key === lastAlertKey) return;
  const prev = JSON.parse(lastAlertKey); lastAlertKey = key;
  const msgs = [];
  if (b.chantiers > prev.chantiers) msgs.push(`${b.chantiers} chantier(s) à surveiller`);
  if (b.taches > prev.taches) msgs.push(`${b.taches} tâche(s) en retard`);
  if (!msgs.length || !('Notification' in window) || Notification.permission !== 'granted') return;
  navigator.serviceWorker?.ready.then((reg) => reg.showNotification('3L Carrelage', { body: msgs.join(' · '), icon: 'icons/icon-192.png', badge: 'icons/favicon.png', data: { url: './#/' } })).catch(() => {});
}

function syncPanel() {
  const c = cloud.state, on = cloud.enabled();
  const m = modal({
    title: 'Synchronisation',
    body: `<div class="stack">
      <div class="kv"><dt>Données</dt><dd>Enregistrées sur cet appareil</dd>
      <dt>Synchro téléphone ↔ Mac</dt><dd>${on ? 'Activée (chiffrée)' : 'Désactivée'}</dd>
      ${on ? `<dt>Dernière synchro</dt><dd>${cloud.info().since ? relTime(cloud.info().since) : 'jamais'}</dd>` : ''}
      ${c.error ? `<dt>Erreur</dt><dd style="color:var(--red-ink)">${esc(c.error)}</dd>` : ''}</div>
      ${on ? '' : '<p class="small muted" style="margin:0">Activez la synchronisation dans Paramètres → Données &amp; appareil pour retrouver vos données sur tous vos appareils.</p>'}
    </div>`,
    foot: on ? `<button class="btn" data-close>Fermer</button><button class="btn dark" id="sync-now">${icon('refresh')}Synchroniser</button>`
      : `<button class="btn" data-close>Fermer</button><a class="btn dark" href="#/parametres?tab=donnees" id="sync-go">Activer</a>`,
  });
  qs('#sync-go', m.el)?.addEventListener('click', () => m.close());
  qs('#sync-now', m.el)?.addEventListener('click', async () => { await cloud.syncNow(); await store.sync(); m.close(); toast(cloud.state.error || 'Données à jour.', cloud.state.error ? 'error' : ''); });
}

function quickAdd() {
  const items = [
    ['chantiers', '#/visites?nouveau=1', 'camera', 'Visite client'],
    ['chantiers', '#/chantiers?nouveau=1', 'site', 'Chantier'],
    ['chantiers', '#/chantiers?photo=1', 'camera', 'Photo chantier'],
    ['planning', '#/taches?nouveau=1', 'tasks', 'Tâche'],
    ['planning', '#/planning?heures=1', 'clock', 'Heures'],
    ['clients', '#/clients?nouveau=1', 'user', 'Client'],
  ].filter(([m]) => app.can(m, 2));
  const m = modal({ title: 'Ajouter', body: `<div class="menu-grid">${items.map(([, h, i, l]) => `<a href="${h}" data-close>${icon(i)}${l}</a>`).join('')}</div>` });
  qsa('a', m.el).forEach((a) => a.addEventListener('click', () => m.close()));
}

const menuView = {
  title: 'Menu',
  render: () => {
    const all = NAV.flatMap((g) => g.items).filter((i) => !i.mod || app.can(i.mod, 1)).filter((i) => !['#/', '#/chantiers', '#/planning'].includes(i.href));
    return `<div class="page-head"><h1>Menu</h1></div>
      <div class="menu-grid">${all.map((i) => `<a href="${i.href}">${icon(i.icon)}${esc(i.label)}</a>`).join('')}</div>
      <div class="hr"></div>
      <a class="card li" href="#/profil" style="border-radius:14px"><span class="avatar">${esc(initials(app.user.name))}</span><div class="grow"><div class="t">${esc(app.user.name)}</div><div class="s">${esc(app.user.roleLabel)} · Mon profil et sécurité</div></div>${icon('chevron')}</a>`;
  },
};

// ---------- Thème ----------
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = dark ? 'light' : 'dark';
  try { localStorage.setItem('theme', next); } catch {}
  applyTheme(next);
}
try { applyTheme(localStorage.getItem('theme')); } catch {}

// ---------- Démarrage ----------
async function startApp(me) {
  Object.assign(app, { user: me.user, roles: me.roles, modules: me.modules });
  await store.init(me.user.id);
  qs('#app').innerHTML = shellHtml();
  qs('#sync-pill').addEventListener('click', syncPanel);
  qs('#quick-add').addEventListener('click', quickAdd);
  qs('#theme-btn').addEventListener('click', toggleTheme);
  addEventListener('scroll', () => qs('.topbar')?.classList.toggle('scrolled', scrollY > 4), { passive: true });
  let rerenderTimer, seen = store.version();
  store.subscribe(() => {
    updateChrome();
    if (store.version() === seen) return;
    seen = store.version();
    if (current?.view?.live === false) return;
    if (document.querySelector('.overlay')) return; // pas de re-rendu sous une fenêtre ouverte
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => render({ keepScroll: true }), 80);
  });
  addEventListener('hashchange', () => render());
  cloud.setOnPulled(() => store.sync());
  cloud.subscribe(updateChrome);
  addEventListener('online', updateChrome); addEventListener('offline', updateChrome);
  updateChrome();
  await render();
  store.sync();
  cloud.start();
}

// Ouvre photos et PDF depuis la base de l'appareil (fonctionne aussi dans l'application installée sur iPhone).
document.addEventListener('click', async (e) => {
  const a = e.target.closest?.('a[href^="api/blobs/"]');
  if (!a) return;
  e.preventDefault();
  const b = await local.getBlob(a.getAttribute('href').split('/').pop());
  if (!b) return toast('Fichier pas encore synchronisé sur cet appareil.', 'error');
  const url = URL.createObjectURL(b.blob);
  if (!window.open(url, '_blank')) location.href = url;
});

// Au tout premier chargement, le service worker (qui sert les photos) doit prendre la main avant l'affichage.
function swReady() {
  if (!('serviceWorker' in navigator)) return Promise.resolve();
  const reg = navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.serviceWorker.controller) return Promise.resolve();
  return Promise.race([new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true })), reg.then(() => new Promise((r) => setTimeout(r, 2500)))]);
}

async function boot() {
  document.addEventListener('input', (e) => {
    if (e.target.matches?.('[data-range-out]')) e.target.nextElementSibling.textContent = `${e.target.value} %`;
  });
  addEventListener('sync:error', (e) => toast(e.detail, 'error'));
  await swReady();
  if (await local.isEmpty()) {
    const { renderWelcome } = await import('./views/accueil.js');
    return renderWelcome(() => location.reload());
  }
  return startApp(await api('/me'));
}

boot().catch((e) => { console.error(e); toastError(e); });
