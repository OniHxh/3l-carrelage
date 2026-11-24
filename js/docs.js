// Documents imprimables / PDF (dossier de chantier, devis) (via « Imprimer → Enregistrer en PDF », disponible sur tous les appareils).
import { esc, fmtDate, number } from './core.js';
import * as store from './store.js';
import { getBlob } from './local.js';

export function companyBlock(s) {
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

export function printDoc(html, title) { print(html, title); }

function print(html, title) {
  document.querySelector('.print-doc')?.remove();
  const el = document.createElement('div');
  el.className = 'print-doc';
  el.innerHTML = html;
  document.body.append(el);
  const prevTitle = document.title;
  document.title = title;
  document.body.classList.add('printing');
  const urls = [];
  const done = () => { document.body.classList.remove('printing'); document.title = prevTitle; el.remove(); window.removeEventListener('afterprint', done); urls.forEach((u) => URL.revokeObjectURL(u)); };
  window.addEventListener('afterprint', done);
  // Attendre le chargement de toutes les images (logo, photos) avant l'impression, 15 s au plus
  const imgs = [...el.querySelectorAll('img')];
  // Photos stockées sur l'appareil : lues directement (ne dépend pas du service worker)
  const locales = imgs.filter((img) => /^api\/blobs\//.test(img.getAttribute('src') || ''));
  const resolues = Promise.all(locales.map(async (img) => {
    try {
      const rec = await getBlob(img.getAttribute('src').slice('api/blobs/'.length));
      if (rec?.blob) { const u = URL.createObjectURL(rec.blob); urls.push(u); img.src = u; }
    } catch { /* l'image garde son adresse d'origine */ }
  }));
  const charge = (img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; }));
  let parti = false;
  const go = () => { if (parti) return; parti = true; setTimeout(() => window.print(), 80); };
  resolues.then(() => Promise.all(imgs.map(charge))).then(go);
  setTimeout(go, 15000);
}

// ---------- Dossier complet d'un chantier (PDF) ----------
const PHASES = [['avant', 'Avant travaux'], ['pendant', 'Pendant les travaux'], ['apres', 'Après travaux']];
const eurDoc = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(Number(n) || 0);
const n0 = (v) => Number(v) || 0;
const srcPhoto = (p) => p.dataUrl || (p.blobId ? `api/blobs/${p.blobId}` : '');

/** Parties disponibles pour le dossier, avec leur nombre d'éléments. */
export function partiesDossier(c, { money = false } = {}) {
  const recs = store.grouped();
  const de = (t) => (recs[t] || []).filter((x) => x.chantierId === c.id);
  const visite = (recs.visite || []).find((v) => v.chantierId === c.id);
  return [
    ['infos', 'Fiche du chantier (client, adresse, dates, travaux)', 1, true],
    ...(visite ? [['visite', 'Visite chez le client (pièces, mesures, demande)', (visite.pieces || []).length || 1, true]] : []),
    ...(money ? [['montant', 'Montant et devis', de('devis').length || (n0(c.prixHT) ? 1 : 0), true]] : []),
    ['taches', 'Tâches', de('tache').length, true],
    ['journal', 'Journal de chantier', de('note').length, true],
    ['heures', 'Heures de travail', de('pointage').length, true],
    ['photos', 'Photos (avant / pendant / après)', de('photo').length, true],
    ['reception', 'Procès-verbal de réception des travaux (à signer)', 1, c.statut === 'termine'],
  ].filter(([, , n]) => n > 0);
}

/** Imprime le dossier complet du chantier avec les parties choisies. */
export function printDossierChantier(c, parts = {}, { photosParLigne = 2 } = {}) {
  const s = store.settings();
  const recs = store.grouped();
  const de = (t) => (recs[t] || []).filter((x) => x.chantierId === c.id);
  const client = store.get(c.clientId);
  const statut = { prospect: 'Prospect', planifie: 'Planifié', en_cours: 'En cours', en_pause: 'En pause', termine: 'Terminé', annule: 'Annulé' }[c.statut] || '';
  const h2 = (t) => `<h2 class="pd-h2">${t}</h2>`;
  const out = [];

  out.push(`<div class="pd-bar"></div>
    <div class="pd-head"><div><img src="icons/logo.png" alt="">${companyBlock(s)}</div>
      <div class="pd-title"><h1>DOSSIER DE CHANTIER</h1><div class="n">${esc(c.ref || '')}</div><div style="margin-top:6px;font-size:10pt;color:#444">${esc(c.nom || '')}<br>Édité le ${fmtDate(new Date().toISOString().slice(0, 10))}</div></div></div>
    ${clientBlock(client, c)}`);

  if (parts.infos) {
    const temps = de('pointage').reduce((t, p) => t + n0(p.heures), 0);
    const rows = [
      ['Statut', `${statut}${c.statut === 'termine' && c.dateFinReelle ? ` le ${fmtDate(c.dateFinReelle)}` : ''}`],
      ['Période prévue', c.dateDebut || c.dateFin ? `${fmtDate(c.dateDebut)} → ${fmtDate(c.dateFin)}` : ''],
      ['Travaux', c.typeTravaux], ['Surface', c.surface ? `${number(c.surface)} m²` : ''],
      ['Responsable', c.responsableId ? store.userName(c.responsableId) : ''],
      ['Avancement', `${number(c.avancement)} %`], ['Heures pointées', temps ? `${number(temps)} h${n0(c.heuresPrevues) ? ` (prévu : ${number(c.heuresPrevues)} h)` : ''}` : ''],
      ['Accès, contraintes', c.acces], ['Description', c.notes],
    ].filter(([, v]) => v);
    out.push(`${h2('Fiche du chantier')}<table class="pd-table pd-kv"><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(String(v)).replace(/\n/g, '<br>')}</td></tr>`).join('')}</tbody></table>`);
  }

  const visite = (recs.visite || []).find((v) => v.chantierId === c.id);
  if (parts.visite && visite) {
    const sol = (p) => n0(p.surfaceSol) || n0(p.longueur) * n0(p.largeur);
    out.push(`${h2(`Visite chez le client${visite.date ? ` du ${fmtDate(visite.date)}` : ''}`)}
      ${visite.notes ? `<p class="pd-p">${esc(visite.notes).replace(/\n/g, '<br>')}</p>` : ''}
      ${(visite.pieces || []).length ? `<table class="pd-table"><thead><tr><th>Pièce</th><th class="r">Sol</th><th class="r">Murs</th><th>Travaux et détails</th></tr></thead><tbody>
        ${visite.pieces.map((p) => `<tr><td><b>${esc(p.nom || 'Pièce')}</b></td><td class="r">${sol(p) ? number(Math.round(sol(p) * 100) / 100) + ' m²' : '—'}</td><td class="r">${n0(p.surfaceMur) ? number(p.surfaceMur) + ' m²' : '—'}</td>
          <td>${esc((p.travaux || []).join(', ').replace(/_/g, ' '))}${p.notes ? `<br><span style="color:#555">${esc(p.notes)}</span>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}`);
  }

  if (parts.montant) {
    const devis = de('devis').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const lbl = { envoye: 'En attente', accepte: 'Accepté', refuse: 'Refusé' };
    out.push(`${h2('Montant et devis')}
      ${n0(c.prixHT) ? `<div class="pd-totals" style="margin:0 0 10px auto"><div><span>Montant du chantier HT</span><b>${eurDoc(c.prixHT)}</b></div></div>` : ''}
      ${devis.length ? `<table class="pd-table"><thead><tr><th>Devis</th><th>Date</th><th>Statut</th><th class="r">HT</th><th class="r">TTC</th></tr></thead><tbody>
        ${devis.map((d) => `<tr><td>${esc(d.numero ? 'N° ' + d.numero : d.nomFichier || 'Devis')}${d.objet ? `<br><span style="color:#555">${esc(d.objet)}</span>` : ''}</td><td>${fmtDate(d.date)}</td><td>${esc(lbl[d.statut] || '')}</td><td class="r">${d.montantHT != null ? eurDoc(d.montantHT) : '—'}</td><td class="r">${d.montantTTC != null ? eurDoc(d.montantTTC) : '—'}</td></tr>`).join('')}</tbody></table>` : ''}`);
  }

  if (parts.taches) {
    const t = de('tache').sort((a, b) => (a.statut === 'fait') - (b.statut === 'fait') || (a.echeance || '').localeCompare(b.echeance || ''));
    const lbl = { a_faire: 'À faire', en_cours: 'En cours', fait: 'Fait' };
    out.push(`${h2(`Tâches (${t.filter((x) => x.statut === 'fait').length} / ${t.length} faites)`)}<table class="pd-table"><thead><tr><th>Tâche</th><th>Qui</th><th>Échéance</th><th>État</th></tr></thead><tbody>
      ${t.map((x) => `<tr><td>${esc(x.titre)}</td><td>${esc(x.assigneId ? store.userName(x.assigneId) : '')}</td><td>${fmtDate(x.echeance)}</td><td>${esc(lbl[x.statut] || '')}${x.faitLe ? ` le ${fmtDate(x.faitLe)}` : ''}</td></tr>`).join('')}</tbody></table>`);
  }

  if (parts.journal) {
    const notes = de('note').sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a._createdAt || 0) - (b._createdAt || 0));
    out.push(`${h2('Journal de chantier')}<table class="pd-table"><tbody>${notes.map((n) => `<tr><td style="width:110px;white-space:nowrap"><b>${fmtDate(n.date)}</b><br><span style="color:#777">${esc(store.userName(n._createdBy))}</span></td><td>${esc(n.texte).replace(/\n/g, '<br>')}</td></tr>`).join('')}</tbody></table>`);
  }

  if (parts.heures) {
    const h = de('pointage').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const parUser = {};
    for (const p of h) parUser[p.userId] = (parUser[p.userId] || 0) + n0(p.heures);
    const total = h.reduce((t, p) => t + n0(p.heures), 0);
    out.push(`${h2(`Heures de travail · ${number(total)} h`)}
      <table class="pd-table" style="margin-bottom:10px"><thead><tr><th>Personne</th><th class="r">Heures</th></tr></thead><tbody>${Object.entries(parUser).sort((a, b) => b[1] - a[1]).map(([u, n]) => `<tr><td>${esc(store.userName(u))}</td><td class="r">${number(n)} h</td></tr>`).join('')}</tbody></table>
      <table class="pd-table"><thead><tr><th>Date</th><th>Personne</th><th>Commentaire</th><th class="r">Heures</th></tr></thead><tbody>${h.map((p) => `<tr><td>${fmtDate(p.date)}</td><td>${esc(store.userName(p.userId))}</td><td>${esc(p.commentaire || '')}</td><td class="r">${number(p.heures)} h</td></tr>`).join('')}</tbody></table>`);
  }

  if (parts.photos) {
    const photos = de('photo').sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a._createdAt || 0) - (b._createdAt || 0));
    const groupes = PHASES.map(([k, l]) => [l, photos.filter((p) => (p.phase || 'pendant') === k)]).filter(([, l]) => l.length);
    out.push(`<div class="pd-break"></div>${h2(`Photos (${photos.length})`)}
      ${groupes.map(([l, ps]) => `<h3 class="pd-h3">${l}</h3><div class="pd-photos" style="grid-template-columns:repeat(${photosParLigne},1fr)">${ps.map((p) => `<figure><img src="${esc(srcPhoto(p))}" alt=""><figcaption>${fmtDate(p.date)}${p.legende ? ` · ${esc(p.legende)}` : ''}</figcaption></figure>`).join('')}</div>`).join('')}`);
  }

  if (parts.reception) {
    out.push(`<div class="pd-break"></div>${h2('Procès-verbal de réception des travaux')}
      <p class="pd-p">Chantier : <b>${esc(c.nom || '')}</b>${c.adresse || c.ville ? `, ${esc([c.adresse, c.cp, c.ville].filter(Boolean).join(' '))}` : ''}.<br>
      Entreprise : <b>${esc(s.entreprise?.raisonSociale || '3L Carrelage')}</b>. Client (maître d’ouvrage) : <b>${esc(client?.nom || '……………………')}</b>.</p>
      <p class="pd-p">Après visite des travaux réalisés, le maître d’ouvrage déclare :</p>
      <p class="pd-p">☐ prononcer la réception des travaux <b>sans réserve</b>.<br>☐ prononcer la réception des travaux <b>avec les réserves</b> suivantes, que l’entreprise s’engage à lever dans un délai de ……… jours :</p>
      <div class="pd-lines"></div>
      <p class="pd-p">Date de réception : ……… / ……… / ………………    Fait à : ………………………………</p>
      <p class="pd-p" style="color:#555;font-size:8.5pt">La réception fait courir les garanties de parfait achèvement (1 an), de bon fonctionnement (2 ans) et décennale (10 ans).${s.entreprise?.assuranceDecennale ? ` Assurance décennale : ${esc(s.entreprise.assuranceDecennale)}.` : ''}</p>
      <div class="pd-sign"><div>Le maître d’ouvrage<br>(signature précédée de « Lu et approuvé »)</div><div>L’entreprise</div></div>`);
  }

  print(out.join(''), `Dossier ${c.ref || ''} ${c.nom || ''}`.trim());
}
