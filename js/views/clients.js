import { esc, icon, fmtDate, badge, qs, initials } from '../core.js';
import * as store from '../store.js';
import { app } from '../app.js';
import { formModal, toast } from '../ui.js';

export function clientForm(c = {}, { onSaved } = {}) {
  formModal({
    title: c.id ? 'Modifier le client' : 'Nouveau client', wide: true,
    fields: [
      { name: 'nom', label: 'Nom / raison sociale', required: true, full: true },
      { name: 'type', label: 'Type', type: 'select', options: [['particulier', 'Particulier'], ['pro', 'Professionnel'], ['syndic', 'Syndic / bailleur'], ['architecte', 'Architecte / maître d’œuvre']], default: 'particulier' },
      { name: 'contact', label: 'Personne à contacter' },
      { name: 'tel', label: 'Téléphone', type: 'tel' }, { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'adresse', label: 'Adresse', full: true }, { name: 'cp', label: 'Code postal' }, { name: 'ville', label: 'Ville' },
      { name: 'siret', label: 'SIRET (pro)' }, { name: 'source', label: 'Origine du contact', list: ['Bouche-à-oreille', 'Site internet', 'Google', 'Réseaux sociaux', 'Architecte', 'Ancien client', 'Panneau de chantier'] },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
    ],
    data: c,
    onSubmit: async (v) => { const r = await store.save('client', { ...c, ...v }); toast('Client enregistré.'); onSaved ? onSaved(r) : !c.id && app.go(`#/client/${r.id}`); },
    onDelete: c.id && app.can('clients', 3) ? async () => { await store.remove(c.id); app.go('#/clients'); } : null,
  });
}

const actifs = (c, recs) => recs.chantier.filter((x) => x.clientId === c.id && ['en_cours', 'planifie', 'en_pause'].includes(x.statut)).length;
const nbChantiers = (c, recs) => recs.chantier.filter((x) => x.clientId === c.id).length;

export default {
  list: {
    title: 'Clients',
    render({ query }) {
      const recs = store.grouped();
      const q = (query.q || '').toLowerCase();
      const list = recs.client.filter((c) => !q || `${c.nom} ${c.ville} ${c.tel} ${c.email} ${c.contact}`.toLowerCase().includes(q)).sort((a, b) => a.nom.localeCompare(b.nom));
      return `<div class="page-head"><div><h1>Clients</h1><p>${recs.client.length} client(s)</p></div><div class="actions">${app.can('clients', 2) ? `<button class="btn primary" id="new">${icon('plus')}Nouveau client</button>` : ''}</div></div>
        <div class="search" style="margin-bottom:16px;max-width:420px">${icon('search')}<input class="input" id="q" placeholder="Nom, ville, téléphone…" value="${esc(query.q || '')}"></div>
        <div class="card">${list.length ? `<div class="list">${list.map((c) => `<a class="li" href="#/client/${c.id}"><span class="avatar" style="background:var(--surface-2);color:var(--ink);border:1px solid var(--line)">${esc(initials(c.nom))}</span><div class="grow"><div class="t">${esc(c.nom)}</div><div class="s">${esc([c.ville, c.tel].filter(Boolean).join(' · ') || '—')}</div></div>
          <div class="right hide-m"><div class="tiny muted">${nbChantiers(c, recs)} chantier(s)</div></div>${actifs(c, recs) ? `<span class="badge dark">${actifs(c, recs)} actif(s)</span>` : ''}</a>`).join('')}</div>` : `<div class="empty">${icon('users')}<b>Aucun client</b>Ajoutez vos clients pour les rattacher à leurs chantiers.</div>`}</div>`;
    },
    mount(root, { query }) {
      qs('#new', root)?.addEventListener('click', () => clientForm());
      const q = qs('#q', root);
      let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { history.replaceState(null, '', `#/clients${q.value ? '?q=' + encodeURIComponent(q.value) : ''}`); dispatchEvent(new HashChangeEvent('hashchange')); }, 300); });
      if (query.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      if (query.nouveau) { history.replaceState(null, '', '#/clients'); clientForm(); }
    },
  },
  detail: {
    title: ({ params }) => store.get(params.id)?.nom || 'Client',
    render({ params }) {
      const c = store.get(params.id);
      if (!c) return `<div class="empty card"><b>Client introuvable</b><a class="btn" href="#/clients">Retour</a></div>`;
      const recs = store.grouped();
      const ch = recs.chantier.filter((x) => x.clientId === c.id);
      return `<div class="page-head"><div><a class="btn ghost sm" href="#/clients" style="margin-bottom:6px">${icon('back')}Clients</a><h1>${esc(c.nom)}</h1><p>${esc({ particulier: 'Particulier', pro: 'Professionnel', syndic: 'Syndic / bailleur', architecte: 'Architecte' }[c.type] || '')}${c.source ? ' · ' + esc(c.source) : ''}</p></div>
        <div class="actions">${c.tel ? `<a class="btn" href="tel:${esc(c.tel)}">${icon('phone')}<span class="lbl">Appeler</span></a>` : ''}${c.email ? `<a class="btn" href="mailto:${esc(c.email)}">${icon('mail')}<span class="lbl">E-mail</span></a>` : ''}
        ${app.can('clients', 2) ? `<button class="btn" id="edit">${icon('edit')}<span class="lbl">Modifier</span></button>` : ''}${app.can('chantiers', 2) ? `<button class="btn primary" id="new-ch">${icon('plus')}Chantier</button>` : ''}</div></div>
        <div class="grid g2">
          <div class="card card-pad"><dl class="kv"><dt>Contact</dt><dd>${esc(c.contact || '—')}</dd><dt>Téléphone</dt><dd>${esc(c.tel || '—')}</dd><dt>E-mail</dt><dd>${esc(c.email || '—')}</dd><dt>Adresse</dt><dd>${esc([c.adresse, c.cp, c.ville].filter(Boolean).join(', ') || '—')}</dd>${c.siret ? `<dt>SIRET</dt><dd>${esc(c.siret)}</dd>` : ''}${c.notes ? `<dt>Notes</dt><dd style="white-space:pre-wrap">${esc(c.notes)}</dd>` : ''}</dl></div>
          <div class="card"><div class="card-head"><h2>Chantiers</h2><span class="badge">${ch.length}</span></div><div class="list">${ch.map((x) => `<a class="li" href="#/chantier/${x.id}"><div class="grow"><div class="t">${esc(x.nom)}</div><div class="s">${fmtDate(x.dateDebut)}</div></div>${badge('chantier', x.statut)}</a>`).join('') || '<div class="empty small">Aucun chantier.</div>'}</div></div>
        </div>`;
    },
    mount(root, { params }) {
      qs('#edit', root)?.addEventListener('click', () => clientForm(store.get(params.id)));
      qs('#new-ch', root)?.addEventListener('click', async () => { const { chantierForm } = await import('./chantiers.js'); chantierForm({ clientId: params.id }); });
    },
  },
};
