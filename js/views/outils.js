import { esc, icon, number, qs, qsa } from '../core.js';
import * as store from '../store.js';
import { app } from '../app.js';
import { fieldHtml, readForm, modal, toast, toastError, confirmDialog } from '../ui.js';
import { chiffrageChantier, aideChiffrage, referencePrix, SITUATIONS, NIVEAUX } from '../../shared/calc.js';

const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0);
const eur2 = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(n) || 0);
const titre = (t, extra = '') => `<div class="full calc-group-head"><h3>${t}</h3>${extra}</div>`;

// Surface et carreau
const F_SURFACE = [
  { name: 'surface', label: 'Surface au sol (m²)', type: 'number', help: 'Ou renseignez longueur et largeur.' },
  { name: 'longueur', label: 'Longueur pièce (m)', type: 'number' }, { name: 'largeur', label: 'Largeur pièce (m)', type: 'number' },
  { name: 'surfaceMur', label: 'Surface murale / faïence (m²)', type: 'number', default: 0 },
  { name: 'formatL', label: 'Carreau — longueur (cm)', type: 'number', default: 60 }, { name: 'formatH', label: 'Carreau — largeur (cm)', type: 'number', default: 60 },
  { name: 'epaisseur', label: 'Épaisseur carreau (mm)', type: 'number', default: 9 },
  { name: 'joint', label: 'Largeur de joint (mm)', type: 'number', default: 3 },
  { name: 'perte', label: 'Pertes / chutes (%)', type: 'select', options: [[5, '5 % — pose droite, pièce simple'], [10, '10 % — standard'], [15, '15 % — diagonale / pièce découpée'], [20, '20 % — chevron, motif']], default: 10 },
  { name: 'm2ParCarton', label: 'm² par carton', type: 'number', default: 1.44 },
  { name: 'colleKgM2', label: 'Colle (kg/m²)', type: 'select', options: [[3.5, '3,5 — petits formats, peigne 6 mm'], [5, '5 — standard, peigne 9 mm'], [7, '7 — grands formats, double encollage']], default: 5 },
];
// Situation du chantier : fait varier les prix conseillés et le rendement
const F_SITUATION = [
  ...Object.entries(SITUATIONS).map(([name, s]) => ({
    name, label: s.label, type: 'select', default: s.options[0][0],
    options: s.options.map(([v, l, pct]) => [v, pct ? `${l} (${pct > 0 ? '+' : '−'}${Math.abs(pct)} %)` : l]),
  })),
  { name: 'distanceKm', label: 'Distance depuis le dépôt (km, aller)', type: 'number', default: 0 },
  { name: 'facturerDeplacement', label: 'Facturer le déplacement', type: 'select', options: [['oui', 'Oui, au-delà des km inclus'], ['non', 'Non (offert)']], default: 'oui' },
];
// Prix facturés au client
const F_PRIX = [
  { name: 'prixPoseM2', label: 'Pose sol (€ HT / m²)', type: 'number', default: 40 },
  { name: 'prixFaienceM2', label: 'Pose faïence (€ HT / m²)', type: 'number' },
  { name: 'prixDeposeM2', label: 'Dépose ancien carrelage (€ / m²)', type: 'number', default: 0, help: '0 si pas de dépose.' },
  { name: 'prixRagreageM2', label: 'Ragréage fourni-posé (€ / m²)', type: 'number', default: 0, help: '0 si pas de ragréage. Primaire et produit compris.' },
  { name: 'surfaceChape', label: 'Chape (m²)', type: 'number', default: 0 }, { name: 'prixChapeM2', label: 'Chape fourni-posé (€ / m²)', type: 'number' },
  { name: 'surfaceEtancheite', label: 'Étanchéité SPEC / SEL (m²)', type: 'number', default: 0, help: 'Zone de douche, murs et sol exposés.' }, { name: 'prixEtancheiteM2', label: 'Étanchéité fourni-posé (€ / m²)', type: 'number' },
  { name: 'plinthesMl', label: 'Plinthes (mètres linéaires)', type: 'number', default: 0 }, { name: 'prixPlintheMl', label: 'Pose plinthes (€ / ml)', type: 'number', default: 12 },
  { name: 'profilesMl', label: 'Profilés, seuils, nez de marche (ml)', type: 'number', default: 0 }, { name: 'prixProfileMl', label: 'Profilés fourni-posé (€ / ml)', type: 'number' },
  { name: 'nbMarches', label: 'Marches d’escalier (nombre)', type: 'number', default: 0 }, { name: 'prixMarche', label: 'Prix par marche (€)', type: 'number' },
  { name: 'nbDouches', label: 'Douches à l’italienne (nombre)', type: 'number', default: 0 }, { name: 'forfaitDouche', label: 'Forfait douche (€, hors carrelage)', type: 'number' },
  { name: 'evacuationHT', label: 'Évacuation des gravats (€ forfait)', type: 'number', default: 0 },
  { name: 'tva', label: 'TVA', type: 'select', options: [[10, '10 % (rénovation logement > 2 ans)'], [20, '20 %'], [5.5, '5,5 %']], default: 10 },
];
// Fournitures (prix d'achat)
const F_FOURNITURES = [
  { name: 'carrelageFourni', label: 'Carrelage fourni par', type: 'select', options: [['entreprise', 'Nous (on l’achète)'], ['client', 'Le client']], default: 'entreprise' },
  { name: 'prixCarrelageM2', label: 'Prix d’achat carrelage (€ / m²)', type: 'number', default: 25 },
  { name: 'prixSacColle', label: 'Prix d’un sac de colle 25 kg (€)', type: 'number', default: 20 },
  { name: 'prixJointKg', label: 'Prix du joint (€ / kg)', type: 'number', default: 3 },
  { name: 'autresFrais', label: 'Autres frais (€)', type: 'number', default: 0, help: 'Primaire, nivellement, location, stationnement…' },
  { name: 'margeFournituresPct', label: 'Marge sur fournitures (%)', type: 'number', default: 15, help: 'Ce que vous ajoutez au prix d’achat en revendant.' },
];
// Temps
const F_TEMPS = [
  { name: 'm2ParJour', label: 'm² de sol posés par jour et par personne', type: 'number', default: 12, help: 'Tout compris (encollage, pose, coupes, joints). La faïence compte à 70 % de ce rendement ; dépose, ragréage, plinthes… sont ajoutés automatiquement.' },
  { name: 'personnes', label: 'Nombre de personnes sur le chantier', type: 'number', default: 1 },
  { name: 'heuresParJour', label: 'Heures par jour', type: 'number', default: 8 },
];
const ALL = [...F_SURFACE, ...F_SITUATION, ...F_PRIX, ...F_FOURNITURES, ...F_TEMPS];
const MEM = 'calc-chiffrage';

/** Pré-remplit le calculateur à partir d'une visite client (somme des pièces). */
function depuisVisite(vis, ref) {
  const mid = (k) => Math.round((ref.prestations[k].min + ref.prestations[k].max) / 2);
  const pieces = vis.pieces || [];
  const val = (p, k) => (k === 'surfaceSol' ? (Number(p.surfaceSol) || (Number(p.longueur) || 0) * (Number(p.largeur) || 0)) : Number(p[k]) || 0);
  const sum = (k) => Math.round(pieces.reduce((s, p) => s + val(p, k), 0) * 100) / 100;
  const has = (t) => pieces.some((p) => (p.travaux || []).includes(t));
  const d = { surface: sum('surfaceSol') || null, surfaceMur: sum('surfaceMur') || 0, plinthesMl: sum('plinthesMl') || 0 };
  if (vis.formatL) d.formatL = vis.formatL;
  if (vis.formatH) d.formatH = vis.formatH;
  for (const k of ['typePose', 'support', 'piece', 'acces', 'occupe', 'materiau', 'difficulte', 'chauffageSol']) if (vis[k]) d[k] = vis[k];
  if (vis.distanceKm) d.distanceKm = vis.distanceKm;
  if (has('depose')) d.prixDeposeM2 = mid('depose');
  if (has('ragreage')) d.prixRagreageM2 = mid('ragreage');
  if (has('etancheite')) d.surfaceEtancheite = sum('surfaceEtancheite');
  if (has('evacuation') || has('depose')) d.evacuationHT = mid('evacuation');
  if (has('douche')) d.nbDouches = pieces.filter((p) => (p.travaux || []).includes('douche')).length;
  if (has('escalier')) d.nbMarches = sum('nbMarches');
  if (vis.carrelageFourni) d.carrelageFourni = vis.carrelageFourni;
  return d;
}

const loadMem = () => { try { return JSON.parse(localStorage.getItem(MEM) || '{}'); } catch { return {}; } };
const saveMem = (v) => { try { localStorage.setItem(MEM, JSON.stringify(v)); } catch {} };

const tile = (b, s, cls = '') => `<div class="${cls}"><b>${b}</b><span>${s}</span></div>`;
const ALERT_CLS = { danger: 'red', warn: '', info: 'neutral' };
const ALERT_ICON = { danger: 'alert', warn: 'alert', info: 'sparkles' };
const VERDICTS = {
  vide: null,
  perte: ['red', 'alert', 'Prix à perte', 'Ce prix ne couvre pas vos coûts estimés.'],
  juste: ['', 'alert', 'Prix trop juste', 'Les coûts sont couverts mais le bénéfice est sous votre objectif.'],
  bon: ['green', 'check', 'Prix correct', 'Le prix couvre vos coûts et votre objectif de bénéfice.'],
  cher: ['neutral', 'trend', 'Prix élevé', 'Certains prix sont au-dessus du marché strasbourgeois : risque de perdre le chantier face à la concurrence.'],
};

const LIGNES = [
  ['pose', 'Pose sol'], ['faience', 'Pose faïence'], ['depose', 'Dépose'], ['ragreage', 'Ragréage / préparation'], ['chape', 'Chape'],
  ['etancheite', 'Étanchéité'], ['plinthes', 'Plinthes'], ['profiles', 'Profilés'], ['marches', 'Marches'], ['douches', 'Douche(s) à l’italienne'],
  ['evacuation', 'Évacuation gravats'], ['deplacement', 'Déplacement'], ['fournituresVente', 'Fournitures (avec marge)'],
];

function gaugeHtml(total, plancher, conseille) {
  if (!total || !plancher || !conseille) return '';
  const max = Math.max(total, conseille) * 1.2;
  const pos = (x) => `${Math.min(100, Math.max(0, (x / max) * 100)).toFixed(1)}%`;
  return `<div class="price-gauge" role="img" aria-label="Prix ${eur(total)} : minimum ${eur(plancher)}, conseillé ${eur(conseille)}">
      <div class="track"><i class="z-red" style="width:${pos(plancher)}"></i><i class="z-amber" style="left:${pos(plancher)};width:calc(${pos(conseille)} - ${pos(plancher)})"></i><i class="z-green" style="left:${pos(conseille)}"></i>
        <span class="marker" style="left:${pos(total)}"></span></div>
      <div class="legend"><span>Minimum <b>${eur(plancher)}</b></span><span>Conseillé <b>${eur(conseille)}</b></span><span>Votre prix <b>${eur(total)}</b></span></div>
    </div>`;
}

function alertesHtml(alertes) {
  if (!alertes.length) return '';
  return `<h3 style="margin:0">Points de vigilance <span class="badge">${alertes.length}</span></h3><div class="stack calc-alerts">${alertes.map((a) => `<div class="alert-box small ${ALERT_CLS[a.niveau]}">${icon(ALERT_ICON[a.niveau])}<div>${esc(a.texte)}</div></div>`).join('')}</div>`;
}

function majorationsHtml(a) {
  if (!a.majorations.length) return '<p class="small muted" style="margin:0">Situation standard : aucune majoration sur la pose.</p>';
  return `<div class="card calc-maj"><div class="li"><div class="grow t">Majoration de la pose selon la situation</div><b class="num">${a.majPct > 0 ? '+' : ''}${a.majPct} %${a.majPctBrut !== a.majPct ? ` <span class="tiny muted">(plafonné, ${a.majPctBrut > 0 ? '+' : ''}${a.majPctBrut} % cumulés)</span>` : ''}</b></div>
    ${a.majorations.map((m) => `<div class="li"><div class="grow s">${esc(m.label)}</div><span class="num small">${m.pct > 0 ? '+' : ''}${m.pct} %</span></div>`).join('')}</div>`;
}

function resultHtml(r, a, money, canSettings) {
  const temps = `<h3 style="margin:0">Temps estimé</h3><div class="calc-result">
      ${tile(`${number(r.heures)} h`, 'Heures de travail au total')}
      ${tile(`${number(r.joursChantier)} j`, `Durée du chantier (${number(r.joursPersonne)} jour(s)-personne)`)}
      ${r.heuresAnnexes ? tile(`${number(r.heuresAnnexes)} h`, 'dont dépose, préparation, plinthes, marches, douche…') : ''}
    </div>`;
  const mat = `<h3 style="margin:0">Matériaux</h3><div class="calc-result">
      ${tile(`${number(r.surfaceCommande)} m²`, `À commander (surface ${number(r.surface)} m²)`)}
      ${tile(r.cartons ?? '—', 'Cartons')}
      ${tile(`${r.sacsColle} sac(s)`, `Colle · ${number(r.colleKg)} kg`)}
      ${tile(`${number(r.jointKg)} kg`, `Joint · ${number(r.jointKgM2)} kg/m²`)}
    </div>`;
  const situation = `<h3 style="margin:0">Situation du chantier</h3>${majorationsHtml(a)}`;
  if (!money) return `${alertesHtml(a.alertes.filter((x) => !x.money))}${situation}${temps}${mat}`;

  const rt = a.rentab;
  const v = VERDICTS[a.verdict];
  const verdict = v ? `<div class="alert-box ${v[0]} calc-verdict">${icon(v[1])}<div><b>${v[2]}</b><br>${v[3]}</div></div>` : '';
  const lignes = LIGNES.filter(([k]) => r[k] > 0);
  return `${verdict}
    <h3 style="margin:0">Prix pour le client</h3><div class="calc-result">
      ${tile(eur(r.totalHT), 'Total HT', 'hero-tile')}
      ${tile(eur(r.totalTTC), `TTC (TVA ${number(r.tvaPct)} %)`)}
      ${tile(rt.prixM2 ? eur2(rt.prixM2) : '—', 'Prix moyen au m² (tout compris)')}
      ${tile(eur(r.mainOeuvreHT), 'dont main-d’œuvre HT')}
      ${tile(eur(r.fournituresVente), 'dont fournitures HT')}
    </div>
    ${gaugeHtml(r.totalHT, rt.prixPlancher, rt.prixConseille)}
    <h3 style="margin:0">Rentabilité estimée</h3><div class="calc-result">
      ${tile(eur(rt.benefice), `Bénéfice (${number(rt.beneficePct)} % du HT)`, rt.benefice >= 0 ? 'pos-tile' : 'neg-tile')}
      ${tile(rt.tauxHoraireEffectif != null ? eur(rt.tauxHoraireEffectif) : '—', 'Rapporté par heure de travail (hors fournitures)')}
      ${tile(eur(rt.coutMO), `Coût main-d’œuvre (${number(r.heures)} h)`)}
      ${tile(eur(r.fournituresAchat + r.materiauxPrestations), r.materiauxPrestations ? `Fournitures (achat), dont ${eur(r.materiauxPrestations)} pour les prestations fourni-posé` : 'Fournitures (achat)')}
      ${tile(eur(rt.prixTempsPasse), 'Prix si facturé au temps passé (contrôle)')}
      ${tile(eur(rt.fraisGeneraux), 'Frais généraux')}
      ${r.deplacementCout ? tile(eur(r.deplacementCout), `Déplacements (${r.joursTrajet} aller-retour)`) : ''}
    </div>
    <p class="tiny muted" style="margin:0">Calculé avec vos coûts internes (heure, frais généraux, objectif de bénéfice).${canSettings ? ' <a href="#/parametres?tab=prix" style="text-decoration:underline">Modifier</a>' : ''}</p>
    ${alertesHtml(a.alertes)}
    ${situation}
    ${lignes.length ? `<h3 style="margin:0">Détail du prix HT</h3><div class="card calc-lines">${lignes.map(([k, l]) => `<div class="li"><div class="grow s">${l}</div><b class="num">${eur(r[k])}</b></div>`).join('')}</div>` : ''}
    ${temps}
    ${mat}`;
}

/** Indicateur sous un champ de prix : fourchette Strasbourg, niveau, prix conseillé. */
function hintHtml(p, a) {
  const unite = p.unite === '%' ? ' %' : ` € / ${p.unite}`;
  const [lbl, color] = NIVEAUX[p.niveau];
  const maj = p.majore && a.majPct ? ` (situation ${a.majPct > 0 ? '+' : ''}${a.majPct} %)` : '';
  return `${p.utile && p.niveau !== 'vide' ? `<span class="badge ${color}">${lbl}</span> ` : ''}Strasbourg${maj} : ${number(p.min)}–${number(p.max)}${unite} · conseillé <b>${number(p.conseille)}</b> <button type="button" class="link-btn" data-use="${p.field}" data-val="${p.conseille}">Utiliser</button>`;
}

export default {
  calc: {
    title: 'Calculateur', live: false,
    render({ query }) {
      const money = app.can('ca', 1);
      const ch = query.chantier ? store.get(query.chantier) : null;
      const vis = query.visite ? store.get(query.visite) : null;
      const data = ch?.chiffrage ? { ...ch.chiffrage } : vis ? depuisVisite(vis, referencePrix(store.settings().prixRef)) : { ...loadMem(), ...(ch?.surface ? { surface: ch.surface } : {}) };
      const canApply = money && app.can('ca', 2) && app.can('chantiers', 2);
      const fill = `<button type="button" class="btn sm" id="fill">${icon('sparkles')}Remplir les prix conseillés</button>`;
      const groups = money
        ? [['Surface et carreau', F_SURFACE], ['Situation du chantier', F_SITUATION], ['Prestations facturées', F_PRIX, fill], ['Fournitures', F_FOURNITURES], ['Temps de travail', F_TEMPS]]
        : [['Surface et carreau', F_SURFACE], ['Situation du chantier', F_SITUATION.filter((f) => f.name !== 'facturerDeplacement')], ['Temps de travail', F_TEMPS]];
      return `<div class="page-head"><div><h1>${money ? 'Chiffrage d’un chantier' : 'Calculateur de matériaux'}</h1><p>${vis ? `D’après la visite <a href="#/visite/${vis.id}" style="text-decoration:underline">${esc(vis.client || vis.titre || 'client')}</a>` : ch ? `Pour le chantier <a href="#/chantier/${ch.id}" style="text-decoration:underline">${esc(ch.nom)}</a>` : money ? 'Prix pour le client avec indicateurs du marché strasbourgeois, rentabilité et points de vigilance.' : 'Quantités de carrelage, colle et joint, et temps de travail.'}</p></div>
        <div class="actions"><button class="btn" id="reset" type="button">${icon('refresh')}<span class="lbl">Réinitialiser</span></button>${canApply ? `<button class="btn primary" id="apply">${icon('check')}${ch ? 'Enregistrer sur ce chantier' : 'Enregistrer sur un chantier'}</button>` : ''}</div></div>
        <div class="grid g2">
          <div class="card card-pad"><form class="form" id="cf">${groups.map(([t, fs, extra]) => titre(t, extra) + fs.map((f) => fieldHtml(f, data)).join('')).join('')}</form></div>
          <div class="card card-pad stack calc-sticky" id="res"></div>
        </div>
        <p class="tiny muted">Estimation indicative. Fourchettes de prix : ordres de grandeur HT pour Strasbourg et le Bas-Rhin, pose seule, à ajuster dans Paramètres → Prix de référence. Joint : formule fabricant ((L+l)/(L×l)) × largeur × épaisseur × 1,6, majorée de 10 %.</p>`;
    },
    mount(root, { query }) {
      const money = app.can('ca', 1);
      const canSettings = app.can('parametres', 2) && app.can('ca', 2);
      const ref = referencePrix(store.settings().prixRef);
      const f = qs('#cf', root);
      // Emplacements des indicateurs sous les champs
      const hintFields = money ? [...Object.values(ref.prestations), ...Object.values(ref.fournitures)].map((p) => p.field) : [];
      for (const name of [...hintFields, 'm2ParJour']) {
        const lab = f.elements[name]?.closest('.field');
        if (lab) lab.insertAdjacentHTML('beforeend', `<small class="price-hint" data-hint="${name}"></small>`);
      }
      let r, v, a;
      const run = () => {
        v = readForm(f, ALL);
        r = chiffrageChantier(v, ref);
        a = aideChiffrage(v, r, ref);
        qs('#res', root).innerHTML = resultHtml(r, a, money, canSettings);
        for (const el of qsa('[data-hint]', f)) {
          const name = el.dataset.hint;
          if (name === 'm2ParJour') {
            el.innerHTML = `Conseillé pour cette situation : <b>${number(a.rendementConseille)}</b> m²/jour <button type="button" class="link-btn" data-use="m2ParJour" data-val="${a.rendementConseille}">Utiliser</button>`;
            continue;
          }
          const p = a.prix[name];
          if (!p) continue;
          if (name === 'prixCarrelageM2' && v.carrelageFourni === 'client') { el.textContent = 'Fourni par le client.'; continue; }
          el.innerHTML = hintHtml(p, a);
          el.classList.toggle('dim', !p.utile);
        }
        if (!query.chantier && !query.visite) saveMem(v);
      };
      f.addEventListener('input', run); f.addEventListener('change', run); run();
      if (query.visite && money) setTimeout(() => qs('#fill', root)?.click());

      f.addEventListener('click', (e) => {
        const b = e.target.closest('[data-use]');
        if (!b) return;
        e.preventDefault();
        const el = f.elements[b.dataset.use];
        if (!el) return;
        el.value = b.dataset.val;
        run();
      });
      qs('#reset', root).addEventListener('click', async () => {
        if (!(await confirmDialog('Remettre tous les champs du calculateur à leurs valeurs par défaut ?', { ok: 'Réinitialiser' }))) return;
        for (const fd of ALL) { const el = f.elements[fd.name]; if (el) el.value = fd.default ?? ''; }
        saveMem({});
        run();
        toast(query.chantier ? 'Champs réinitialisés. Le chiffrage du chantier ne change que si vous enregistrez.' : 'Calculateur réinitialisé.');
      });
      qs('#fill', root)?.addEventListener('click', () => {
        let n = 0;
        for (const p of Object.values(a.prix)) {
          if (!ref.prestations[p.key] || !p.utile || p.optionnel) continue;
          const el = f.elements[p.field];
          if (el && Number(el.value) !== p.conseille) { el.value = p.conseille; n++; }
        }
        run();
        toast(n ? `${n} prix remplacé(s) par le prix conseillé pour cette situation.` : 'Les prix correspondent déjà aux prix conseillés.');
      });

      const apply = async (id) => {
        const c = store.get(id);
        if (!c) return;
        await store.save('chantier', { ...c, prixHT: r.totalHT, heuresPrevues: r.heures, surface: c.surface || r.surface || null, chiffrage: v });
        toast('Chiffrage enregistré sur le chantier.');
        app.go(`#/chantier/${id}`);
      };
      qs('#apply', root)?.addEventListener('click', () => {
        if (query.chantier) return apply(query.chantier).catch(toastError);
        const list = store.all('chantier').filter((c) => c.statut !== 'annule').sort((a, b) => a.nom.localeCompare(b.nom));
        if (!list.length) return toast('Créez d’abord un chantier.', 'error');
        const m = modal({ title: 'Enregistrer sur quel chantier ?', body: `<p class="small muted" style="margin-top:0">Le prix (${eur(r.totalHT)} HT) et les ${number(r.heures)} h prévues seront enregistrés sur le chantier.</p><div class="list card">${list.map((c) => `<button class="li click" style="width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line)" data-id="${c.id}"><span class="ic">${icon('site')}</span><div class="grow"><div class="t">${esc(c.nom)}</div><div class="s">${esc(c.ref || '')}${c.prixHT ? ` · déjà chiffré ${eur(c.prixHT)}` : ''}</div></div></button>`).join('')}</div>` });
        qsa('[data-id]', m.el).forEach((b) => b.addEventListener('click', () => { m.close(); apply(b.dataset.id).catch(toastError); }));
      });
    },
  },
};
