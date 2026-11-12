// Rapport de chantier imprimable / PDF (via « Imprimer → Enregistrer en PDF », disponible sur tous les appareils).
import { esc, fmtDate, number } from './core.js';
import * as store from './store.js';

function companyBlock(s) {
  const e = s.entreprise || {};
  return `<div class="pd-company">
    <b style="font-size:11pt;color:#171717">${esc(e.raisonSociale || '3L Carrelage')}</b>${e.formeJuridique ? ` — ${esc(e.formeJuridique)}` : ''}<br>
    ${esc(e.adresse || '')}${e.adresse ? '<br>' : ''}${esc([e.cp, e.ville].filter(Boolean).join(' '))}<br>
    ${e.tel ? `Tél. ${esc(e.tel)}<br>` : ''}${e.email ? esc(e.email) + '<br>' : ''}
    ${e.siret ? `SIRET ${esc(e.siret)}` : ''}
  </div>`;
}

function clientBlock(client, chantier) {
  return `<div class="pd-parties">
    <div class="pd-box"><div class="lbl">Client</div><b>${esc(client?.nom || '—')}</b><br>${esc(client?.adresse || '')}<br>${esc([client?.cp, client?.ville].filter(Boolean).join(' '))}${client?.email ? `<br>${esc(client.email)}` : ''}${client?.tel ? `<br>${esc(client.tel)}` : ''}</div>
    <div class="pd-box"><div class="lbl">Chantier</div>${chantier ? `<b>${esc(chantier.nom)}</b><br>${esc(chantier.adresse || '')}<br>${esc([chantier.cp, chantier.ville].filter(Boolean).join(' '))}` : '—'}</div>
  </div>`;
}

export function printChantierReport(c, extra) {
  const s = store.settings();
  const client = store.get(c.clientId);
  const html = `<div class="pd-bar"></div>
    <div class="pd-head"><div><img src="icons/logo.png" alt="3L Carrelage">${companyBlock(s)}</div>
      <div class="pd-title"><h1>RAPPORT DE CHANTIER</h1><div class="n">${esc(c.ref || '')}</div><div style="margin-top:6px;font-size:10pt;color:#444">Édité le ${fmtDate(new Date().toISOString().slice(0, 10))}</div></div></div>
    ${clientBlock(client, c)}
    <table class="pd-table"><tbody>
      <tr><td>Période</td><td class="r">${fmtDate(c.dateDebut)} → ${fmtDate(c.dateFin)}</td></tr>
      <tr><td>Avancement</td><td class="r">${number(c.avancement)} %</td></tr>
      <tr><td>Surface</td><td class="r">${c.surface ? number(c.surface) + ' m²' : '—'}</td></tr>
      <tr><td>Travaux</td><td class="r">${esc(c.typeTravaux || '—')}</td></tr>
    </tbody></table>
    ${extra || ''}`;
  print(html, `Rapport ${c.nom}`);
}

function print(html, title) {
  document.querySelector('.print-doc')?.remove();
  const el = document.createElement('div');
  el.className = 'print-doc';
  el.innerHTML = html;
  document.body.append(el);
  const prevTitle = document.title;
  document.title = title;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); document.title = prevTitle; el.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // Attendre le chargement du logo avant l'impression
  const img = el.querySelector('img');
  const go = () => setTimeout(() => window.print(), 50);
  if (img && !img.complete) { img.onload = go; img.onerror = go; } else go();
}
