import { esc, icon, api, fmtDateTime, relTime, initials, qs, qsa } from '../core.js';
import * as store from '../store.js';
import { app } from '../app.js';
import { modal, toast, toastError, options, fieldHtml, readForm, formModal } from '../ui.js';

const ACTIONS = { create: 'a créé', update: 'a modifié', delete: 'a supprimé', login: 's’est connecté', login_echec: 'Échec de connexion', setup: 'Installation', backup: 'Sauvegarde', export: 'Export', password: 'Mot de passe' };
const TYPE_LABEL = { membre: 'le membre', chantier: 'le chantier', client: 'le client', devis: 'le devis', facture: 'la facture', depense: 'la dépense', materiau: 'l’article', commande: 'la commande', fournisseur: 'le fournisseur', tache: 'la tâche', evenement: 'l’événement', pointage: 'des heures', photo: 'une photo', note: 'une note de journal', parametres: 'les paramètres', prestation: 'la prestation', user: 'l’utilisateur', mouvement: 'un mouvement de stock' };
const ROUTE = { chantier: 'chantier', client: 'client', tache: 'tache' };
const fmtVal = (v) => v == null || v === '' ? '∅' : typeof v === 'object' ? '…' : String(v).slice(0, 60);

function entryHtml(e) {
  const link = ROUTE[e.entity_type] && e.action !== 'delete' ? `#/${ROUTE[e.entity_type]}/${e.entity_id}` : null;
  const diff = e.diff ? Object.entries(e.diff).slice(0, 5).map(([k, v]) => `${esc(k)} : <s>${esc(fmtVal(v.avant))}</s> → ${esc(fmtVal(v.apres))}`).join('<br>') : '';
  return `<div class="tl"><span class="avatar sm">${esc(initials(e.user_name || '?'))}</span><div>
    <div><b>${esc(e.user_name || 'Système')}</b> ${esc(ACTIONS[e.action] || e.action)} ${esc(TYPE_LABEL[e.entity_type] || '')} ${link ? `<a href="${link}" style="text-decoration:underline">${esc(e.summary || '')}</a>` : esc(e.summary || '')}
    ${e.via === 'hors-ligne' ? '<span class="badge amber">saisi hors ligne</span>' : ''}</div>
    <div class="tiny muted">${fmtDateTime(e.ts)}</div>${diff ? `<div class="diff">${diff}</div>` : ''}</div></div>`;
}

export async function auditTimeline(el, { type, id, user, limit = 200 } = {}) {
  try {
    const p = new URLSearchParams({ limit });
    if (type) p.set('type', type); if (id) p.set('id', id); if (user) p.set('user', user);
    const { entries } = await api(`/audit?${p}`);
    el.innerHTML = entries.length ? `<div class="timeline">${entries.map(entryHtml).join('')}</div>` : '<div class="empty small">Aucune activité enregistrée.</div>';
  } catch (e) {
    el.innerHTML = `<div class="empty small">${e.status === 0 ? 'Historique disponible uniquement en ligne.' : esc(e.message)}</div>`;
  }
}

export function membreForm(mb = {}) {
  formModal({
    title: mb.id ? `Modifier ${mb.name}` : 'Ajouter un membre sans compte',
    fields: [
      { name: 'name', label: 'Nom complet', required: true, full: true },
      { name: 'tel', label: 'Téléphone', type: 'tel' },
      { name: 'couleur', label: 'Couleur (planning)', type: 'color', default: '#2457C5' },
      { name: 'competences', label: 'Compétences', full: true },
      { name: 'actif', label: 'Actif (apparaît dans le planning)', type: 'checkbox', full: true, default: true },
    ],
    data: mb,
    onSubmit: async (v) => { await store.save('membre', { ...mb, ...v }); toast('Équipe mise à jour.'); },
    onDelete: mb.id && app.can('planning', 3) ? () => store.remove(mb.id) : null,
  });
}

export default {
  list: {
    title: 'Équipe',
    render: () => `<div class="page-head"><div><h1>Équipe</h1><p>Les personnes de l’équipe, pour le planning et les heures</p></div><div class="actions">${app.can('planning', 2) ? `<button class="btn primary" id="new-mb2">${icon('plus')}Ajouter un membre</button>` : ''}</div></div>
      <div class="card" id="users"><div class="empty small">Chargement…</div></div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h2>Membres sans compte</h2><div class="tiny muted">N’utilisent pas l’application : vous les placez dans le planning et saisissez leurs heures.</div></div>${app.can('planning', 2) ? `<button class="btn sm dark" id="new-mb">${icon('plus')}Ajouter</button>` : ''}</div>
        <div class="list">${store.all('membre').sort((a, b) => a.name.localeCompare(b.name)).map((m) => `<div class="li ${app.can('planning', 2) ? 'click' : ''}" data-mb="${m.id}"><span class="avatar" style="background:${esc(m.couleur || '#2457C5')}">${esc(initials(m.name))}</span><div class="grow"><div class="t">${esc(m.name)} ${m.actif === false ? '<span class="badge">Inactif</span>' : ''}</div><div class="s">Sans compte${m.tel ? ' · ' + esc(m.tel) : ''}${m.competences ? ' · ' + esc(m.competences) : ''}</div></div></div>`).join('') || '<div class="empty small">Aucun.</div>'}</div></div>`,
    mount(root) {
      const load = async () => {
        const el = qs('#users', root);
        try {
          const { users } = await api('/users');
          el.innerHTML = `<div class="list">${users.map((u) => `<div class="li" data-u="${u.id}"><span class="avatar" style="background:${esc(u.profile.couleur || '#171717')}">${esc(initials(u.name))}</span>
            <div class="grow"><div class="t">${esc(u.name)} ${u.id === app.user.id ? '<span class="badge">Vous</span>' : ''} ${u.active ? '' : '<span class="badge red">Désactivé</span>'}</div><div class="s">${esc(u.roleLabel)}${u.email ? ' · ' + esc(u.email) : ''}${u.profile.competences ? ' · ' + esc(u.profile.competences) : ''}</div></div>
            </div>`).join('')}</div>`;
          
        } catch (e) { el.innerHTML = `<div class="empty small">${esc(e.status === 0 ? 'Disponible uniquement en ligne.' : e.message)}</div>`; }
      };
      load();
      qs('#new-mb2', root)?.addEventListener('click', () => membreForm());
      qs('#new-mb', root)?.addEventListener('click', () => membreForm());
      qsa('[data-mb]', root).forEach((el) => el.addEventListener('click', () => app.can('planning', 2) && membreForm(store.get(el.dataset.mb))));
    },
  },
  journal: {
    title: 'Journal d’activité',
    render: ({ query }) => `<div class="page-head"><div><h1>Journal d’activité</h1><p>Qui a créé, modifié ou supprimé quoi, et quand.</p></div>
      ${app.can('equipe') ? `<div class="actions"><select class="input" id="who" style="width:auto">${options(store.getUsers().map((u) => [u.id, u.name]), query.user, { empty: 'Toute l’équipe' })}</select></div>` : ''}</div>
      <div class="card card-pad" id="log"><div class="empty small">Chargement…</div></div>`,
    mount(root, { query }) {
      auditTimeline(qs('#log', root), { user: query.user, limit: 300 });
      qs('#who', root)?.addEventListener('change', (e) => app.go(`#/journal${e.target.value ? '?user=' + e.target.value : ''}`));
    },
    live: false,
  },
};
