import { esc, icon, number, fmtShort, badge } from '../core.js';
import * as store from '../store.js';
import { app } from '../app.js';
import { dashboardKpis, chiffreAffaires, todayISO, num } from '../../shared/calc.js';

const kpi = (label, value, sub = '', { href, cls = '' } = {}) =>
  `<${href ? `a href="${href}"` : 'div'} class="card kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</${href ? 'a' : 'div'}>`;

const empty = (txt) => `<div class="empty small">${esc(txt)}</div>`;

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? 'Bonne nuit' : h < 18 ? 'Bonjour' : 'Bonsoir';
}

export default {
  main: {
    title: 'Accueil',
    render() {
      const recs = store.grouped();
      const k = dashboardKpis(recs);
      const today = todayISO();
      const client = (id) => store.get(id)?.nom || '';
      const first = app.user.name.split(' ')[0];
      const dateStr = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

      // Agenda du jour
      const evToday = recs.evenement.filter((e) => e.date === today || (e.dateFin && e.date <= today && e.dateFin >= today)).sort((a, b) => (a.heureDebut || '').localeCompare(b.heureDebut || ''));
      const mesTaches = recs.tache.filter((t) => t.statut !== 'fait' && (!t.assigneId || t.assigneId === app.user.id) && t.echeance && t.echeance <= today);

      // Alertes priorisées
      const alerts = [];
      for (const x of k.chantiersRisque) alerts.push({ lvl: x.r.niveau === 'eleve' ? 'red' : 'amber', ic: 'site', t: `${x.c.nom} — ${x.r.niveau === 'eleve' ? 'en retard' : 'à surveiller'}`, s: x.r.raisons.join(' · '), href: `#/chantier/${x.c.id}` });
      if (k.tachesRetard.length) alerts.push({ lvl: 'amber', ic: 'tasks', t: `${k.tachesRetard.length} tâche(s) en retard`, s: k.tachesRetard.slice(0, 3).map((t) => t.titre).join(' · '), href: '#/taches?f=retard' });

      const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0);
      const ca = app.can('ca', 1) ? chiffreAffaires(recs) : null;
      const enCours = k.chantiersEnCours.slice().sort((a, b) => (a.dateFin || '9').localeCompare(b.dateFin || '9'));
      const aVenir = k.chantiersAVenir.slice().sort((a, b) => (a.dateDebut || '9').localeCompare(b.dateDebut || '9'));
      const siteRow = (c) => `<a class="li" href="#/chantier/${c.id}">
        <span class="ic">${icon('site')}</span>
        <div class="grow" style="min-width:0"><div class="t" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.nom)}</div>
          <div class="s">${esc(c.ville || client(c.clientId) || '')}${c.dateFin ? ` · fin ${fmtShort(c.dateFin)}` : ''}</div>
          <div class="progress ${num(c.avancement) >= 100 ? 'green' : ''}" style="margin-top:6px"><i style="width:${num(c.avancement)}%"></i></div></div>
        <b class="num" style="min-width:44px;text-align:right">${num(c.avancement)} %</b></a>`;

      return `
      <div class="page-head">
        <div><h1>${greeting()} ${esc(first)}</h1><p style="text-transform:capitalize">${dateStr}</p></div>
        <div class="actions">
          ${app.can('chantiers', 2) ? `<a class="btn" href="#/chantiers?photo=1">${icon('camera')}<span class="lbl">Photo</span></a><a class="btn primary" href="#/chantiers?nouveau=1">${icon('plus')}Nouveau chantier</a>` : ''}
        </div>
      </div>

      <div class="grid ${ca ? 'g5' : 'g4'}" style="margin-bottom:16px">
        ${kpi('Chantiers en cours', k.chantiersEnCours.length, `${k.chantiersAVenir.length} à venir · ${k.chantiersTermines.length} terminés`, { href: '#/chantiers?f=en_cours', cls: 'hero' })}
        ${kpi('Chantiers en retard', k.chantiersRetard.length, `${k.chantiersRisque.length} à surveiller`, { href: '#/chantiers?f=risque', cls: k.chantiersRetard.length ? 'alert' : '' })}
        ${kpi('Tâches en retard', k.tachesRetard.length, 'non terminées, échéance passée', { href: '#/taches?f=retard', cls: k.tachesRetard.length ? 'alert' : '' })}
        ${kpi('Heures cette semaine', `${number(k.heuresSemaine)} h`, 'pointées par l’équipe', { href: '#/planning' })}
        ${ca ? kpi(`CA ${ca.annee} (HT)`, eur(ca.ca), `${ca.termines.length} chantier(s) terminé(s) · ${eur(ca.caEnCours)} en cours`, { href: '#/ca' }) : ''}
      </div>

      <div class="grid g3">
        <div class="card span2">
          <div class="card-head"><h2>Chantiers en cours</h2><a class="card-link" href="#/chantiers?f=en_cours">Tout voir →</a></div>
          <div class="list">${enCours.map(siteRow).join('') || empty('Aucun chantier en cours.')}</div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Aujourd’hui</h2><a class="card-link" href="#/planning">Planning →</a></div>
          <div class="list">
            ${evToday.map((e) => `<a class="li" href="#/planning"><span class="ic">${icon('clock')}</span><div class="grow"><div class="t">${esc(e.titre)}</div><div class="s">${esc(e.heureDebut || '')}${e.heureFin ? '–' + esc(e.heureFin) : ''} ${e.chantierId ? '· ' + esc(store.get(e.chantierId)?.nom || '') : ''}</div></div></a>`).join('')}
            ${mesTaches.map((t) => `<a class="li" href="#/taches"><span class="ic ${t.echeance < today ? 'red' : ''}">${icon('tasks')}</span><div class="grow"><div class="t">${esc(t.titre)}</div><div class="s">${t.echeance < today ? 'En retard · ' : ''}${fmtShort(t.echeance)}</div></div></a>`).join('')}
            ${!evToday.length && !mesTaches.length ? empty('Rien de prévu aujourd’hui.') : ''}
          </div>
        </div>

        <div class="card span2">
          <div class="card-head"><h2>À traiter</h2><span class="badge ${alerts.some((a) => a.lvl === 'red') ? 'red' : ''}">${alerts.length}</span></div>
          <div class="list">${alerts.slice(0, 8).map((a) => `<a class="li" href="${a.href}"><span class="ic ${a.lvl}">${icon(a.ic)}</span><div class="grow"><div class="t">${esc(a.t)}</div><div class="s">${esc(a.s)}</div></div>${icon('chevron')}</a>`).join('') || empty('Tout est sous contrôle.')}</div>
        </div>

        <div class="card">
          <div class="card-head"><h2>À venir</h2><a class="card-link" href="#/chantiers?f=planifie">Tout voir →</a></div>
          <div class="list">${aVenir.slice(0, 6).map((c) => `<a class="li" href="#/chantier/${c.id}"><div class="grow"><div class="t">${esc(c.nom)}</div><div class="s">${c.dateDebut ? `Début ${fmtShort(c.dateDebut)}` : 'Date à fixer'}${c.ville ? ' · ' + esc(c.ville) : ''}</div></div>${badge('chantier', c.statut)}</a>`).join('') || empty('Aucun chantier planifié.')}</div>
        </div>
      </div>`;
    },
  },
};
