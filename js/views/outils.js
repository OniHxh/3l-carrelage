import { esc, icon, number, qs, qsa } from '../core.js';
import * as store from '../store.js';
import { app } from '../app.js';
import { fieldHtml, readForm, modal, toast, toastError } from '../ui.js';
import { chiffrageChantier } from '../../shared/calc.js';

const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0);
const titre = (t) => `<h3 class="full" style="margin:10px 0 0;font-size:15px">${t}</h3>`;

// Surface et carreau
const F_SURFACE = [
  { name: 'surface', label: 'Surface (m²)', type: 'number', help: 'Ou renseignez longueur et largeur.' },
  { name: 'longueur', label: 'Longueur pièce (m)', type: 'number' }, { name: 'largeur', label: 'Largeur pièce (m)', type: 'number' },
  { name: 'formatL', label: 'Carreau — longueur (cm)', type: 'number', default: 60 }, { name: 'formatH', label: 'Carreau — largeur (cm)', type: 'number', default: 60 },
  { name: 'epaisseur', label: 'Épaisseur carreau (mm)', type: 'number', default: 9 },
  { name: 'joint', label: 'Largeur de joint (mm)', type: 'number', default: 3 },
  { name: 'perte', label: 'Pertes / chutes (%)', type: 'select', options: [[5, '5 % — pose droite, pièce simple'], [10, '10 % — standard'], [15, '15 % — diagonale / pièce découpée'], [20, '20 % — chevron, motif']], default: 10 },
  { name: 'm2ParCarton', label: 'm² par carton', type: 'number', default: 1.44 },
  { name: 'colleKgM2', label: 'Colle (kg/m²)', type: 'select', options: [[3.5, '3,5 — petits formats, peigne 6 mm'], [5, '5 — standard, peigne 9 mm'], [7, '7 — grands formats, double encollage']], default: 5 },
];
// Prix facturés au client
const F_PRIX = [
  { name: 'prixPoseM2', label: 'Pose (€ HT / m²)', type: 'number', default: 40 },
  { name: 'prixDeposeM2', label: 'Dépose ancien carrelage (€ / m²)', type: 'number', default: 0, help: '0 si pas de dépose.' },
  { name: 'prixRagreageM2', label: 'Ragréage / préparation (€ / m²)', type: 'number', default: 0 },
  { name: 'plinthesMl', label: 'Plinthes (mètres linéaires)', type: 'number', default: 0 },
  { name: 'prixPlintheMl', label: 'Pose plinthes (€ / ml)', type: 'number', default: 12 },
  { name: 'tva', label: 'TVA', type: 'select', options: [[10, '10 % (rénovation logement > 2 ans)'], [20, '20 %'], [5.5, '5,5 %']], default: 10 },
];
// Fournitures (prix d'achat)
const F_FOURNITURES = [
  { name: 'carrelageFourni', label: 'Carrelage fourni par', type: 'select', options: [['entreprise', 'Nous (on l’achète)'], ['client', 'Le client']], default: 'entreprise' },
  { name: 'prixCarrelageM2', label: 'Prix d’achat carrelage (€ / m²)', type: 'number', default: 25 },
  { name: 'prixSacColle', label: 'Prix d’un sac de colle 25 kg (€)', type: 'number', default: 20 },
  { name: 'prixJointKg', label: 'Prix du joint (€ / kg)', type: 'number', default: 3 },
  { name: 'autresFrais', label: 'Autres frais (€)', type: 'number', default: 0, help: 'Déplacement, location, profilés, évacuation…' },
  { name: 'margeFournituresPct', label: 'Marge sur fournitures (%)', type: 'number', default: 15, help: 'Ce que vous ajoutez au prix d’achat en revendant.' },
];
// Temps
const F_TEMPS = [
  { name: 'm2ParJour', label: 'm² faits par jour et par personne', type: 'number', default: 10, help: 'Tout compris (préparation, pose, joints). Ajustez avec vos chantiers passés.' },
  { name: 'personnes', label: 'Nombre de personnes sur le chantier', type: 'number', default: 1 },
  { name: 'heuresParJour', label: 'Heures par jour', type: 'number', default: 8 },
];
const ALL = [...F_SURFACE, ...F_PRIX, ...F_FOURNITURES, ...F_TEMPS];
const MEM = 'calc-chiffrage';

const loadMem = () => { try { return JSON.parse(localStorage.getItem(MEM) || '{}'); } catch { return {}; } };
const saveMem = (v) => { try { localStorage.setItem(MEM, JSON.stringify(v)); } catch {} };

const tile = (b, s, cls = '') => `<div class="${cls}"><b>${b}</b><span>${s}</span></div>`;

function resultHtml(r, money) {
  const temps = `<h3 style="margin:0">Temps estimé</h3><div class="calc-result">
      ${tile(`${number(r.heures)} h`, 'Heures de travail au total')}
      ${tile(`${number(r.joursChantier)} j`, `Durée du chantier (${number(r.joursPersonne)} jour(s)-personne)`)}
    </div>`;
  const mat = `<h3 style="margin:0">Matériaux</h3><div class="calc-result">
      ${tile(`${number(r.surfaceCommande)} m²`, `À commander (surface ${number(r.surface)} m²)`)}
      ${tile(r.cartons ?? '—', 'Cartons')}
      ${tile(`${r.sacsColle} sac(s)`, `Colle · ${number(r.colleKg)} kg`)}
      ${tile(`${number(r.jointKg)} kg`, `Joint · ${number(r.jointKgM2)} kg/m²`)}
    </div>`;
  if (!money) return `${temps}${mat}`;
  return `<h3 style="margin:0">Prix pour le client</h3><div class="calc-result">
      ${tile(eur(r.totalHT), 'Total HT', 'hero-tile')}
      ${tile(eur(r.totalTTC), `TTC (TVA ${number(r.tvaPct)} %)`)}
      ${tile(eur(r.mainOeuvreHT), 'dont main-d’œuvre HT')}
      ${tile(eur(r.fournituresVente), 'dont fournitures HT')}
    </div>
    ${temps}
    ${mat}`;
}

export default {
  calc: {
    title: 'Calculateur', live: false,
    render({ query }) {
      const money = app.can('ca', 1);
      const ch = query.chantier ? store.get(query.chantier) : null;
      const data = ch?.chiffrage ? { ...ch.chiffrage } : { ...loadMem(), ...(ch?.surface ? { surface: ch.surface } : {}) };
      const canApply = money && app.can('ca', 2) && app.can('chantiers', 2);
      const groups = money
        ? [['Surface et carreau', F_SURFACE], ['Prix facturés au client', F_PRIX], ['Fournitures', F_FOURNITURES], ['Temps de travail', F_TEMPS]]
        : [['Surface et carreau', F_SURFACE], ['Temps de travail', F_TEMPS]];
      return `<div class="page-head"><div><h1>${money ? 'Chiffrage d’un chantier' : 'Calculateur de matériaux'}</h1><p>${ch ? `Pour le chantier <a href="#/chantier/${ch.id}" style="text-decoration:underline">${esc(ch.nom)}</a>` : money ? 'Prix approximatif pour le client, temps de travail et matériaux.' : 'Quantités de carrelage, colle et joint, et temps de travail.'}</p></div>
        <div class="actions">${canApply ? `<button class="btn primary" id="apply">${icon('check')}${ch ? 'Enregistrer sur ce chantier' : 'Enregistrer sur un chantier'}</button>` : ''}</div></div>
        <div class="grid g2">
          <div class="card card-pad"><form class="form" id="cf">${groups.map(([t, fs]) => titre(t) + fs.map((f) => fieldHtml(f, data)).join('')).join('')}</form></div>
          <div class="card card-pad stack calc-sticky" id="res"></div>
        </div>
        <p class="tiny muted">Estimation indicative. Joint : formule fabricant ((L+l)/(L×l)) × largeur × épaisseur × 1,6, majorée de 10 %.</p>`;
    },
    mount(root, { query }) {
      const money = app.can('ca', 1);
      const f = qs('#cf', root);
      let r, v;
      const run = () => {
        v = readForm(f, ALL);
        r = chiffrageChantier(v);
        qs('#res', root).innerHTML = resultHtml(r, money);
        if (!query.chantier) saveMem(v);
      };
      f.addEventListener('input', run); f.addEventListener('change', run); run();

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
