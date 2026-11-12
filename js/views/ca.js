import { esc, icon, fmtDate, badge } from '../core.js';
import * as store from '../store.js';
import { app } from '../app.js';
import { chiffreAffaires, todayISO, num } from '../../shared/calc.js';

const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0);
const eurK = (n) => (Math.abs(n) >= 10000 ? `${Math.round(n / 1000)} k€` : eur(n));
const MOIS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

/** Histogramme mensuel en HTML (lisible en clair et en sombre, sans bibliothèque). */
export function barres(mois, { valeur, libelle, max } = {}) {
  const top = max || Math.max(1, ...mois.map(valeur));
  const cur = todayISO().slice(0, 7);
  return `<div class="bars">${mois.map((m, i) => {
    const v = valeur(m);
    return `<div class="bar ${m.mois === cur ? 'now' : ''}" title="${esc(MOIS[i])} : ${esc(libelle(v))}">
      <span class="v">${v ? esc(libelle(v)) : ''}</span><i style="height:${Math.round((v / top) * 100)}%"></i><span class="m">${MOIS[i]}</span></div>`;
  }).join('')}</div>`;
}

export default {
  main: {
    title: 'Chiffre d’affaires',
    render({ query }) {
      if (!app.can('ca', 1)) return `<div class="card empty">${icon('shield')}<b>Accès réservé</b></div>`;
      const recs = store.grouped();
      const year = query.annee || todayISO().slice(0, 4);
      const k = chiffreAffaires(recs, year);
      const annees = [...new Set([todayISO().slice(0, 4), ...recs.chantier.map((c) => (c.dateFinReelle || c.dateFin || '').slice(0, 4)).filter(Boolean)])].sort().reverse();
      const evo = k.caAnneePrecedente > 0 ? Math.round(((k.ca - k.caAnneePrecedente) / k.caAnneePrecedente) * 100) : null;
      const kpi = (label, value, sub = '', cls = '') => `<div class="card kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
      return `<div class="page-head"><div><h1>Chiffre d’affaires</h1><p>Montants HT des chantiers terminés, comptés au mois de fin du chantier.</p></div>
        <div class="actions"><select class="input" id="annee" style="width:auto">${annees.map((a) => `<option ${a === year ? 'selected' : ''}>${a}</option>`).join('')}</select></div></div>
        <div class="grid g4" style="margin-bottom:16px">
          ${kpi(`CA ${year} (HT)`, eur(k.ca), `${k.termines.length} chantier(s) terminé(s)`, 'hero')}
          ${kpi(`CA ${Number(year) - 1}`, eur(k.caAnneePrecedente), evo != null ? `${evo >= 0 ? '+' : ''}${evo} % cette année` : '')}
          ${kpi('Moyenne par chantier', k.moyenneParChantier != null ? eur(k.moyenneParChantier) : '—')}
          ${kpi('En cours et à venir', eur(k.caEnCours), `${k.enCours.length} chantier(s) chiffré(s), pas encore terminé(s)`)}
        </div>
        <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>CA par mois · ${esc(year)}</h2></div>
          <div class="card-body">${barres(k.mois, { valeur: (m) => m.ca, libelle: eurK })}</div></div>
        <div class="grid g2">
          <div class="card"><div class="card-head"><h2>Chantiers terminés</h2><span class="badge">${k.termines.length}</span></div>
            <div class="list">${k.termines.map((c) => `<a class="li" href="#/chantier/${c.id}"><div class="grow"><div class="t">${esc(c.nom)}</div><div class="s">Terminé le ${fmtDate(c.dateFinReelle || c.dateFin)}${store.get(c.clientId) ? ' · ' + esc(store.get(c.clientId).nom) : ''}</div></div><b class="num">${eur(c.prixHT)}</b></a>`).join('') || '<div class="empty small">Aucun chantier terminé avec un montant sur cette année.</div>'}</div></div>
          <div class="card"><div class="card-head"><h2>En cours et à venir</h2></div>
            <div class="list">${k.enCours.map((c) => `<a class="li" href="#/chantier/${c.id}"><div class="grow"><div class="t">${esc(c.nom)}</div><div class="s">${num(c.avancement)} % · ${esc(store.get(c.clientId)?.nom || c.ville || '')}</div></div><b class="num">${eur(c.prixHT)}</b>${badge('chantier', c.statut)}</a>`).join('') || '<div class="empty small">—</div>'}</div></div>
        </div>
        <p class="tiny muted">Un chantier compte dans le CA quand il est marqué « Terminé » et qu’il a un montant (saisi dans la fiche ou repris des devis acceptés).</p>`;
    },
    mount(root) {
      root.querySelector('#annee')?.addEventListener('change', (e) => app.go(`#/ca?annee=${e.target.value}`));
    },
  },
};
