// Devis simplifié depuis le calculateur : lignes rédigées automatiquement, modifiables, puis PDF (Imprimer → Enregistrer en PDF).
import { esc, qs, qsa, fmtDate, icon } from './core.js';
import * as store from './store.js';
import { modal, toast } from './ui.js';
import { printDoc, companyBlock } from './docs.js';
import { SITUATIONS, num, round2, todayISO } from '../shared/calc.js';

const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const nb = (n) => (Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const opt = (k, v) => SITUATIONS[k]?.options.find((o) => o[0] === v)?.[1];
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '');

/** Lignes du devis à partir des valeurs du calculateur (v) et du résultat (r). */
export function lignesDevis(v, r) {
  const L = [];
  const add = (designation, qte, unite, pu) => { if (num(qte) > 0 && num(pu) > 0) L.push({ designation, qte: round2(qte), unite, pu: round2(pu) }); };
  const cClient = v.carrelageFourni === 'client', pClient = v.produitsFourni === 'client';
  const format = num(v.formatL) && num(v.formatH) ? `format ${nb(v.formatL)} × ${nb(v.formatH)} cm` : '';
  const pose = lower((opt('typePose', v.typePose) || 'droite').split(/ \/ | \(/)[0]);
  const mat = v.materiau && v.materiau !== 'gres' ? lower(opt('materiau', v.materiau)) : '';
  const joints = v.joints === 'epoxy' ? 'joints époxy' : v.joints === 'fin' ? 'joints fins' : 'joints ciment';
  const collage = pClient ? 'collage au mortier-colle et joints (produits fournis par le client)' : `collage au mortier-colle C2 et ${joints}`;
  const fourni = cClient ? ', carrelage fourni par le client' : '';
  const desc = (quoi) => [quoi, mat, format, `pose ${pose}`, collage].filter(Boolean).join(', ') + fourni + '.';

  add(desc('Pose de carrelage au sol'), r.surfaceSol, 'm²', v.prixPoseM2);
  add(desc(`Pose de faïence murale${v.hauteur === 'escabeau' ? ' jusqu’au plafond' : ''}`) + ' Coupes, angles et finitions compris.', r.surfaceMur, 'm²', v.prixFaienceM2);
  add('Dépose de l’ancien revêtement de sol, piquage de la colle et préparation du support.', r.surfaceSol, 'm²', v.prixDeposeM2);
  add(pClient ? 'Application du primaire et du ragréage (produits fournis par le client) pour mise à niveau du support.' : 'Fourniture et application d’un primaire d’accrochage et d’un ragréage autolissant pour mise à niveau du support.', r.surfaceSol, 'm²', v.prixRagreageM2);
  add(pClient ? 'Réalisation d’une chape (matériaux fournis par le client).' : 'Fourniture et réalisation d’une chape.', v.surfaceChape, 'm²', v.prixChapeM2);
  add(pClient ? 'Mise en œuvre du système d’étanchéité sous carrelage (produits fournis par le client) : primaire, bandes d’angle, manchettes et deux couches.' : 'Fourniture et mise en œuvre d’un système d’étanchéité sous carrelage (SPEC) : primaire, bandes d’angle, manchettes et deux couches, zones de douche.', v.surfaceEtancheite, 'm²', v.prixEtancheiteM2);
  add(`Pose de plinthes${cClient ? ' (fournies par le client)' : ''}, joints compris.`, v.plinthesMl, 'ml', v.prixPlintheMl);
  add(pClient ? 'Pose de profilés de finition, seuils et nez de marche (fournis par le client).' : 'Fourniture et pose de profilés de finition, seuils et nez de marche.', v.profilesMl, 'ml', v.prixProfileMl);
  add(`Pose de carrelage sur marches d’escalier (marche et contremarche), coupes et finitions comprises${cClient ? ', carrelage fourni par le client' : ''}.`, v.nbMarches, 'u', v.prixMarche);
  add('Création d’une douche à l’italienne : forme de pente, fourniture et pose du siphon, raccordement à l’évacuation existante (hors carrelage).', v.nbDouches, 'u', v.forfaitDouche);
  add('Évacuation des gravats en déchetterie et nettoyage de fin de chantier.', r.evacuation ? 1 : 0, 'forfait', r.evacuation);
  add('Frais de déplacement.', r.deplacement ? 1 : 0, 'forfait', r.deplacement);
  // Fournitures revendues avec la marge
  const k = 1 + num(v.margeFournituresPct) / 100;
  if (!cClient) add(`Fourniture du carrelage${format ? ' ' + format : ''} (pertes et coupes comprises).`, r.surfaceCommande, 'm²', num(v.prixCarrelageM2) * k);
  if (!pClient) {
    add('Fourniture du mortier-colle (sacs de 25 kg).', r.sacsColle, 'sac', num(v.prixSacColle) * k);
    add('Fourniture du joint.', Math.ceil(r.jointKg), 'kg', num(v.prixJointKg) * k);
  }
  add('Petites fournitures (primaire, croisillons, protections…).', num(v.autresFrais) ? 1 : 0, 'forfait', num(v.autresFrais) * k);
  return L;
}

const UNITES = ['m²', 'ml', 'u', 'forfait', 'sac', 'kg', 'h', 'jour'];

/** Fenêtre d'aperçu du devis : client, lignes modifiables, puis PDF. */
export function devisModal(v, r, { client = {}, chantier = null } = {}) {
  const s = store.settings();
  const lignes = lignesDevis(v, r);
  const tva = num(v.tva) || 10;
  const row = (l, i) => `<tr data-i="${i}">
      <td><textarea class="input" name="designation" rows="3">${esc(l.designation)}</textarea></td>
      <td><input class="input" name="qte" type="number" inputmode="decimal" step="any" min="0" value="${l.qte}"></td>
      <td><select class="input" name="unite">${[...new Set([l.unite, ...UNITES])].map((u) => `<option ${u === l.unite ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></td>
      <td><input class="input" name="pu" type="number" inputmode="decimal" step="any" min="0" value="${l.pu}"></td>
      <td class="r num" data-total></td>
      <td><button type="button" class="btn ghost sm icon-only" data-del title="Retirer la ligne">${icon('trash')}</button></td></tr>`;
  const m = modal({
    title: 'Devis (PDF)', wide: true,
    body: `<div class="stack">
      <p class="small muted" style="margin:0">Les prestations sont rédigées d’après le calculateur. Modifiez les textes, quantités et prix si besoin, puis « Enregistrer en PDF » (dans la fenêtre d’impression, choisissez « Enregistrer au format PDF »).</p>
      <div class="form">
        <label class="field"><span>Client</span><input class="input" name="c_nom" value="${esc(client.nom || '')}"></label>
        <label class="field"><span>Téléphone / e-mail</span><input class="input" name="c_contact" value="${esc([client.tel, client.email].filter(Boolean).join(' · '))}"></label>
        <label class="field full"><span>Adresse du chantier</span><input class="input" name="c_adresse" value="${esc([client.adresse, [client.cp, client.ville].filter(Boolean).join(' ')].filter(Boolean).join(', '))}"></label>
        <label class="field"><span>Objet</span><input class="input" name="objet" value="${esc(chantier?.nom || 'Travaux de carrelage')}"></label>
        <label class="field"><span>N° de devis (facultatif)</span><input class="input" name="numero" placeholder="Ex. D-2026-014"></label>
        <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${todayISO()}"></label>
        <label class="field"><span>Validité (jours)</span><input class="input" type="number" name="validite" value="30" min="1"></label>
      </div>
      <div class="table-wrap"><table class="table devis-edit"><thead><tr><th>Désignation</th><th>Qté</th><th>Unité</th><th>PU HT</th><th class="r">Total HT</th><th></th></tr></thead>
        <tbody>${lignes.map(row).join('')}</tbody></table></div>
      <div><button type="button" class="btn sm" id="add-line">${icon('plus')}Ajouter une ligne</button></div>
      <div class="devis-totaux" id="totaux"></div>
      <label class="field"><span>Conditions et remarques (en bas du devis)</span><textarea class="input" name="notes" rows="4">${esc(conditions(v, tva))}</textarea></label>
    </div>`,
    foot: `<button class="btn" data-close>Fermer</button><button class="btn primary" id="pdf">${icon('download')}Enregistrer en PDF</button>`,
  });
  const el = m.el;
  const tbody = qs('.devis-edit tbody', el);
  const lire = () => qsa('tr[data-i]', tbody).map((tr) => ({
    designation: qs('[name=designation]', tr).value.trim(), qte: num(qs('[name=qte]', tr).value), unite: qs('[name=unite]', tr).value, pu: num(qs('[name=pu]', tr).value),
  })).filter((l) => l.designation || l.qte * l.pu);
  const calc = () => {
    for (const tr of qsa('tr[data-i]', tbody)) qs('[data-total]', tr).textContent = eur(num(qs('[name=qte]', tr).value) * num(qs('[name=pu]', tr).value));
    const ht = round2(lire().reduce((t, l) => t + round2(l.qte * l.pu), 0));
    const tv = round2((ht * tva) / 100);
    qs('#totaux', el).innerHTML = `<div><span>Total HT</span><b>${eur(ht)}</b></div><div><span>TVA ${nb(tva)} %</span><b>${eur(tv)}</b></div><div class="ttc"><span>Total TTC</span><b>${eur(ht + tv)}</b></div>`;
    return { ht, tv };
  };
  el.addEventListener('input', calc);
  el.addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]');
    if (d) { d.closest('tr').remove(); calc(); }
  });
  qs('#add-line', el).addEventListener('click', () => {
    tbody.insertAdjacentHTML('beforeend', row({ designation: '', qte: 1, unite: 'forfait', pu: 0 }, Date.now()));
    qs('tr:last-child textarea', tbody).focus(); calc();
  });
  calc();
  qs('#pdf', el).addEventListener('click', () => {
    const val = (n) => qs(`[name=${n}]`, el).value.trim();
    const ls = lire();
    if (!ls.length) { toast('Aucune ligne dans le devis.'); return; }
    const { ht, tv } = calc();
    const date = val('date') || todayISO();
    const html = `<div class="pd-bar"></div>
      <div class="pd-head"><div><img src="icons/logo.png" alt="">${companyBlock(s)}</div>
        <div class="pd-title"><h1>DEVIS</h1>${val('numero') ? `<div class="n">N° ${esc(val('numero'))}</div>` : ''}<div style="margin-top:6px;font-size:10pt;color:#444">Date : ${fmtDate(date)}<br>Valable ${esc(val('validite') || '30')} jours</div></div></div>
      <div class="pd-parties">
        <div class="pd-box"><div class="lbl">Client</div><b>${esc(val('c_nom') || '—')}</b>${val('c_contact') ? `<br>${esc(val('c_contact'))}` : ''}</div>
        <div class="pd-box"><div class="lbl">Chantier</div><b>${esc(val('objet'))}</b>${val('c_adresse') ? `<br>${esc(val('c_adresse'))}` : ''}</div>
      </div>
      <table class="pd-table"><thead><tr><th>Désignation</th><th class="r">Qté</th><th>Unité</th><th class="r">PU HT</th><th class="r">Total HT</th></tr></thead><tbody>
        ${ls.map((l) => `<tr><td>${esc(l.designation).replace(/\n/g, '<br>')}</td><td class="r">${nb(l.qte)}</td><td>${esc(l.unite)}</td><td class="r">${eur(l.pu)}</td><td class="r">${eur(l.qte * l.pu)}</td></tr>`).join('')}
      </tbody></table>
      <div class="pd-totals"><div><span>Total HT</span><b>${eur(ht)}</b></div><div><span>TVA ${nb(tva)} %</span><b>${eur(tv)}</b></div><div class="ttc"><span>Total TTC</span><span>${eur(ht + tv)}</span></div></div>
      ${val('notes') ? `<div class="pd-foot">${esc(val('notes')).replace(/\n/g, '<br>')}</div>` : ''}
      ${s.entreprise?.assuranceDecennale ? `<div class="pd-foot">Assurance décennale : ${esc(s.entreprise.assuranceDecennale)}</div>` : ''}
      <div class="pd-sign"><div>Date et signature du client, précédées de la mention « Bon pour accord »</div><div>L’entreprise</div></div>`;
    printDoc(html, `Devis ${val('c_nom') || ''} ${date}`.trim());
  });
}

function conditions(v, tva) {
  const c = [];
  if (tva === 10) c.push('TVA à 10 % : travaux de rénovation dans un logement achevé depuis plus de 2 ans (attestation à signer par le client).');
  if (v.carrelageFourni === 'client') c.push('Carrelage fourni par le client : la quantité, la qualité et les défauts du carrelage ne relèvent pas de notre responsabilité. Prévoir 10 % de pertes.');
  if (v.produitsFourni === 'client') c.push('Colle, joint et produits (primaire, ragréage, étanchéité) fournis par le client, aux références et quantités indiquées par nos soins. Le chantier ne peut avancer que si les produits sont sur place.');
  c.push('Acompte de 30 % à la signature, solde à la fin des travaux.');
  c.push('Tout travail non prévu au présent devis fera l’objet d’un devis complémentaire.');
  return c.join('\n');
}
