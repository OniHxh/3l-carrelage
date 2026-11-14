// Visites chez le client : photos, pièces, surfaces et travaux à faire, notes. Remplace le cahier.
// Une visite peut ensuite être chiffrée (calculateur pré-rempli) puis transformée en chantier.
import { esc, icon, fmtDate, badge, qs, qsa, number } from '../core.js';
import * as store from '../store.js';
import { app } from '../app.js';
import { formModal, modal, toast, toastError, pickImages, photoSrc, lightbox, options, confirmDialog } from '../ui.js';
import { SITUATIONS, SIT_PIECE, todayISO, estimationVisite, typePieceAuto, referencePrix, fr } from '../../shared/calc.js';

export const TRAVAUX = [
  ['depose', 'Dépose ancien revêtement'], ['evacuation', 'Évacuation gravats'], ['ragreage', 'Ragréage / préparation'], ['chape', 'Chape'],
  ['pose_sol', 'Pose sol'], ['faience', 'Faïence murale'], ['plinthes', 'Plinthes'], ['etancheite', 'Étanchéité (douche)'],
  ['douche', 'Douche à l’italienne'], ['escalier', 'Escalier'], ['joints', 'Réfection des joints'], ['exterieur', 'Terrasse / extérieur'],
];
const PIECES = ['Salle de bain', 'Cuisine', 'Séjour', 'Entrée', 'Couloir', 'Chambre', 'WC', 'Buanderie', 'Escalier', 'Terrasse', 'Garage'];
const SIT_VISITE = ['support', 'typePose', 'materiau', 'difficulte', 'acces', 'occupe', 'chauffageSol'];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const numOrNull = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')) || 0);
const surfSol = (p) => (Number(p.surfaceSol) || 0) || r2((Number(p.longueur) || 0) * (Number(p.largeur) || 0));
const totaux = (v) => {
  const ps = v.pieces || [];
  return { sol: r2(ps.reduce((s, p) => s + surfSol(p), 0)), mur: r2(ps.reduce((s, p) => s + (Number(p.surfaceMur) || 0), 0)) };
};
const photosDe = (v) => store.all('photo').filter((p) => p.visiteId === v.id).sort((a, b) => (a._createdAt || 0) - (b._createdAt || 0));
const uid = () => Math.random().toString(36).slice(2, 10);

function infosForm(v = {}, { onSaved } = {}) {
  formModal({
    title: v.id ? 'Informations de la visite' : 'Nouvelle visite client', wide: true,
    fields: [
      { name: 'client', label: 'Client', required: true, full: true, placeholder: 'Ex. M. et Mme Martin' },
      { name: 'tel', label: 'Téléphone', type: 'tel' }, { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'adresse', label: 'Adresse du chantier', full: true }, { name: 'cp', label: 'Code postal' }, { name: 'ville', label: 'Ville', default: 'Strasbourg' },
      { name: 'date', label: 'Date de la visite', type: 'date', default: todayISO() },
      { name: 'statut', label: 'Statut', type: 'select', options: Object.entries(STATUTS_VISITE).map(([k, [l]]) => [k, l]), default: 'a_chiffrer' },
    ],
    data: v,
    onSubmit: async (vals) => {
      const r = await store.save('visite', { pieces: [], ...v, ...vals });
      toast('Visite enregistrée.');
      onSaved ? onSaved(r) : app.go(`#/visite/${r.id}`);
    },
  });
}
export const STATUTS_VISITE = { a_chiffrer: ['À chiffrer', 'amber'], devis_envoye: ['Devis envoyé', 'blue'], accepte: ['Accepté', 'green'], refuse: ['Refusé', ''] };

/** Ajoute des photos à une visite, avec une légende et la pièce concernée. */
async function ajouterPhotos(v) {
  const imgs = await pickImages();
  if (!imgs.length) return;
  const pieces = v.pieces || [];
  const m = modal({
    title: `${imgs.length} photo(s) à décrire`, wide: true,
    body: `<div class="stack">${imgs.map((src, i) => `<div class="visite-photo-row"><img src="${esc(src)}" alt=""><div class="stack" style="gap:8px;flex:1">
        <input class="input" data-leg="${i}" placeholder="Ce qu’il faut faire, problème vu… (ex. carrelage fissuré, à déposer)">
        ${pieces.length ? `<select class="input" data-piece="${i}">${options([['', '— Pièce —'], ...pieces.map((p) => [p.id, p.nom || 'Pièce'])], '')}</select>` : ''}</div></div>`).join('')}</div>`,
    foot: '<button class="btn" data-close>Annuler</button><button class="btn primary" data-save>Enregistrer les photos</button>',
  });
  qs('[data-save]', m.el).addEventListener('click', async () => {
    const b = qs('[data-save]', m.el); b.disabled = true;
    try {
      for (const [i, dataUrl] of imgs.entries()) {
        await store.save('photo', { visiteId: v.id, dataUrl, date: todayISO(), phase: 'avant', legende: qs(`[data-leg="${i}"]`, m.el).value.trim(), pieceId: qs(`[data-piece="${i}"]`, m.el)?.value || '' });
      }
      m.close(); toast('Photos ajoutées à la visite.'); app.go(`#/visite/${v.id}`);
    } catch (e) { toastError(e); b.disabled = false; }
  });
}

function photoEdit(p, v) {
  const pieces = v.pieces || [];
  const m = modal({
    title: 'Photo', wide: true,
    body: `<img src="${esc(photoSrc(p))}" style="width:100%;max-height:55vh;object-fit:contain;border-radius:12px;background:#000;cursor:zoom-in" id="pz">
      <div class="form" style="margin-top:14px"><label class="field full"><span>Description</span><input class="input" name="legende" value="${esc(p.legende || '')}"></label>
      ${pieces.length ? `<label class="field full"><span>Pièce</span><select class="input" name="pieceId">${options([['', '—'], ...pieces.map((x) => [x.id, x.nom || 'Pièce'])], p.pieceId || '')}</select></label>` : ''}</div>`,
    foot: `<button class="btn ghost danger left" data-del>${icon('trash')}Supprimer</button><button class="btn" data-close>Fermer</button><button class="btn primary" data-save>Enregistrer</button>`,
  });
  qs('#pz', m.el).addEventListener('click', () => lightbox(photoSrc(p), p.legende));
  qs('[data-save]', m.el).addEventListener('click', async () => {
    await store.save('photo', { ...p, legende: qs('[name=legende]', m.el).value.trim(), pieceId: qs('[name=pieceId]', m.el)?.value || p.pieceId || '' }).catch(toastError);
    m.close(); app.go(`#/visite/${v.id}`);
  });
  qs('[data-del]', m.el).addEventListener('click', async () => {
    if (!(await confirmDialog('Supprimer cette photo ?', { danger: true, ok: 'Supprimer' }))) return;
    await store.remove(p.id).catch(toastError); m.close(); app.go(`#/visite/${v.id}`);
  });
}

const inp = (name, label, val, type = 'number', extra = '') => `<label class="field"><span>${label}</span><input class="input" ${type === 'number' ? 'type="number" inputmode="decimal" step="any" min="0"' : `type="${type}"`} name="${name}" value="${esc(val ?? '')}" ${extra}></label>`;

function pieceHtml(p, i, photos, vis = {}) {
  const ph = photos.filter((x) => x.pieceId === p.id);
  const sol = surfSol(p);
  return `<div class="card card-pad visite-piece" data-piece-id="${p.id}">
    <div class="row" style="justify-content:space-between;gap:8px"><h3 style="margin:0">${esc(p.nom || `Pièce ${i + 1}`)}</h3>
      <div class="row" style="gap:6px"><span class="badge">${number(sol)} m² sol${Number(p.surfaceMur) ? ` · ${number(p.surfaceMur)} m² murs` : ''}</span><button type="button" class="btn ghost sm icon-only" data-del-piece="${p.id}" title="Supprimer la pièce">${icon('trash')}</button></div></div>
    <div class="form">
      <label class="field full"><span>Nom de la pièce</span><input class="input" name="nom" value="${esc(p.nom || '')}" list="pieces-list"></label>
      ${inp('longueur', 'Longueur (m)', p.longueur)}${inp('largeur', 'Largeur (m)', p.largeur)}
      ${inp('surfaceSol', 'Surface sol (m²)', p.surfaceSol, 'number', `placeholder="${sol ? number(sol) + ' (calculé)' : 'ou L × l'}"`)}${inp('surfaceMur', 'Surface murs / faïence (m²)', p.surfaceMur)}
      ${inp('plinthesMl', 'Plinthes (ml)', p.plinthesMl)}${inp('surfaceEtancheite', 'Surface à étancher (m²)', p.surfaceEtancheite)}
      ${inp('nbMarches', 'Marches (nombre)', p.nbMarches)}
      <div class="field full"><span>Travaux à faire</span><div class="travaux-grid">${TRAVAUX.map(([k, l]) => `<label class="check"><input type="checkbox" name="travaux" value="${k}" ${(p.travaux || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
      <div class="field full"><span>Pour l’estimation (laisser « Comme la visite » si rien de particulier)</span><div class="form est-reglages">
        ${inp('formatL', 'Format — longueur (cm)', p.formatL, 'number', `placeholder="${esc(vis.formatL ?? 'comme la visite')}"`)}${inp('formatH', 'Format — largeur (cm)', p.formatH, 'number', `placeholder="${esc(vis.formatH ?? 'comme la visite')}"`)}
        ${SIT_PIECE.map((k) => `<label class="field"><span>${esc(SITUATIONS[k].label)}</span><select class="input" name="${k}">${options([['', k === 'piece' ? `Auto : ${SITUATIONS.piece.options.find((o) => o[0] === typePieceAuto(p))[1]}` : `Comme la visite${vis[k] ? ` (${SITUATIONS[k].options.find((o) => o[0] === vis[k])?.[1] || ''})` : ''}`], ...SITUATIONS[k].options.map(([val, l]) => [val, l])], p[k] || '')}</select></label>`).join('')}
      </div></div>
      <label class="field full"><span>Détails pour cette pièce</span><textarea class="input" name="notes" rows="3" placeholder="État du support, découpes, hauteur de faïence, ce que veut le client…">${esc(p.notes || '')}</textarea></label>
    </div>
    ${ph.length ? `<div class="photos visite-mini">${ph.map((x) => `<div class="photo" data-photo="${x.id}"><img loading="lazy" src="${esc(photoSrc(x))}" alt="${esc(x.legende || 'Photo')}"><div class="cap">${esc(x.legende || '')}</div></div>`).join('')}</div>` : ''}
  </div>`;
}

const eur = (n) => `${fr(Math.round(Number(n) || 0))} €`;
const refPrix = () => referencePrix(store.settings().prixRef || undefined);

/** Estimation basse / moyenne / haute à partir de ce qui est noté pendant la visite. */
function estimHtml(v) {
  const e = estimationVisite(v, refPrix());
  if (!e.moyen) return `<div class="card card-pad stack"><h2 style="margin:0">Estimation</h2><p class="small muted" style="margin:0">Notez les pièces, leurs mesures et cochez les travaux à faire : l’estimation basse, moyenne et haute s’affiche ici au fur et à mesure.</p></div>`;
  const th = (k) => (e.tauxHoraire[k] != null ? `${fr(Math.round(e.tauxHoraire[k]))} €/h` : '');
  const tile = (k, l, cls = '') => `<div class="${cls}"><b>${eur(e[k])}</b><span>${l} HT<br>${eur(e.ttc[k])} TTC<br>${th(k)}</span></div>`;
  const ligne = (l) => `<div class="li"><div class="grow"><div class="t">${esc(l.label)}</div>${l.unite !== 'forfait' ? `<div class="s">${fr(l.qte)} ${esc(l.unite === 'marche' && l.qte > 1 ? 'marches' : l.unite)} × ${fr(l.min)} / ${fr(l.moy)} / ${fr(l.max)} €</div>` : ''}</div><div class="est-vals"><span>${eur(l.bas)}</span><b>${eur(l.moyen)}</b><span>${eur(l.haut)}</span></div></div>`;
  return `<div class="card card-pad stack">
    <div><h2 style="margin:0">Estimation</h2><p class="small muted" style="margin:4px 0 0">D’après les mesures et travaux notés, prix du marché à Strasbourg majorés selon la situation de chaque pièce. Basse = bas de fourchette, moyenne = prix conseillé, haute = haut de fourchette. Affinez avec « Chiffrer ».</p></div>
    <div class="calc-result est-tiles">${tile('bas', 'Basse')}${tile('moyen', 'Moyenne', 'hero-tile')}${tile('haut', 'Haute')}</div>
    <p class="small" style="margin:0">≈ <b>${fr(e.jours)} jours</b> de travail à 1 personne (${fr(Math.round(e.heures))} h)${e.plancher ? ` · prix minimum pour couvrir vos coûts : <b>${eur(e.plancher)}</b>` : ''} · objectif ${fr(e.tauxCible)} €/h. TVA ${e.tva} % (logement de plus de 2 ans).</p>
    ${e.notes.map((n) => { const c = /ne couvre pas/.test(n) ? 'red' : /^Pose seule|fournis? par le client|minimum de facturation/.test(n) ? 'neutral' : ''; return `<div class="alert-box small ${c}">${icon(c === 'neutral' ? 'sparkles' : 'alert')}<div>${esc(n)}</div></div>`; }).join('')}
    <div class="est-head small muted"><span>Détail</span><span class="est-vals"><span>Basse</span><b>Moyenne</b><span>Haute</span></span></div>
    ${e.pieces.filter((p) => p.lignes.length).map((p) => `<details class="est-piece"><summary><span class="grow"><b>${esc(p.nom)}</b> <span class="muted small">${p.majPct ? `${p.majPct > 0 ? '+' : ''}${p.majPct} %` : 'sans majoration'} · ${fr(Math.round(p.heures))} h</span></span><span class="est-vals"><span>${eur(p.bas)}</span><b>${eur(p.moyen)}</b><span>${eur(p.haut)}</span></span></summary>
      <div class="list calc-lines">${p.lignes.map(ligne).join('')}</div>
      ${p.majorations.length ? `<p class="tiny muted" style="margin:6px 0 0">Majorations : ${p.majorations.map((m) => `${esc(m.label)} ${m.pct > 0 ? '+' : ''}${m.pct} %`).join(' · ')}${p.majPct !== p.majorations.reduce((s, m) => s + m.pct, 0) ? ` (plafonné à ${p.majPct} %)` : ''}</p>` : ''}
    </details>`).join('')}
    ${e.communs.length ? `<div class="list calc-lines">${e.communs.map(ligne).join('')}</div>` : ''}
  </div>`;
}

export default {
  list: {
    title: 'Visites clients',
    render({ query }) {
      const q = (query.q || '').toLowerCase();
      const all = store.all('visite').sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b._createdAt || 0) - (a._createdAt || 0));
      const list = all.filter((v) => !q || `${v.client} ${v.ville} ${v.adresse} ${v.tel}`.toLowerCase().includes(q));
      const photos = store.all('photo');
      const money = app.can('ca', 1);
      const ref = money ? refPrix() : null;
      return `<div class="page-head"><div><h1>Visites clients</h1><p>Photos, mesures et travaux notés chez le client, à la place du cahier.</p></div>
          <div class="actions">${app.can('chantiers', 2) ? `<button class="btn primary" id="new">${icon('plus')}Nouvelle visite</button>` : ''}</div></div>
        ${all.length > 4 ? `<div class="search" style="margin-bottom:16px;max-width:420px">${icon('search')}<input class="input" id="q" placeholder="Client, ville, téléphone…" value="${esc(query.q || '')}"></div>` : ''}
        <div class="card">${list.length ? `<div class="list">${list.map((v) => {
          const t = totaux(v); const n = photos.filter((p) => p.visiteId === v.id).length;
          const est = money ? estimationVisite(v, ref) : null;
          return `<a class="li" href="#/visite/${v.id}"><span class="ic">${icon('camera')}</span><div class="grow"><div class="t">${esc(v.client || 'Client')}</div>
            <div class="s">${v.date ? fmtDate(v.date) + ' · ' : ''}${esc([v.adresse, v.ville].filter(Boolean).join(', '))}${t.sol || t.mur ? ` · ${number(t.sol + t.mur)} m²` : ''}${n ? ` · ${n} photo(s)` : ''}${est?.moyen ? ` · ≈ ${eur(est.bas)} à ${eur(est.haut)} HT` : ''}</div></div>${badge('visite', v.statut || 'a_chiffrer')}</a>`;
        }).join('')}</div>` : `<div class="empty">${icon('camera')}<b>Aucune visite</b>Chez le client : créez une visite, prenez les photos, notez les pièces, les mesures et les travaux. Vous pourrez ensuite chiffrer et créer le chantier en un clic.</div>`}</div>`;
    },
    mount(root, { query }) {
      qs('#new', root)?.addEventListener('click', () => infosForm());
      qs('#q', root)?.addEventListener('input', (e) => { const p = qs('#q', root); const pos = p.selectionStart; history.replaceState(null, '', `#/visites?q=${encodeURIComponent(e.target.value)}`); app.go(`#/visites?q=${encodeURIComponent(e.target.value)}`); setTimeout(() => { const n = qs('#q'); n?.focus(); n?.setSelectionRange(pos, pos); }); });
      if (query.nouveau) { history.replaceState(null, '', '#/visites'); infosForm(); }
    },
  },

  detail: {
    title: ({ params }) => store.get(params.id)?.client || 'Visite',
    live: false,
    render({ params }) {
      const v = store.get(params.id);
      if (!v) return `<div class="empty card">${icon('camera')}<b>Visite introuvable</b><a class="btn" href="#/visites">Retour</a></div>`;
      const photos = photosDe(v);
      const t = totaux(v);
      const canW = app.can('chantiers', 2);
      const money = app.can('ca', 1);
      const ch = v.chantierId ? store.get(v.chantierId) : null;
      const sansPiece = photos.filter((p) => !p.pieceId || !(v.pieces || []).some((x) => x.id === p.pieceId));
      return `<div class="page-head"><div><div class="row" style="gap:8px;margin-bottom:6px"><a class="btn ghost sm" href="#/visites">${icon('back')}Visites</a>${badge('visite', v.statut || 'a_chiffrer')}</div>
          <h1>${esc(v.client || 'Client')}</h1><p>${v.date ? fmtDate(v.date) : ''}${v.adresse || v.ville ? ' · ' + esc([v.adresse, v.cp, v.ville].filter(Boolean).join(' ')) : ''}${v.tel ? ` · <a href="tel:${esc(v.tel)}" style="text-decoration:underline">${esc(v.tel)}</a>` : ''}</p></div>
        <div class="actions">
          ${canW ? `<button class="btn primary" id="photo">${icon('camera')}Photo</button>` : ''}
          ${money ? `<a class="btn" href="#/outils?visite=${v.id}">${icon('calc')}<span class="lbl">Chiffrer</span></a>` : ''}
          ${ch ? `<a class="btn" href="#/chantier/${ch.id}">${icon('site')}<span class="lbl">Voir le chantier</span></a>` : canW && app.can('chantiers', 2) ? `<button class="btn" id="to-chantier">${icon('site')}<span class="lbl">Créer le chantier</span></button>` : ''}
          ${canW ? `<button class="btn" id="infos">${icon('edit')}<span class="lbl">Infos</span></button>` : ''}
        </div></div>
        <div class="calc-result" style="margin-bottom:16px">
          <div><b>${number(t.sol)} m²</b><span>Sol</span></div><div><b>${number(t.mur)} m²</b><span>Murs / faïence</span></div>
          <div><b>${(v.pieces || []).length}</b><span>Pièce(s)</span></div><div><b>${photos.length}</b><span>Photo(s)</span></div>
        </div>
        ${money ? `<div id="estim" style="margin-bottom:16px">${estimHtml(v)}</div>` : ''}
        <div class="grid g2">
          <div class="stack">
            <div class="card card-pad stack"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Photos</h2>${canW ? `<button class="btn sm" id="photo2">${icon('camera')}Ajouter</button>` : ''}</div>
              ${sansPiece.length ? `<div class="photos">${sansPiece.map((x) => `<div class="photo" data-photo="${x.id}"><img loading="lazy" src="${esc(photoSrc(x))}" alt="${esc(x.legende || 'Photo')}"><div class="cap">${esc(x.legende || 'Sans description')}</div></div>`).join('')}</div>`
                : `<p class="small muted" style="margin:0">${photos.length ? 'Les autres photos sont rangées dans leur pièce.' : 'Prenez en photo chaque pièce, le support, les détails à reprendre.'}</p>`}
            </div>
            <form class="card card-pad stack" id="general"><h2 style="margin:0">Ce que veut le client</h2>
              <div class="form">
                <label class="field full"><span>Demande et détails</span><textarea class="input" name="notes" rows="5" placeholder="Ce qu’il faut faire, choix du carrelage, contraintes, accès, horaires…">${esc(v.notes || '')}</textarea></label>
                ${inp('formatL', 'Format carreau — longueur (cm)', v.formatL)}${inp('formatH', 'Format carreau — largeur (cm)', v.formatH)}
                <label class="field"><span>Carrelage fourni par</span><select class="input" name="carrelageFourni">${options([['entreprise', 'Nous'], ['client', 'Le client'], ['', 'À définir']], v.carrelageFourni ?? '')}</select></label>
                <label class="field"><span>Colle, joint, primaire, étanchéité fournis par</span><select class="input" name="produitsFourni">${options([['entreprise', 'Nous'], ['client', 'Le client']], v.produitsFourni || 'entreprise')}</select></label>
                ${inp('distanceKm', 'Distance depuis le dépôt (km)', v.distanceKm)}
                ${SIT_VISITE.map((k) => `<label class="field"><span>${esc(SITUATIONS[k].label)}</span><select class="input" name="${k}">${options(SITUATIONS[k].options.map(([val, l]) => [val, l]), v[k] || SITUATIONS[k].options[0][0])}</select></label>`).join('')}
                ${inp('delai', 'Délai souhaité', v.delai, 'text', 'placeholder="Ex. avant fin mars"')}${inp('budget', 'Budget annoncé (€)', v.budget)}
              </div></form>
          </div>
          <div class="stack" id="pieces">
            <div class="row" style="justify-content:space-between"><h2 style="margin:0">Pièces et travaux</h2>${canW ? `<button class="btn sm" id="add-piece">${icon('plus')}Ajouter une pièce</button>` : ''}</div>
            ${(v.pieces || []).length ? (v.pieces || []).map((p, i) => pieceHtml(p, i, photos, v)).join('') : `<div class="card empty small">${icon('grid')}<b>Aucune pièce</b>Ajoutez chaque pièce avec ses mesures et les travaux à faire.</div>`}
            <datalist id="pieces-list">${PIECES.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
          </div>
        </div>
        <p class="tiny muted" id="saved-state">Les modifications sont enregistrées automatiquement.</p>`;
    },
    mount(root, { params }) {
      const id = params.id;
      const cur = () => store.get(id);
      if (!cur()) return;
      const canW = app.can('chantiers', 2);
      const state = qs('#saved-state', root);
      let timer;
      const saveSoon = () => {
        clearTimeout(timer);
        state.textContent = 'Enregistrement…';
        timer = setTimeout(async () => {
          const v = cur();
          try { await store.save('visite', { ...v, ...lire(v) }); state.textContent = 'Enregistré ✓'; }
          catch (e) { toastError(e); state.textContent = 'Erreur d’enregistrement'; }
        }, 600);
      };
      // Lit le formulaire (infos générales + pièces)
      const lire = (v) => {
          const g = qs('#general', root);
          const gen = {
            notes: g.notes.value, formatL: numOrNull(g.formatL.value), formatH: numOrNull(g.formatH.value), carrelageFourni: g.carrelageFourni.value, produitsFourni: g.produitsFourni.value,
            distanceKm: numOrNull(g.distanceKm.value), delai: g.delai.value.trim(), budget: numOrNull(g.budget.value),
            ...Object.fromEntries(SIT_VISITE.map((k) => [k, g[k].value])),
          };
          const pieces = qsa('[data-piece-id]', root).map((el) => {
            const val = (n) => el.querySelector(`[name="${n}"]`).value;
            const old = (v.pieces || []).find((p) => p.id === el.dataset.pieceId) || {};
            return {
              ...old, id: el.dataset.pieceId, nom: val('nom').trim(), longueur: numOrNull(val('longueur')), largeur: numOrNull(val('largeur')),
              surfaceSol: numOrNull(val('surfaceSol')), surfaceMur: numOrNull(val('surfaceMur')), plinthesMl: numOrNull(val('plinthesMl')),
              surfaceEtancheite: numOrNull(val('surfaceEtancheite')), nbMarches: numOrNull(val('nbMarches')),
              travaux: [...el.querySelectorAll('[name="travaux"]:checked')].map((c) => c.value), notes: val('notes'),
              formatL: numOrNull(val('formatL')), formatH: numOrNull(val('formatH')), ...Object.fromEntries(SIT_PIECE.map((k) => [k, val(k)])),
            };
          });
          return { ...gen, pieces };
      };
      const estim = qs('#estim', root);
      let tEst;
      const majEstim = () => { if (!estim) return; clearTimeout(tEst); tEst = setTimeout(() => {
        const open = qsa('details.est-piece', estim).map((d, i) => d.open && i);
        estim.innerHTML = estimHtml({ ...cur(), ...lire(cur()) });
        qsa('details.est-piece', estim).forEach((d, i) => { if (open.includes(i)) d.open = true; });
      }, 250); };
      if (canW) { root.addEventListener('input', (e) => { if (e.target.closest('#general, [data-piece-id]')) { saveSoon(); majEstim(); } }); root.addEventListener('change', (e) => { if (e.target.closest('#general, [data-piece-id]')) { saveSoon(); majEstim(); } }); }
      else qsa('input, select, textarea', root).forEach((el) => { el.disabled = true; });

      qs('#photo', root)?.addEventListener('click', () => ajouterPhotos(cur()));
      qs('#photo2', root)?.addEventListener('click', () => ajouterPhotos(cur()));
      qs('#infos', root)?.addEventListener('click', () => infosForm(cur(), { onSaved: () => app.go(`#/visite/${id}`) }));
      qsa('[data-photo]', root).forEach((el) => el.addEventListener('click', () => photoEdit(store.get(el.dataset.photo), cur())));
      qs('#add-piece', root)?.addEventListener('click', async () => {
        clearTimeout(timer);
        const v = cur();
        await store.save('visite', { ...v, pieces: [...(v.pieces || []), { id: uid(), nom: '', travaux: [] }] }).catch(toastError);
        app.go(`#/visite/${id}`);
      });
      qsa('[data-del-piece]', root).forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmDialog('Supprimer cette pièce et ses mesures ? Les photos restent dans la visite.', { danger: true, ok: 'Supprimer' }))) return;
        clearTimeout(timer);
        const v = cur();
        await store.save('visite', { ...v, pieces: (v.pieces || []).filter((p) => p.id !== b.dataset.delPiece) }).catch(toastError);
        app.go(`#/visite/${id}`);
      }));
      qs('#to-chantier', root)?.addEventListener('click', async () => {
        const v = cur();
        if (!(await confirmDialog(`Créer le chantier « ${v.client} » ? Le client, l’adresse, les surfaces, les notes et les photos de la visite y seront repris.`, { ok: 'Créer le chantier' }))) return;
        try {
          let client = store.all('client').find((c) => (c.nom || '').trim().toLowerCase() === (v.client || '').trim().toLowerCase());
          if (!client && app.can('clients', 2)) client = await store.save('client', { nom: v.client, tel: v.tel || '', email: v.email || '', adresse: v.adresse || '', cp: v.cp || '', ville: v.ville || '', source: 'Visite' });
          const t = totaux(v);
          const nomsPieces = (v.pieces || []).map((p) => p.nom).filter(Boolean);
          const c = await store.save('chantier', {
            nom: `${v.client}${nomsPieces.length ? ' — ' + nomsPieces.slice(0, 3).join(', ') : ''}`, clientId: client?.id || '', statut: 'prospect',
            adresse: v.adresse || '', cp: v.cp || '', ville: v.ville || '', surface: t.sol + t.mur || null, typeTravaux: nomsPieces.join(', '),
          });
          const lignes = [
            v.notes && `Demande : ${v.notes}`,
            ...(v.pieces || []).map((p) => `${p.nom || 'Pièce'} : ${number(surfSol(p))} m² sol${Number(p.surfaceMur) ? `, ${number(p.surfaceMur)} m² murs` : ''}${(p.travaux || []).length ? ' — ' + p.travaux.map((k) => TRAVAUX.find((x) => x[0] === k)?.[1] || k).join(', ') : ''}${p.notes ? '. ' + p.notes : ''}`),
            v.delai && `Délai souhaité : ${v.delai}`,
          ].filter(Boolean);
          if (lignes.length) await store.save('note', { chantierId: c.id, texte: `Visite du ${fmtDate(v.date || todayISO())}\n${lignes.join('\n')}`, date: v.date || todayISO() });
          for (const p of photosDe(v)) await store.save('photo', { ...p, chantierId: c.id, phase: 'avant' });
          await store.save('visite', { ...cur(), chantierId: c.id, clientId: client?.id || '' });
          toast('Chantier créé à partir de la visite.');
          app.go(`#/chantier/${c.id}`);
        } catch (e) { toastError(e); }
      });
    },
  },
};
