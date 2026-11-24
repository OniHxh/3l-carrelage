import { esc, icon, number, fmtDate, fmtShort, badge, relTime, STATUTS, TYPES_TRAVAUX, qs, qsa } from '../core.js';
import { pdfText, lireDevis } from '../../shared/pdftext.js';
import * as store from '../store.js';
import { app } from '../app.js';
import { formModal, modal, toast, toastError, pickImages, photoSrc, lightbox, options, confirmDialog, fieldHtml, readForm, compressImage } from '../ui.js';
import { chantierRisque, tempsChantier, todayISO, num, round2 } from '../../shared/calc.js';
import { partiesDossier, pdfDossierChantier } from '../docs.js';
import { tacheForm, pointageForm } from './planning.js';
import { auditTimeline } from './equipe.js';

const clientOpts = () => store.all('client').sort((a, b) => a.nom.localeCompare(b.nom)).map((c) => [c.id, c.nom]);
const userOpts = () => store.getUsers().filter((u) => u.active).map((u) => [u.id, u.name]);
const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0);

// Chrono de chantier : l'heure de départ est gardée sur l'appareil, l'arrêt ouvre la saisie d'heures.
const chronoKey = (id) => `chrono:${id}`;
const chronoStart = (id) => { try { return Number(localStorage.getItem(chronoKey(id))) || null; } catch { return null; } };
const fmtDuree = (ms) => { const m = Math.floor(ms / 60000); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };

export function chantierForm(c = {}, { onSaved } = {}) {
  const fields = [
    { name: 'nom', label: 'Nom du chantier', required: true, full: true, placeholder: 'Ex. Salle de bain Martin' },
    { name: 'clientId', label: 'Client', type: 'select', options: clientOpts(), empty: '— Choisir —' },
    { name: 'statut', label: 'Statut', type: 'select', options: Object.entries(STATUTS.chantier).map(([k, [l]]) => [k, l]), default: 'planifie' },
    { name: 'adresse', label: 'Adresse du chantier', full: true },
    { name: 'cp', label: 'Code postal' }, { name: 'ville', label: 'Ville' },
    { name: 'typeTravaux', label: 'Type de travaux', list: TYPES_TRAVAUX },
    { name: 'surface', label: 'Surface (m²)', type: 'number' },
    { name: 'dateDebut', label: 'Début', type: 'date' }, { name: 'dateFin', label: 'Fin prévue', type: 'date' },
    { name: 'responsableId', label: 'Responsable', type: 'select', options: userOpts(), empty: '—' },
    { name: 'heuresPrevues', label: 'Heures prévues', type: 'number', help: 'Temps de travail estimé, toutes personnes confondues.' },
    ...(app.can('ca', 2) ? [
      { name: 'prixHT', label: 'Montant du chantier HT (€)', type: 'number', help: 'Montant du devis accepté. Compte dans le chiffre d’affaires quand le chantier est terminé.' },
    ] : []),
    { name: 'avancement', label: 'Avancement', type: 'range', full: true },
    { name: 'acces', label: 'Accès, codes, contraintes', type: 'textarea', full: true, rows: 2, placeholder: 'Digicode, stationnement, horaires, présence animaux…' },
    { name: 'notes', label: 'Description des travaux', type: 'textarea', full: true },
  ];
  formModal({
    title: c.id ? 'Modifier le chantier' : 'Nouveau chantier', fields, data: c, wide: true,
    onSubmit: async (v) => {
      if (v.statut === 'termine' && !c.dateFinReelle) v.dateFinReelle = todayISO();
      const r = await store.save('chantier', { ...c, ...v });
      toast(c.id ? 'Chantier mis à jour.' : 'Chantier créé.');
      onSaved ? onSaved(r) : (!c.id && app.go(`#/chantier/${r.id}`));
    },
    onDelete: c.id && app.can('chantiers', 3) ? async () => { await store.remove(c.id); toast('Chantier supprimé.'); app.go('#/chantiers'); } : null,
  });
}

async function addPhotos(chantierId, phase = 'pendant') {
  const imgs = await pickImages({ multiple: true });
  for (const dataUrl of imgs) await store.save('photo', { chantierId, dataUrl, phase, date: todayISO(), legende: '' }).catch(toastError);
  if (imgs.length) toast(`${imgs.length} photo(s) ajoutée(s)${navigator.onLine ? '' : ' — envoi à la reconnexion'}.`);
}

const FILTERS = [['tous', 'Tous'], ['en_cours', 'En cours'], ['planifie', 'Planifiés'], ['prospect', 'Prospects'], ['risque', 'À risque'], ['en_pause', 'En pause'], ['termine', 'Terminés']];

export default {
  list: {
    title: 'Chantiers',
    render({ query }) {
      const recs = store.grouped();
      const f = query.f || 'tous';
      const q = (query.q || '').toLowerCase();
      const rows = recs.chantier.map((c) => ({ c, r: chantierRisque(c) }));
      const count = (k) => k === 'tous' ? rows.filter((x) => x.c.statut !== 'annule').length : k === 'risque' ? rows.filter((x) => ['eleve', 'moyen'].includes(x.r.niveau)).length : rows.filter((x) => x.c.statut === k).length;
      let list = rows.filter((x) => f === 'tous' ? x.c.statut !== 'annule' : f === 'risque' ? ['eleve', 'moyen'].includes(x.r.niveau) : x.c.statut === f);
      if (q) list = list.filter((x) => `${x.c.nom} ${x.c.ref} ${x.c.ville} ${store.get(x.c.clientId)?.nom || ''}`.toLowerCase().includes(q));
      const order = { en_cours: 0, planifie: 1, en_pause: 2, prospect: 3, termine: 4, annule: 5 };
      list.sort((a, b) => (order[a.c.statut] ?? 9) - (order[b.c.statut] ?? 9) || (a.c.dateDebut || '').localeCompare(b.c.dateDebut || ''));
      return `<div class="page-head"><div><h1>Chantiers</h1><p>${count('en_cours')} en cours · ${count('planifie')} planifiés</p></div>
        <div class="actions">${app.can('chantiers', 2) ? `<button class="btn" id="photo-btn">${icon('camera')}<span class="lbl">Photo</span></button><button class="btn primary" id="new-btn">${icon('plus')}Nouveau chantier</button>` : ''}</div></div>
        <div class="row wrap" style="margin-bottom:16px;gap:10px">
          <div class="search grow" style="min-width:220px;max-width:360px">${icon('search')}<input class="input" id="q" placeholder="Rechercher un chantier, un client, une ville" value="${esc(query.q || '')}"></div>
          <div class="chips">${FILTERS.map(([k, l]) => `<button class="chip ${f === k ? 'active' : ''}" data-f="${k}">${l} <span class="n">${count(k)}</span></button>`).join('')}</div>
        </div>
        ${list.length ? `<div class="cards">${list.map(({ c, r }) => `<a class="card site-card" href="#/chantier/${c.id}">
          <div class="row between"><span class="ref">${esc(c.ref || '')}</span><div class="row" style="gap:6px">${r.niveau === 'eleve' || r.niveau === 'moyen' ? badge('risque', r.niveau) : ''}${badge('chantier', c.statut)}</div></div>
          <div><h3 style="font-size:16px">${esc(c.nom)}</h3><div class="small muted">${esc(store.get(c.clientId)?.nom || 'Client non renseigné')}</div></div>
          <div class="meta">${c.ville ? `<span>${icon('pin')}${esc(c.ville)}</span>` : ''}${c.dateDebut ? `<span>${icon('calendar')}${fmtShort(c.dateDebut)} → ${fmtShort(c.dateFin)}</span>` : ''}${c.surface ? `<span>${number(c.surface)} m²</span>` : ''}</div>
          <div><div class="row between small" style="margin-bottom:6px"><span class="muted">Avancement</span><b class="num">${num(c.avancement)} %</b></div><div class="progress ${r.niveau === 'eleve' ? 'red' : num(c.avancement) >= 100 ? 'green' : ''}"><i style="width:${num(c.avancement)}%"></i></div></div>
        </a>`).join('')}</div>` : `<div class="card empty">${icon('site')}<b>Aucun chantier</b>${f === 'tous' && !q ? 'Créez votre premier chantier pour commencer le suivi.' : 'Aucun résultat pour ce filtre.'}</div>`}`;
    },
    mount(root, { query }) {
      const upd = (k, v) => { const p = new URLSearchParams(query); v ? p.set(k, v) : p.delete(k); history.replaceState(null, '', `#/chantiers?${p}`); dispatchEvent(new HashChangeEvent('hashchange')); };
      qsa('[data-f]', root).forEach((b) => b.addEventListener('click', () => upd('f', b.dataset.f === 'tous' ? '' : b.dataset.f)));
      const q = qs('#q', root);
      let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { upd('q', q.value); }, 300); });
      if (query.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      qs('#new-btn', root)?.addEventListener('click', () => chantierForm());
      const photo = () => {
        const actifs = store.all('chantier').filter((c) => ['en_cours', 'planifie', 'en_pause'].includes(c.statut));
        if (!actifs.length) return toast('Aucun chantier actif.', 'error');
        const m = modal({ title: 'Photo — quel chantier ?', body: `<div class="list card">${actifs.map((c) => `<button class="li click" style="width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line)" data-id="${c.id}"><span class="ic">${icon('camera')}</span><div class="grow"><div class="t">${esc(c.nom)}</div><div class="s">${esc(c.ville || '')}</div></div></button>`).join('')}</div>` });
        qsa('[data-id]', m.el).forEach((b) => b.addEventListener('click', () => { m.close(); addPhotos(b.dataset.id); }));
      };
      qs('#photo-btn', root)?.addEventListener('click', photo);
      if (query.nouveau) { history.replaceState(null, '', '#/chantiers'); chantierForm(); }
      if (query.photo) { history.replaceState(null, '', '#/chantiers'); photo(); }
    },
  },

  fromChild: {
    title: 'Chantier',
    render: ({ params }) => { const r = store.get(params.id); setTimeout(() => app.go(!r?.chantierId && r?.visiteId ? `#/visite/${r.visiteId}` : r?.chantierId ? `#/chantier/${r.chantierId}?tab=${r.type === 'photo' ? 'photos' : 'journal'}` : '#/chantiers')); return ''; },
  },

  detail: {
    title: ({ params }) => store.get(params.id)?.nom || 'Chantier',
    render({ params, query }) {
      const c = store.get(params.id);
      if (!c) return `<div class="empty card">${icon('site')}<b>Chantier introuvable</b><a class="btn" href="#/chantiers">Retour</a></div>`;
      const recs = store.grouped();
      const r = chantierRisque(c);
      const client = store.get(c.clientId);
      const tab = query.tab === 'couts' ? 'heures' : query.tab || 'apercu';
      const taches = recs.tache.filter((t) => t.chantierId === c.id);
      const photos = recs.photo.filter((p) => p.chantierId === c.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const notes = recs.note.filter((n) => n.chantierId === c.id).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b._createdAt || 0) - (a._createdAt || 0));
      const heures = recs.pointage.filter((p) => p.chantierId === c.id);
      const totalHeures = round2(heures.reduce((n, p) => n + num(p.heures), 0));
      const tachesOuvertes = taches.filter((t) => t.statut !== 'fait');
      const canMoney = app.can('ca', 1);
      const temps = tempsChantier(c, heures);
      const devisList = canMoney ? recs.devis.filter((d) => d.chantierId === c.id).sort((a, b) => (b.date || '').localeCompare(a.date || '')) : [];
      const chrono = chronoStart(c.id);
      const tabs = [['apercu', 'Aperçu'], ['taches', `Tâches (${tachesOuvertes.length})`], ['photos', `Photos (${photos.length})`], ['journal', `Journal (${notes.length})`],
        ['heures', `Heures (${number(totalHeures)} h)`], ...(canMoney ? [['devis', `Devis (${devisList.length})`]] : []), ['historique', 'Historique']];

      let body = '';
      if (tab === 'apercu') {
        body = `<div class="grid g3">
          <div class="card card-pad stack span2" style="gap:14px">
            <div class="row between"><h2>Avancement</h2><b class="num" style="font-size:22px">${num(c.avancement)} %</b></div>
            ${app.can('chantiers', 2) ? `<input type="range" min="0" max="100" step="5" value="${num(c.avancement)}" id="avancement">` : `<div class="progress"><i style="width:${num(c.avancement)}%"></i></div>`}
            ${r.raisons.length ? `<div class="alert-box ${r.niveau === 'eleve' ? 'red' : ''}">${icon('alert')}<div><b>${r.niveau === 'eleve' ? 'Risque élevé' : 'Points d’attention'}</b><br>${r.raisons.map(esc).join('<br>')}</div></div>` : ''}
            <dl class="kv">
              <dt>Client</dt><dd>${client ? `<a href="#/client/${client.id}" style="text-decoration:underline">${esc(client.nom)}</a>${client.tel ? ` · <a href="tel:${esc(client.tel)}">${esc(client.tel)}</a>` : ''}` : '—'}</dd>
              <dt>Adresse</dt><dd>${esc([c.adresse, c.cp, c.ville].filter(Boolean).join(', ')) || '—'}${c.adresse || c.ville ? ` · <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([c.adresse, c.cp, c.ville].filter(Boolean).join(' '))}" style="text-decoration:underline">Itinéraire</a>` : ''}</dd>
              <dt>Période</dt><dd>${fmtDate(c.dateDebut)} → ${fmtDate(c.dateFin)}${c.dateFinReelle ? ` (terminé le ${fmtDate(c.dateFinReelle)})` : ''}</dd>
              <dt>Travaux</dt><dd>${esc(c.typeTravaux || '—')}${c.surface ? ` · ${number(c.surface)} m²` : ''}</dd>
              <dt>Responsable</dt><dd>${esc(store.userName(c.responsableId))}</dd>
              ${c.acces ? `<dt>Accès</dt><dd>${esc(c.acces)}</dd>` : ''}
              ${c.notes ? `<dt>Description</dt><dd style="white-space:pre-wrap">${esc(c.notes)}</dd>` : ''}
            </dl>
          </div>
          <div class="card card-pad stack" style="gap:10px">
            <h2>Suivi</h2>
            <a class="row between" href="#/chantier/${c.id}?tab=taches"><span class="muted">Tâches restantes</span><b class="num">${tachesOuvertes.length} / ${taches.length}</b></a>
            ${tachesOuvertes.some((t) => t.echeance && t.echeance < todayISO()) ? `<div class="row between"><span class="muted">Tâches en retard</span><b class="num" style="color:var(--red-ink)">${tachesOuvertes.filter((t) => t.echeance && t.echeance < todayISO()).length}</b></div>` : ''}
            <a class="row between" href="#/chantier/${c.id}?tab=heures"><span class="muted">Heures pointées</span><b class="num">${number(totalHeures)} h${num(c.heuresPrevues) ? ` / ${number(c.heuresPrevues)} h prévues` : ''}</b></a>
            ${canMoney ? `<a class="row between" href="#/chantier/${c.id}?tab=devis"><span class="muted">Montant HT</span><b class="num">${num(c.prixHT) ? eur(c.prixHT) : '—'}</b></a>` : ''}
            <a class="row between" href="#/chantier/${c.id}?tab=photos"><span class="muted">Photos</span><b class="num">${photos.length}</b></a>
            <a class="row between" href="#/chantier/${c.id}?tab=journal"><span class="muted">Entrées de journal</span><b class="num">${notes.length}</b></a>
            ${notes[0] ? `<div class="hr" style="margin:4px 0"></div><div class="small"><div class="muted" style="margin-bottom:4px">Dernière note · ${fmtShort(notes[0].date)}</div><div style="white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(notes[0].texte)}</div></div>` : ''}
          </div>
        </div>
        ${photos.length ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>Dernières photos</h2><a class="card-link" href="#/chantier/${c.id}?tab=photos">Tout voir →</a></div><div class="card-body"><div class="photos">${photos.slice(0, 6).map(photoTile).join('')}</div></div></div>` : ''}`;
      }
      if (tab === 'taches') {
        const order = { a_faire: 0, en_cours: 1, fait: 2 };
        body = `<div class="card"><div class="card-head"><h2>Tâches</h2>${app.can('planning', 2) ? `<button class="btn sm dark" id="add-tache">${icon('plus')}Tâche</button>` : ''}</div>
          <div class="list">${taches.sort((a, b) => order[a.statut] - order[b.statut] || (a.echeance || '9').localeCompare(b.echeance || '9')).map((t) => `<div class="li click" data-tache="${t.id}">
            <input type="checkbox" data-done="${t.id}" ${t.statut === 'fait' ? 'checked' : ''} ${app.can('planning', 2) ? '' : 'disabled'} aria-label="Terminée">
            <div class="grow"><div class="t" style="${t.statut === 'fait' ? 'text-decoration:line-through;color:var(--ink-3)' : ''}">${esc(t.titre)}</div><div class="s">${t.echeance ? `${t.echeance < todayISO() && t.statut !== 'fait' ? '<b style="color:var(--red-ink)">En retard</b> · ' : ''}${fmtShort(t.echeance)}` : 'Sans échéance'} · ${esc(store.userName(t.assigneId))}</div></div>
            ${t.priorite === 'haute' ? '<span class="badge red">Prioritaire</span>' : ''}${badge('tache', t.statut)}</div>`).join('') || '<div class="empty small">Aucune tâche.</div>'}</div></div>`;
      }
      if (tab === 'photos') {
        body = `<div class="card"><div class="card-head"><h2>Photos</h2>${app.can('chantiers', 2) ? `<div class="actions"><select class="input sm" id="phase" style="width:auto">${options([['avant', 'Avant'], ['pendant', 'Pendant'], ['apres', 'Après']], 'pendant')}</select><button class="btn sm primary" id="add-photo">${icon('camera')}Ajouter</button></div>` : ''}</div>
          <div class="card-body">${photos.length ? ['avant', 'pendant', 'apres'].map((ph) => { const l = photos.filter((p) => (p.phase || 'pendant') === ph); return l.length ? `<h3 style="margin:4px 0 10px">${{ avant: 'Avant travaux', pendant: 'En cours', apres: 'Après travaux' }[ph]}</h3><div class="photos" style="margin-bottom:18px">${l.map(photoTile).join('')}</div>` : ''; }).join('') : `<div class="empty">${icon('image')}<b>Aucune photo</b>Prenez des photos avant, pendant et après les travaux : elles servent de preuve et de vitrine.</div>`}</div></div>`;
      }
      if (tab === 'journal') {
        body = `<div class="card"><div class="card-head"><h2>Journal de chantier</h2></div>
          ${app.can('chantiers', 2) ? `<div class="card-body"><form id="note-form" class="stack" style="gap:10px"><textarea class="input" name="texte" rows="3" placeholder="Ce qui a été fait aujourd’hui, problèmes rencontrés, informations client…" required></textarea><div class="row between"><input class="input sm" type="date" name="date" value="${todayISO()}" style="width:auto"><button class="btn sm dark">${icon('note')}Ajouter au journal</button></div></form></div>` : ''}
          <div class="list">${notes.map((n) => `<div class="li" style="align-items:flex-start"><span class="avatar sm">${esc((store.userName(n._createdBy) || '?')[0])}</span><div class="grow"><div class="s">${fmtDate(n.date)} · ${esc(store.userName(n._createdBy))}</div><div style="white-space:pre-wrap;margin-top:4px">${esc(n.texte)}</div></div>${app.can('chantiers', 3) ? `<button class="btn ghost sm icon-only" data-del-note="${n.id}" aria-label="Supprimer">${icon('trash')}</button>` : ''}</div>`).join('') || '<div class="empty small">Aucune entrée pour l’instant.</div>'}</div></div>`;
      }
      if (tab === 'heures') {
        const parUser = {};
        for (const p of heures) parUser[p.userId] = (parUser[p.userId] || 0) + num(p.heures);
        body = `<div class="grid g3">
          <div class="card span2"><div class="card-head"><h2>Heures pointées · ${number(totalHeures)} h</h2>${app.can('planning', 2) ? `<button class="btn sm dark" id="add-h">${icon('clock')}Heures</button>` : ''}</div><div class="list">${heures.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((p) => `<div class="li click" data-h="${p.id}"><div class="grow"><div class="t">${esc(store.userName(p.userId))}</div><div class="s">${fmtDate(p.date)}${p.commentaire ? ' · ' + esc(p.commentaire) : ''}</div></div><b class="num">${number(p.heures)} h</b></div>`).join('') || '<div class="empty small">Aucune heure saisie.</div>'}</div></div>
          <div class="stack" style="gap:16px">
          <div class="card card-pad stack" style="gap:10px"><h2>Temps</h2>
            <div class="row between"><span class="muted">Heures pointées</span><b class="num">${number(temps.heures)} h</b></div>
            <div class="row between"><span class="muted">Heures prévues</span><b class="num">${temps.prevues ? number(temps.prevues) + ' h' : '—'}</b></div>
            ${temps.depassementPct != null ? `<div><div class="small muted" style="margin-bottom:6px">${number(temps.depassementPct)} % du temps prévu · avancement ${num(c.avancement)} %</div><div class="progress ${temps.depassementPct > 100 ? 'red' : temps.depassementPct > num(c.avancement) + 15 ? 'amber' : ''}"><i style="width:${Math.min(100, temps.depassementPct)}%"></i></div></div>` : ''}
            ${temps.heuresFinEstimees != null ? `<div class="row between"><span class="muted">Estimation à la fin</span><b class="num">≈ ${number(Math.round(temps.heuresFinEstimees))} h</b></div><p class="tiny muted" style="margin:0">D’après l’avancement : si 40 % du chantier a pris 20 h, il en faudra environ 50.</p>` : ''}
          </div>
          <div class="card"><div class="card-head"><h2>Par personne</h2></div><div class="list">${Object.entries(parUser).sort((a, b) => b[1] - a[1]).map(([u, n]) => `<div class="li"><span class="avatar sm">${esc(store.userName(u)[0])}</span><div class="grow t">${esc(store.userName(u))}</div><b class="num">${number(n)} h</b></div>`).join('') || '<div class="empty small">—</div>'}</div></div>
          </div>
        </div>`;
      }
      if (tab === 'devis' && canMoney) {
        const canW = app.can('ca', 2);
        const acceptes = devisList.filter((d) => d.statut === 'accepte');
        body = `<div class="card"><div class="card-head"><h2>Devis</h2><div class="actions">${canW ? `<a class="btn sm" href="#/outils?chantier=${c.id}">${icon('calc')}<span class="lbl">Chiffrer</span></a><button class="btn sm primary" id="import-devis">${icon('download')}Importer un devis</button>` : ''}</div></div>
          <div class="list">${devisList.map((d) => `<div class="li ${canW ? 'click' : ''}" data-devis="${d.id}"><span class="ic">${icon(d.mime === 'application/pdf' ? 'quote' : 'image')}</span><div class="grow"><div class="t">${esc(d.numero ? 'Devis ' + d.numero : d.nomFichier || 'Devis')}</div><div class="s">${d.date ? fmtDate(d.date) + ' · ' : ''}${esc(d.objet || d.nomFichier || '')}</div></div>
            <b class="num">${d.montantHT != null ? eur(d.montantHT) + ' HT' : '—'}</b>${badge('devis', d.statut || 'envoye')}
            ${d.blobId ? `<a class="btn ghost sm icon-only" href="api/blobs/${esc(d.blobId)}" target="_blank" rel="noopener" data-open title="Ouvrir le fichier">${icon('chevron')}</a>` : ''}</div>`).join('') || `<div class="empty">${icon('quote')}<b>Aucun devis</b>Importez le devis que vous avez fait (PDF ou photo) : le montant est lu automatiquement quand c’est possible.</div>`}</div>
          ${acceptes.length ? `<div class="card-body small muted">Montant du chantier : <b style="color:var(--ink)">${eur(c.prixHT)}</b> HT · somme des devis acceptés : ${eur(acceptes.reduce((s, d) => s + num(d.montantHT), 0))} HT</div>` : ''}
        </div>`;
      }
      if (tab === 'historique') body = `<div class="card card-pad" id="hist"><div class="empty small">Chargement…</div></div>`;

      return `<div class="page-head">
          <div><div class="row" style="gap:8px;margin-bottom:6px"><a class="btn ghost sm" href="#/chantiers">${icon('back')}Chantiers</a><span class="tiny muted" style="font-weight:600">${esc(c.ref || '')}</span>${badge('chantier', c.statut)}${r.niveau === 'eleve' || r.niveau === 'moyen' ? badge('risque', r.niveau) : ''}</div><h1>${esc(c.nom)}</h1></div>
          <div class="actions">
            ${app.can('planning', 2) ? `<button class="btn ${chrono ? 'dark' : ''}" id="chrono">${icon('clock')}<span class="lbl" id="chrono-lbl">${chrono ? `Arrêter · ${fmtDuree(Date.now() - chrono)}` : 'Chrono'}</span></button>` : ''}
            <button class="btn" id="report">${icon('print')}<span class="lbl">Dossier PDF</span></button>
            ${app.can('chantiers', 2) ? `<button class="btn" id="edit">${icon('edit')}<span class="lbl">Modifier</span></button><button class="btn primary" id="quick-photo">${icon('camera')}Photo</button>` : ''}
          </div></div>
        <div class="tabs">${tabs.map(([k, l]) => `<a class="tab ${tab === k ? 'active' : ''}" href="#/chantier/${c.id}?tab=${k}">${l}</a>`).join('')}</div>
        <div class="fade-in">${body}</div>`;
    },
    mount(root, { params, query }) {
      const c = store.get(params.id);
      if (!c) return;
      qs('#edit', root)?.addEventListener('click', () => chantierForm(c));
      qs('#quick-photo', root)?.addEventListener('click', () => addPhotos(c.id));
      qs('#add-photo', root)?.addEventListener('click', () => addPhotos(c.id, qs('#phase', root).value));
      qs('#report', root).addEventListener('click', () => {
        const parts = partiesDossier(store.get(c.id), { money: app.can('ca', 1) });
        const m = modal({
          title: 'Dossier du chantier (PDF)',
          body: `<div class="stack"><p class="small muted" style="margin:0">Choisissez ce qui doit figurer dans le dossier. Le fichier PDF est créé sur l’appareil, puis vous pouvez le télécharger, l’enregistrer ou l’envoyer.</p>
            <div class="stack" style="gap:10px">${parts.map(([k, l, n, on]) => `<label class="check"><input type="checkbox" name="${k}" ${on ? 'checked' : ''}> ${esc(l)}${k !== 'infos' && k !== 'reception' ? ` <span class="muted small">(${n})</span>` : ''}</label>`).join('')}</div>
            ${parts.some(([k]) => k === 'photos') ? `<label class="field"><span>Taille des photos</span><select class="input" name="ppl">${options([['2', 'Grandes (2 par ligne)'], ['3', 'Moyennes (3 par ligne)'], ['4', 'Petites (4 par ligne)']], '2')}</select></label>` : ''}</div>`,
          foot: `<button class="btn" data-close>Annuler</button><button class="btn primary" id="go-pdf">${icon('download')}Créer le PDF</button>`,
        });
        qs('#go-pdf', m.el).addEventListener('click', () => {
          const choix = Object.fromEntries(parts.map(([k]) => [k, qs(`[name="${k}"]`, m.el).checked]));
          const ppl = Number(qs('[name=ppl]', m.el)?.value) || 2;
          m.close();
          pdfDossierChantier(store.get(c.id), choix, { photosParLigne: ppl });
        });
      });
      const range = qs('#avancement', root);
      if (range) {
        range.addEventListener('input', () => { root.querySelector('.num').textContent = `${range.value} %`; });
        range.addEventListener('change', async () => {
          const v = Number(range.value);
          const patch = { ...c, avancement: v };
          if (v === 100 && c.statut === 'en_cours' && await confirmDialog('Avancement à 100 %. Marquer le chantier comme terminé ?', { ok: 'Marquer terminé' })) { patch.statut = 'termine'; patch.dateFinReelle = todayISO(); }
          if (v > 0 && c.statut === 'planifie') patch.statut = 'en_cours';
          store.save('chantier', patch).then(() => toast('Avancement enregistré.')).catch(toastError);
        });
      }
      qs('#add-tache', root)?.addEventListener('click', () => tacheForm({ chantierId: c.id }));
      qsa('[data-tache]', root).forEach((el) => el.addEventListener('click', (e) => { if (e.target.matches('input')) return; tacheForm(store.get(el.dataset.tache)); }));
      qsa('[data-done]', root).forEach((cb) => cb.addEventListener('change', () => { const t = store.get(cb.dataset.done); store.save('tache', { ...t, statut: cb.checked ? 'fait' : 'a_faire', faitLe: cb.checked ? todayISO() : null }).catch(toastError); }));
      qsa('.photo', root).forEach((el) => el.addEventListener('click', () => photoDetail(store.get(el.dataset.photo))));
      qs('#note-form', root)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        if (!f.texte.value.trim()) return;
        await store.save('note', { chantierId: c.id, texte: f.texte.value.trim(), date: f.date.value || todayISO() }).catch(toastError);
        toast('Ajouté au journal.');
      });
      qsa('[data-del-note]', root).forEach((b) => b.addEventListener('click', async () => { if (await confirmDialog('Supprimer cette entrée du journal ?', { danger: true, ok: 'Supprimer' })) store.remove(b.dataset.delNote).catch(toastError); }));
      qs('#add-h', root)?.addEventListener('click', () => pointageForm({ chantierId: c.id }));
      qsa('[data-h]', root).forEach((el) => el.addEventListener('click', () => pointageForm(store.get(el.dataset.h))));
      if (query.tab === 'historique') auditTimeline(qs('#hist', root), { type: 'chantier', id: c.id });
      qs('#import-devis', root)?.addEventListener('click', () => devisForm({ chantierId: c.id }));
      qsa('[data-devis]', root).forEach((el) => el.addEventListener('click', (e) => { if (e.target.closest('[data-open]') || !app.can('ca', 2)) return; devisForm(store.get(el.dataset.devis)); }));
      let tick;
      const chronoBtn = qs('#chrono', root);
      if (chronoBtn) {
        const start = chronoStart(c.id);
        if (start) tick = setInterval(() => { const l = qs('#chrono-lbl', root); if (l) l.textContent = `Arrêter · ${fmtDuree(Date.now() - start)}`; }, 30000);
        chronoBtn.addEventListener('click', () => {
          const s0 = chronoStart(c.id);
          if (!s0) {
            try { localStorage.setItem(chronoKey(c.id), String(Date.now())); } catch {}
            toast('Chrono démarré. Appuyez sur « Arrêter » en fin de journée.');
          } else {
            try { localStorage.removeItem(chronoKey(c.id)); } catch {}
            const h = Math.max(0.25, Math.round(((Date.now() - s0) / 3600000) * 4) / 4);
            pointageForm({ chantierId: c.id, heures: h, commentaire: 'Chrono' });
          }
          app.go(location.hash);
        });
      }
      return () => clearInterval(tick);
    },
  },
};

function photoTile(p) {
  return `<div class="photo" data-photo="${p.id}"><img loading="lazy" src="${esc(photoSrc(p))}" alt="${esc(p.legende || 'Photo de chantier')}">${p._pending ? '<span class="tag badge amber">En attente</span>' : ''}<div class="cap">${esc(p.legende || fmtShort(p.date))}</div></div>`;
}

function photoDetail(p) {
  if (!p) return;
  const m = modal({
    title: 'Photo', wide: true,
    body: `<img src="${esc(photoSrc(p))}" style="width:100%;max-height:60vh;object-fit:contain;border-radius:12px;background:#000;cursor:zoom-in" id="pz">
      <form class="form" style="margin-top:14px"><label class="field full"><span>Légende</span><input class="input" name="legende" value="${esc(p.legende || '')}"></label>
      <label class="field"><span>Étape</span><select class="input" name="phase">${options([['avant', 'Avant'], ['pendant', 'Pendant'], ['apres', 'Après']], p.phase || 'pendant')}</select></label>
      <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${esc(p.date || '')}"></label></form>
      <p class="tiny muted">Ajoutée par ${esc(store.userName(p._createdBy))}${p._createdAt ? ' ' + relTime(p._createdAt) : ''}</p>`,
    foot: `${app.can('chantiers', 3) ? `<button class="btn ghost danger left" data-del>${icon('trash')}Supprimer</button>` : ''}<button class="btn" data-close>Fermer</button>${app.can('chantiers', 2) ? '<button class="btn primary" data-save>Enregistrer</button>' : ''}`,
  });
  qs('#pz', m.el).addEventListener('click', () => lightbox(photoSrc(p), p.legende));
  qs('[data-save]', m.el)?.addEventListener('click', async () => {
    const f = qs('form', m.el);
    await store.save('photo', { ...p, legende: f.legende.value.trim(), phase: f.phase.value, date: f.date.value }).catch(toastError);
    m.close();
  });
  qs('[data-del]', m.el)?.addEventListener('click', async () => { if (await confirmDialog('Supprimer cette photo ?', { danger: true, ok: 'Supprimer' })) { await store.remove(p.id).catch(toastError); m.close(); } });
}

// ---------- Devis importés ----------
const DEVIS_FIELDS = [
  { name: 'numero', label: 'N° du devis' }, { name: 'date', label: 'Date', type: 'date' },
  { name: 'objet', label: 'Objet', full: true },
  { name: 'montantHT', label: 'Montant HT (€)', type: 'number', step: 0.01 }, { name: 'montantTTC', label: 'Montant TTC (€)', type: 'number', step: 0.01 },
  { name: 'statut', label: 'Statut', type: 'select', options: [['envoye', 'Envoyé, en attente'], ['accepte', 'Accepté (signé)'], ['refuse', 'Refusé']], default: 'envoye' },
  { name: 'majPrix', label: 'Mettre à jour le montant du chantier avec les devis acceptés', type: 'checkbox', full: true, default: true },
];

const readAsDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Fichier illisible.')); r.readAsDataURL(file); });

/** Importer (ou modifier) un devis fait ailleurs : PDF ou photo, montants lus automatiquement si possible. */
export function devisForm(d = {}) {
  let fichier = null;
  const m = modal({
    title: d.id ? 'Devis' : 'Importer un devis', wide: true,
    body: `${d.id ? '' : `<div class="drop" id="drop"><input type="file" id="file" accept="application/pdf,image/*" hidden>
        <button type="button" class="btn" id="pick">${icon('download')}Choisir le devis (PDF ou photo)</button>
        <div class="small muted" id="file-st" style="margin-top:8px">Le numéro, la date et les montants sont lus automatiquement dans un PDF. Vérifiez-les avant d’enregistrer.</div></div>`}
      <form class="form" id="dv" style="margin-top:14px">${DEVIS_FIELDS.map((f) => fieldHtml(f, d)).join('')}</form>`,
    foot: `${d.id && app.can('ca', 3) ? `<button class="btn ghost danger left" data-del>${icon('trash')}<span>Supprimer</span></button>` : ''}<button class="btn" data-close>Annuler</button><button class="btn primary" data-save>Enregistrer</button>`,
  });
  const f = qs('#dv', m.el);
  const set = (k, v) => { if (v != null && v !== '' && f.elements[k] && !f.elements[k].value) f.elements[k].value = v; };
  qs('#pick', m.el)?.addEventListener('click', () => qs('#file', m.el).click());
  qs('#file', m.el)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const st = qs('#file-st', m.el);
    try {
      if (file.type === 'application/pdf') {
        if (file.size > 12 * 1024 * 1024) throw new Error('PDF trop lourd (12 Mo max).');
        fichier = { dataUrl: await readAsDataUrl(file), nom: file.name };
        st.textContent = 'Lecture du PDF…';
        const info = lireDevis(await pdfText(new Uint8Array(await file.arrayBuffer())).catch(() => ''));
        set('numero', info.numero); set('date', info.date); set('objet', info.objet); set('montantHT', info.montantHT); set('montantTTC', info.montantTTC);
        const lus = ['numero', 'date', 'montantHT', 'montantTTC'].filter((k) => info[k] != null).length;
        st.innerHTML = `<b>${esc(file.name)}</b> · ${lus ? `${lus} information(s) lue(s) automatiquement, vérifiez-les.` : 'aucun texte lisible (PDF scanné ?) : saisissez les montants.'}`;
      } else {
        fichier = { dataUrl: await compressImage(file, 2200, 0.85), nom: file.name };
        st.innerHTML = `<b>${esc(file.name)}</b> · photo jointe : saisissez le montant.`;
      }
    } catch (err) { fichier = null; st.textContent = err.message; toastError(err); }
  });
  qs('[data-save]', m.el).addEventListener('click', async () => {
    const v = readForm(f, DEVIS_FIELDS);
    if (!d.id && !fichier) return toast('Choisissez le fichier du devis.', 'error');
    const { majPrix, ...data } = v;
    const btn = qs('[data-save]', m.el); btn.disabled = true;
    try {
      await store.save('devis', { ...d, ...data, ...(fichier ? { dataUrl: fichier.dataUrl, nomFichier: fichier.nom } : {}) });
      if (majPrix) {
        const c = store.get(d.chantierId);
        const total = round2(store.all('devis').filter((x) => x.chantierId === d.chantierId && x.statut === 'accepte').reduce((s, x) => s + num(x.montantHT), 0));
        if (c && total > 0 && total !== num(c.prixHT)) await store.save('chantier', { ...c, prixHT: total });
      }
      toast(navigator.onLine ? 'Devis enregistré.' : 'Devis enregistré — envoi à la reconnexion.');
      m.close();
    } catch (err) { toastError(err); } finally { btn.disabled = false; }
  });
  qs('[data-del]', m.el)?.addEventListener('click', async () => {
    if (await confirmDialog('Supprimer ce devis ?', { danger: true, ok: 'Supprimer' })) { await store.remove(d.id).catch(toastError); m.close(); }
  });
}

export { addPhotos, clientOpts, userOpts };
