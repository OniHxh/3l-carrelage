import { esc, icon, fmtDate, fmtShort, badge, number, qs, qsa, STATUTS } from '../core.js';
import * as store from '../store.js';
import { app } from '../app.js';
import { formModal, toast, toastError, options } from '../ui.js';
import { barres } from './ca.js';
import { todayISO, addDays, num } from '../../shared/calc.js';

const chantierOpts = () => store.all('chantier').filter((c) => c.statut !== 'annule').sort((a, b) => a.nom.localeCompare(b.nom)).map((c) => [c.id, c.nom]);
const userOpts = () => store.getUsers().filter((u) => u.active).map((u) => [u.id, u.name]);

export function tacheForm(t = {}) {
  formModal({
    title: t.id ? 'Modifier la tâche' : 'Nouvelle tâche',
    fields: [
      { name: 'titre', label: 'Tâche', required: true, full: true, placeholder: 'Ex. Commander les plinthes, poser la faïence…' },
      { name: 'chantierId', label: 'Chantier', type: 'select', options: chantierOpts(), empty: '— Aucun —' },
      { name: 'assigneId', label: 'Assignée à', type: 'select', options: userOpts(), empty: '— Personne —', default: app.user.id },
      { name: 'echeance', label: 'Échéance', type: 'date' },
      { name: 'priorite', label: 'Priorité', type: 'select', options: [['basse', 'Basse'], ['normale', 'Normale'], ['haute', 'Haute']], default: 'normale' },
      { name: 'statut', label: 'Statut', type: 'select', options: Object.entries(STATUTS.tache).map(([k, [l]]) => [k, l]), default: 'a_faire' },
      { name: 'details', label: 'Détails', type: 'textarea', full: true, rows: 2 },
    ],
    data: t,
    onSubmit: async (v) => { await store.save('tache', { ...t, ...v, faitLe: v.statut === 'fait' ? t.faitLe || todayISO() : null }); toast('Tâche enregistrée.'); },
    onDelete: t.id && app.can('planning', 3) ? () => store.remove(t.id) : null,
  });
}

export function pointageForm(p = {}) {
  formModal({
    title: p.id ? 'Modifier les heures' : 'Saisir des heures',
    fields: [
      { name: 'userId', label: 'Personne', type: 'select', options: userOpts(), default: app.user.id, required: true },
      { name: 'chantierId', label: 'Chantier', type: 'select', options: chantierOpts(), empty: '— Choisir —', required: true },
      { name: 'date', label: 'Date', type: 'date', default: todayISO(), required: true },
      { name: 'heures', label: 'Heures', type: 'number', step: 0.25, min: 0, default: 8, required: true },
      { name: 'commentaire', label: 'Commentaire', full: true },
    ],
    data: p,
    onSubmit: async (v) => { await store.save('pointage', { ...p, ...v }); toast('Heures enregistrées.'); },
    onDelete: p.id && app.can('planning', 3) ? () => store.remove(p.id) : null,
  });
}

export function evenementForm(e = {}) {
  formModal({
    title: e.id ? 'Modifier l’événement' : 'Nouvel événement',
    fields: [
      { name: 'titre', label: 'Intitulé', required: true, full: true, placeholder: 'Ex. Pose faïence, visite technique, livraison carrelage…' },
      { name: 'categorie', label: 'Type', type: 'select', options: [['chantier', 'Intervention chantier'], ['visite', 'Visite / métré'], ['rdv', 'Rendez-vous client'], ['livraison', 'Livraison']], default: 'chantier' },
      { name: 'chantierId', label: 'Chantier', type: 'select', options: chantierOpts(), empty: '— Aucun —' },
      { name: 'date', label: 'Date', type: 'date', default: todayISO(), required: true },
      { name: 'dateFin', label: 'Jusqu’au (facultatif)', type: 'date', help: 'Pour une intervention sur plusieurs jours.' },
      { name: 'heureDebut', label: 'Début', type: 'time', default: '08:00' }, { name: 'heureFin', label: 'Fin', type: 'time', default: '17:00' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 },
    ],
    data: e,
    extra: `<div class="field full"><span>Équipe <small class="muted">(rien de coché = toute l’équipe)</small></span><div class="row wrap" style="gap:8px">${store.getUsers().filter((u) => u.active || (e.userIds || []).includes(u.id)).map((u) => `<label class="chip" style="cursor:pointer"><input type="checkbox" data-team value="${u.id}" ${(e.userIds || []).includes(u.id) ? 'checked' : ''} style="margin-right:6px">${esc(u.name)}</label>`).join('')}</div></div>`,
    onSubmit: async (v, form) => {
      v.userIds = [...form.querySelectorAll('[data-team]:checked')].map((x) => x.value);
      await store.save('evenement', { ...e, ...v }); toast('Planning mis à jour.');
    },
    onDelete: e.id && app.can('planning', 3) ? () => store.remove(e.id) : null,
  });
}

function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00');
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

// ---------- Récapitulatif du planning ----------
const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const PALETTE = ['#2457C5', '#D7263D', '#1F8A4C', '#B26A00', '#7B3FB8', '#0E8A8A', '#C2410C', '#4D5BD6', '#9D174D', '#3F6212'];
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Qui travaille sur quel chantier, jour par jour : planning (événements) + heures pointées. */
function presence(recs, people, from, to) {
  const cells = new Map(); // `${userId}|${date}` -> { chantierId, planifie, heures }
  const put = (u, d, chantierId, k, h = 0) => {
    const key = `${u}|${d}`;
    const c = cells.get(key) || { chantierId: null, planifie: false, heures: 0, titre: '' };
    if (k === 'ev') { c.planifie = true; if (chantierId) c.chantierId = chantierId; } else { c.heures += h; c.chantierId ||= chantierId; }
    cells.set(key, c);
  };
  for (const e of recs.evenement) {
    if (e.categorie && e.categorie !== 'chantier') continue;
    const end = e.dateFin && e.dateFin > e.date ? e.dateFin : e.date;
    if (end < from || e.date > to) continue;
    const who = e.userIds?.length ? e.userIds : people.map((p) => p.id);
    for (let d = e.date < from ? from : e.date; d <= end && d <= to; d = addDays(d, 1)) {
      const wd = new Date(d + 'T12:00:00').getDay();
      if ((wd === 0 || wd === 6) && e.dateFin) continue; // les week-ends ne comptent pas dans une intervention sur plusieurs jours
      for (const u of who) put(u, d, e.chantierId, 'ev');
    }
  }
  for (const p of recs.pointage) if (p.date >= from && p.date <= to) put(p.userId, p.date, p.chantierId, 'pt', num(p.heures));
  return cells;
}

export default {
  recap: {
    title: 'Récap du planning',
    render({ query }) {
      const today = todayISO();
      const y = Number(query.annee || today.slice(0, 4));
      const mo = Number(query.mois || (String(y) === today.slice(0, 4) ? today.slice(5, 7) : 1));
      const recs = store.grouped();
      const people = store.getUsers().filter((u) => u.active);
      const cells = presence(recs, people, `${y}-01-01`, `${y}-12-31`);
      const colors = new Map();
      const colorOf = (id) => { if (!id) return 'var(--ink-3)'; if (!colors.has(id)) colors.set(id, PALETTE[colors.size % PALETTE.length]); return colors.get(id); };
      recs.chantier.slice().sort((a, b) => (a.dateDebut || '').localeCompare(b.dateDebut || '')).forEach((c) => colorOf(c.id));

      // Jours travaillés par mois (somme sur l'équipe) et par personne
      const parMois = Array.from({ length: 12 }, (_, i) => ({ mois: `${y}-${String(i + 1).padStart(2, '0')}`, jours: 0 }));
      const parPersonne = new Map(people.map((p) => [p.id, Array(12).fill(0)]));
      const heuresPers = new Map(people.map((p) => [p.id, Array(12).fill(0)]));
      for (const [key, c] of cells) {
        const [u, d] = key.split('|');
        const m = Number(d.slice(5, 7)) - 1;
        parMois[m].jours++;
        parPersonne.get(u)?.[m] !== undefined && parPersonne.get(u)[m]++;
        if (heuresPers.has(u)) heuresPers.get(u)[m] += c.heures;
      }

      // Grille du mois : personnes × jours
      const nb = daysIn(y, mo);
      const days = Array.from({ length: nb }, (_, i) => iso(y, mo, i + 1));
      const usedCh = new Set();
      const grid = `<div class="pgrid-wrap"><table class="pgrid"><thead><tr><th class="who"></th>${days.map((d) => { const wd = new Date(d + 'T12:00:00').getDay(); return `<th class="${wd === 0 || wd === 6 ? 'we' : ''} ${d === today ? 'today' : ''}"><span>${'DLMMJVS'[wd]}</span>${Number(d.slice(8))}</th>`; }).join('')}<th class="tot">Jours</th><th class="tot">Heures</th></tr></thead>
        <tbody>${people.map((p) => {
          let j = 0, h = 0;
          const tds = days.map((d) => {
            const wd = new Date(d + 'T12:00:00').getDay();
            const c = cells.get(`${p.id}|${d}`);
            if (!c) return `<td class="${wd === 0 || wd === 6 ? 'we' : ''}"></td>`;
            j++; h += c.heures;
            if (c.chantierId) usedCh.add(c.chantierId);
            const ch = store.get(c.chantierId);
            const tip = `${fmtDate(d)} · ${p.name}${ch ? ' · ' + ch.nom : ''}${c.heures ? ` · ${number(c.heures)} h pointées` : ''}${c.planifie ? '' : ' (non planifié)'}`;
            return `<td class="${wd === 0 || wd === 6 ? 'we' : ''}"><a ${ch ? `href="#/chantier/${ch.id}"` : ''} title="${esc(tip)}" class="cell ${c.planifie ? '' : 'pt'}" style="--c:${colorOf(c.chantierId)}">${c.heures ? number(c.heures) : ''}</a></td>`;
          }).join('');
          return `<tr><th class="who"><div class="who-in"><span class="avatar sm" style="background:${esc(p.profile?.couleur || '#171717')}">${esc(p.name[0] || '?')}</span><span>${esc(p.name)}${p.sansCompte ? '<br><span class="tiny muted">sans compte</span>' : ''}</span></div></th>${tds}<td class="tot">${j}</td><td class="tot">${number(h)}</td></tr>`;
        }).join('')}</tbody></table></div>
        <div class="legend" style="margin-top:12px;flex-wrap:wrap">${[...usedCh].map((id) => `<span><i style="background:${colorOf(id)}"></i>${esc(store.get(id)?.nom || 'Chantier')}</span>`).join('')}<span><i style="background:transparent;border:2px solid var(--ink-3)"></i>Heures pointées sans planning</span></div>`;

      const prev = mo === 1 ? `annee=${y - 1}&mois=12` : `annee=${y}&mois=${mo - 1}`;
      const next = mo === 12 ? `annee=${y + 1}&mois=1` : `annee=${y}&mois=${mo + 1}`;
      return `<div class="page-head"><div><h1>Récap du planning</h1><p>Jours de chantier et heures, par mois et par personne.</p></div>
          <div class="actions"><select class="input" id="annee" style="width:auto">${options([y - 2, y - 1, y, y + 1].map((a) => [a, a]), y)}</select></div></div>
        <div class="tabs"><a class="tab" href="#/planning">Semaine</a><a class="tab active" href="#/recap">Récap</a><a class="tab" href="#/taches">Tâches</a></div>
        <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Jours de chantier par mois · ${y}</h2><span class="tiny muted">Un jour = une personne sur un chantier</span></div>
          <div class="card-body">${barres(parMois, { valeur: (m) => m.jours, libelle: (v) => `${v} j` })}</div></div>
        <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>${MOIS_LONG[mo - 1][0].toUpperCase() + MOIS_LONG[mo - 1].slice(1)} ${y}</h2>
          <div class="actions"><a class="btn sm" href="#/recap?${prev}" aria-label="Mois précédent">${icon('back')}</a><a class="btn sm" href="#/recap">Ce mois</a><a class="btn sm" href="#/recap?${next}" aria-label="Mois suivant">${icon('chevron')}</a></div></div>
          <div class="card-body">${grid}</div></div>
        <div class="card"><div class="card-head"><h2>Jours par personne · ${y}</h2></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Personne</th>${MOIS_LONG.map((m, i) => `<th class="right"><a href="#/recap?annee=${y}&mois=${i + 1}">${['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'][i]}</a></th>`).join('')}<th class="right">Total</th><th class="right">Heures</th></tr></thead>
          <tbody>${people.map((p) => { const js = parPersonne.get(p.id); const hs = heuresPers.get(p.id); return `<tr><td class="strong nowrap">${esc(p.name)}</td>${js.map((n, i) => `<td class="right num ${i + 1 === mo ? 'strong' : 'muted'}">${n || '·'}</td>`).join('')}<td class="right num strong">${js.reduce((a, b) => a + b, 0)}</td><td class="right num">${number(hs.reduce((a, b) => a + b, 0))}</td></tr>`; }).join('')}</tbody></table></div></div>`;
    },
    mount(root, { query }) {
      root.querySelector('#annee')?.addEventListener('change', (e) => app.go(`#/recap?annee=${e.target.value}&mois=${query.mois || 1}`));
    },
  },

  week: {
    title: 'Planning',
    render({ query }) {
      const today = todayISO();
      const start = mondayOf(query.semaine || today);
      const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
      const recs = store.grouped();
      const evs = recs.evenement;
      const chantiers = recs.chantier.filter((c) => ['en_cours', 'planifie'].includes(c.statut) && c.dateDebut);
      const mine = query.moi === '1';
      const isMine = (e) => !mine || !e.userIds?.length || e.userIds.includes(app.user.id);
      const dayHtml = (d) => {
        const items = evs.filter((e) => isMine(e) && (e.date === d || (e.dateFin && e.date <= d && e.dateFin >= d))).sort((a, b) => (a.heureDebut || '').localeCompare(b.heureDebut || ''));
        const sites = chantiers.filter((c) => c.dateDebut <= d && (c.dateFin || c.dateDebut) >= d && !items.some((e) => e.chantierId === c.id));
        const taches = recs.tache.filter((t) => t.echeance === d && t.statut !== 'fait' && (!mine || t.assigneId === app.user.id));
        const dt = new Date(d + 'T12:00:00');
        return `<div class="card day ${d === today ? 'today' : ''}"><div class="d"><span>${dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })}</span>${app.can('planning', 2) ? `<button class="btn ghost sm icon-only" data-add="${d}" aria-label="Ajouter" style="height:24px;width:24px">${icon('plus')}</button>` : ''}</div>
          ${items.map((e) => `<div class="ev ${e.categorie || 'chantier'}" data-ev="${e.id}"><b>${esc(e.titre)}</b>${esc(e.heureDebut || '')}${e.heureFin ? '–' + esc(e.heureFin) : ''}${e.chantierId ? ' · ' + esc(store.get(e.chantierId)?.nom || '') : ''}${e.userIds?.length ? `<br><span class="muted">${e.userIds.map((id) => esc(store.userName(id))).join(', ')}</span>` : ''}</div>`).join('')}
          ${sites.map((c) => `<a class="ev" style="border-left-color:var(--line-2)" href="#/chantier/${c.id}"><b>${esc(c.nom)}</b><span class="muted">Chantier en cours</span></a>`).join('')}
          ${taches.map((t) => `<a class="ev" style="border-left-style:dashed" href="#/taches"><b>☐ ${esc(t.titre)}</b></a>`).join('')}
        </div>`;
      };
      const h = recs.pointage.filter((p) => p.date >= start && p.date <= days[6]);
      const parUser = {};
      for (const p of h) parUser[p.userId] = (parUser[p.userId] || 0) + num(p.heures);
      return `<div class="page-head"><div><h1>Planning</h1><p>Semaine du ${fmtDate(start, { day: 'numeric', month: 'long' })} au ${fmtDate(days[6], { day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
        <div class="actions">
          <a class="btn sm" href="#/planning?semaine=${addDays(start, -7)}${mine ? '&moi=1' : ''}" aria-label="Semaine précédente">${icon('back')}</a>
          <a class="btn sm" href="#/planning${mine ? '?moi=1' : ''}">Aujourd’hui</a>
          <a class="btn sm" href="#/planning?semaine=${addDays(start, 7)}${mine ? '&moi=1' : ''}" aria-label="Semaine suivante">${icon('chevron')}</a>
          <a class="btn sm ${mine ? 'dark' : ''}" href="#/planning?semaine=${start}${mine ? '' : '&moi=1'}">Mon planning</a>
          ${app.can('planning', 2) ? `<button class="btn sm" id="hours">${icon('clock')}<span class="lbl">Heures</span></button><button class="btn sm primary" id="add-ev">${icon('plus')}Événement</button>` : ''}
        </div></div>
        <div class="tabs"><a class="tab active" href="#/planning">Semaine</a><a class="tab" href="#/recap">Récap</a><a class="tab" href="#/taches">Tâches</a></div>
        <div class="week">${days.map(dayHtml).join('')}</div>
        ${Object.keys(parUser).length ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>Heures pointées cette semaine</h2></div><div class="list">${Object.entries(parUser).map(([u, n]) => `<div class="li"><span class="avatar sm">${esc(store.userName(u)[0])}</span><div class="grow t">${esc(store.userName(u))}</div><b class="num">${number(n)} h</b></div>`).join('')}</div></div>` : ''}`;
    },
    mount(root, { query }) {
      qs('#add-ev', root)?.addEventListener('click', () => evenementForm());
      qs('#hours', root)?.addEventListener('click', () => pointageForm());
      qsa('[data-add]', root).forEach((b) => b.addEventListener('click', () => evenementForm({ date: b.dataset.add })));
      qsa('[data-ev]', root).forEach((el) => el.addEventListener('click', () => app.can('planning', 2) && evenementForm(store.get(el.dataset.ev))));
      if (query.heures) { history.replaceState(null, '', '#/planning'); pointageForm(); }
    },
  },

  taches: {
    title: 'Tâches',
    render({ query, params }) {
      const f = query.f || 'ouvertes';
      const today = todayISO();
      let list = store.all('tache');
      if (f === 'ouvertes') list = list.filter((t) => t.statut !== 'fait');
      if (f === 'moi') list = list.filter((t) => t.statut !== 'fait' && t.assigneId === app.user.id);
      if (f === 'retard') list = list.filter((t) => t.statut !== 'fait' && t.echeance && t.echeance < today);
      if (f === 'faites') list = list.filter((t) => t.statut === 'fait');
      const prio = { haute: 0, normale: 1, basse: 2 };
      list.sort((a, b) => (a.echeance || '9999').localeCompare(b.echeance || '9999') || prio[a.priorite || 'normale'] - prio[b.priorite || 'normale']);
      const groups = {};
      for (const t of list) {
        const g = t.statut === 'fait' ? 'Terminées' : !t.echeance ? 'Sans échéance' : t.echeance < today ? 'En retard' : t.echeance === today ? 'Aujourd’hui' : t.echeance <= addDays(today, 7) ? 'Cette semaine' : 'Plus tard';
        (groups[g] ||= []).push(t);
      }
      const chips = [['ouvertes', 'À faire'], ['moi', 'Mes tâches'], ['retard', 'En retard'], ['faites', 'Terminées']];
      return `<div class="page-head"><div><h1>Tâches</h1></div><div class="actions">${app.can('planning', 2) ? `<button class="btn primary" id="new">${icon('plus')}Nouvelle tâche</button>` : ''}</div></div>
        <div class="tabs"><a class="tab" href="#/planning">Semaine</a><a class="tab" href="#/recap">Récap</a><a class="tab active" href="#/taches">Tâches</a></div>
        <div class="chips" style="margin-bottom:16px">${chips.map(([k, l]) => `<a class="chip ${f === k ? 'active' : ''}" href="#/taches?f=${k}">${l}</a>`).join('')}</div>
        ${Object.keys(groups).length ? Object.entries(groups).map(([g, ts]) => `<div class="card" style="margin-bottom:14px"><div class="card-head"><h2 ${g === 'En retard' ? 'style="color:var(--red-ink)"' : ''}>${g}</h2><span class="badge">${ts.length}</span></div><div class="list">${ts.map((t) => `<div class="li click" data-t="${t.id}">
          <input type="checkbox" data-done="${t.id}" ${t.statut === 'fait' ? 'checked' : ''} aria-label="Terminée" ${app.can('planning', 2) ? '' : 'disabled'}>
          <div class="grow"><div class="t" style="${t.statut === 'fait' ? 'text-decoration:line-through;color:var(--ink-3)' : ''}">${esc(t.titre)}</div><div class="s">${t.echeance ? fmtShort(t.echeance) + ' · ' : ''}${t.chantierId ? esc(store.get(t.chantierId)?.nom || '') + ' · ' : ''}${esc(store.userName(t.assigneId))}</div></div>
          ${t.priorite === 'haute' ? '<span class="badge red">Prioritaire</span>' : ''}</div>`).join('')}</div></div>`).join('') : `<div class="card empty">${icon('tasks')}<b>Aucune tâche</b>Rien à afficher pour ce filtre.</div>`}`;
    },
    mount(root, { query, params }) {
      qs('#new', root)?.addEventListener('click', () => tacheForm());
      qsa('[data-t]', root).forEach((el) => el.addEventListener('click', (e) => { if (!e.target.matches('input')) tacheForm(store.get(el.dataset.t)); }));
      qsa('[data-done]', root).forEach((cb) => cb.addEventListener('change', () => {
        const t = store.get(cb.dataset.done);
        store.save('tache', { ...t, statut: cb.checked ? 'fait' : 'a_faire', faitLe: cb.checked ? todayISO() : null }).then(() => cb.checked && toast('Tâche terminée.')).catch(toastError);
      }));
      if (query.nouveau) { history.replaceState(null, '', '#/taches'); tacheForm(); }
      if (params.id && store.get(params.id)) tacheForm(store.get(params.id));
    },
  },
};
