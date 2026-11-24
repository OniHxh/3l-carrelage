// Dossier complet d'un chantier en fichier PDF (voir js/pdf.js pour la mise en page).
import { fmtDate, number } from './core.js';
import * as store from './store.js';
import { toastError } from './ui.js';
import { nouveauPdf, proposerPdf, attentePdf } from './pdf.js';

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

/** Crée le PDF du dossier complet du chantier avec les parties choisies, puis le propose au téléchargement. */
export async function pdfDossierChantier(c, parts = {}, { photosParLigne = 2 } = {}) {
  const s = store.settings();
  const recs = store.grouped();
  const de = (t) => (recs[t] || []).filter((x) => x.chantierId === c.id);
  const client = store.get(c.clientId);
  const statut = { prospect: 'Prospect', planifie: 'Planifié', en_cours: 'En cours', en_pause: 'En pause', termine: 'Terminé', annule: 'Annulé' }[c.statut] || '';
  const titreDoc = `Dossier ${c.ref || ''} ${c.nom || ''}`.trim();
  const att = attentePdf();
  try {
    const w = await nouveauPdf(titreDoc);
    await w.entete({ entreprise: s.entreprise || {}, titre: 'DOSSIER DE CHANTIER', ref: c.ref, lignes: [c.nom, `Édité le ${fmtDate(new Date().toISOString().slice(0, 10))}`] });
    w.encadres([
      { label: 'Client', lignes: [client?.nom || '-', client?.adresse, [client?.cp, client?.ville].filter(Boolean).join(' '), client?.tel, client?.email] },
      { label: 'Chantier', lignes: [c.nom, c.adresse, [c.cp, c.ville].filter(Boolean).join(' ')] },
    ]);

    if (parts.infos) {
      const temps = de('pointage').reduce((t, p) => t + n0(p.heures), 0);
      const rows = [
        ['Statut', `${statut}${c.statut === 'termine' && c.dateFinReelle ? ` le ${fmtDate(c.dateFinReelle)}` : ''}`],
        ['Période prévue', c.dateDebut || c.dateFin ? `${fmtDate(c.dateDebut)} -> ${fmtDate(c.dateFin)}` : ''],
        ['Travaux', c.typeTravaux], ['Surface', c.surface ? `${number(c.surface)} m²` : ''],
        ['Responsable', c.responsableId ? store.userName(c.responsableId) : ''],
        ['Avancement', `${number(c.avancement)} %`], ['Heures pointées', temps ? `${number(temps)} h${n0(c.heuresPrevues) ? ` (prévu : ${number(c.heuresPrevues)} h)` : ''}` : ''],
        ['Accès, contraintes', c.acces], ['Description', c.notes],
      ].filter(([, v]) => v);
      w.titre('Fiche du chantier');
      w.tableau([{ label: '', w: 0.27 }, { label: '', w: 0.73 }], rows.map(([k, v]) => [{ t: k, color: [85, 85, 85] }, String(v)]), { entete: false, taille: 9.2 });
    }

    const visite = (recs.visite || []).find((v) => v.chantierId === c.id);
    if (parts.visite && visite) {
      const sol = (p) => n0(p.surfaceSol) || n0(p.longueur) * n0(p.largeur);
      w.titre(`Visite chez le client${visite.date ? ` du ${fmtDate(visite.date)}` : ''}`);
      if (visite.notes) w.texte(visite.notes);
      if ((visite.pieces || []).length) {
        w.tableau([{ label: 'Pièce', w: 0.2 }, { label: 'Sol', w: 0.1, align: 'right' }, { label: 'Murs', w: 0.1, align: 'right' }, { label: 'Travaux et détails', w: 0.6 }],
          visite.pieces.map((p) => [{ t: p.nom || 'Pièce', gras: true }, sol(p) ? `${number(Math.round(sol(p) * 100) / 100)} m²` : '-', n0(p.surfaceMur) ? `${number(p.surfaceMur)} m²` : '-',
            [(p.travaux || []).join(', ').replace(/_/g, ' '), p.notes].filter(Boolean).join('\n')]));
      }
    }

    if (parts.montant) {
      const devis = de('devis').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const lbl = { envoye: 'En attente', accepte: 'Accepté', refuse: 'Refusé' };
      w.titre('Montant et devis');
      if (n0(c.prixHT)) w.totaux([['Montant du chantier HT', eurDoc(c.prixHT)]]);
      if (devis.length) {
        w.tableau([{ label: 'Devis', w: 0.36 }, { label: 'Date', w: 0.16 }, { label: 'Statut', w: 0.14 }, { label: 'HT', w: 0.17, align: 'right' }, { label: 'TTC', w: 0.17, align: 'right' }],
          devis.map((d) => [[d.numero ? `N° ${d.numero}` : d.nomFichier || 'Devis', d.objet].filter(Boolean).join('\n'), fmtDate(d.date), lbl[d.statut] || '', d.montantHT != null ? eurDoc(d.montantHT) : '-', d.montantTTC != null ? eurDoc(d.montantTTC) : '-']));
      }
    }

    if (parts.taches) {
      const t = de('tache').sort((a, b) => (a.statut === 'fait') - (b.statut === 'fait') || (a.echeance || '').localeCompare(b.echeance || ''));
      const lbl = { a_faire: 'À faire', en_cours: 'En cours', fait: 'Fait' };
      w.titre(`Tâches (${t.filter((x) => x.statut === 'fait').length} / ${t.length} faites)`);
      w.tableau([{ label: 'Tâche', w: 0.46 }, { label: 'Qui', w: 0.2 }, { label: 'Échéance', w: 0.16 }, { label: 'État', w: 0.18 }],
        t.map((x) => [x.titre, x.assigneId ? store.userName(x.assigneId) : '', fmtDate(x.echeance), `${lbl[x.statut] || ''}${x.faitLe ? ` le ${fmtDate(x.faitLe)}` : ''}`]));
    }

    if (parts.journal) {
      const notes = de('note').sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a._createdAt || 0) - (b._createdAt || 0));
      w.titre('Journal de chantier');
      w.tableau([{ label: 'Date', w: 0.2 }, { label: 'Note', w: 0.8 }], notes.map((n) => [{ t: `${fmtDate(n.date)}\n${store.userName(n._createdBy)}`, gras: false }, n.texte]));
    }

    if (parts.heures) {
      const h = de('pointage').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const parUser = {};
      for (const p of h) parUser[p.userId] = (parUser[p.userId] || 0) + n0(p.heures);
      const total = h.reduce((t, p) => t + n0(p.heures), 0);
      w.titre(`Heures de travail - ${number(total)} h`);
      w.tableau([{ label: 'Personne', w: 0.8 }, { label: 'Heures', w: 0.2, align: 'right' }], Object.entries(parUser).sort((a, b) => b[1] - a[1]).map(([u, n]) => [store.userName(u), `${number(n)} h`]));
      w.tableau([{ label: 'Date', w: 0.18 }, { label: 'Personne', w: 0.27 }, { label: 'Commentaire', w: 0.4 }, { label: 'Heures', w: 0.15, align: 'right' }], h.map((p) => [fmtDate(p.date), store.userName(p.userId), p.commentaire || '', `${number(p.heures)} h`]));
    }

    if (parts.photos) {
      const photos = de('photo').sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a._createdAt || 0) - (b._createdAt || 0));
      const groupes = PHASES.map(([k, l]) => [l, photos.filter((p) => (p.phase || 'pendant') === k)]).filter(([, l]) => l.length);
      w.page();
      w.titre(`Photos (${photos.length})`);
      let fait = 0;
      for (const [l, ps] of groupes) {
        w.sousTitre(l);
        const base = fait;
        await w.photos(ps.map((p) => ({ src: srcPhoto(p), legende: [fmtDate(p.date), p.legende].filter(Boolean).join(' - ') })), photosParLigne, (n) => att.maj(`Ajout des photos… ${base + n} / ${photos.length}`));
        fait += ps.length;
      }
    }

    if (parts.reception) {
      w.page();
      w.titre('Procès-verbal de réception des travaux');
      w.texte(`Chantier : ${c.nom || ''}${c.adresse || c.ville ? `, ${[c.adresse, c.cp, c.ville].filter(Boolean).join(' ')}` : ''}.`);
      w.texte(`Entreprise : ${s.entreprise?.raisonSociale || '3L Carrelage'}.   Client (maître d’ouvrage) : ${client?.nom || '……………………'}.`);
      w.texte('Après visite des travaux réalisés, le maître d’ouvrage déclare :');
      w.case('prononcer la réception des travaux SANS RÉSERVE.');
      w.case('prononcer la réception des travaux AVEC LES RÉSERVES suivantes, que l’entreprise s’engage à lever dans un délai de ……… jours :');
      w.lignesVides(5);
      w.texte('Date de réception : ……… / ……… / ………………        Fait à : ………………………………');
      w.texte(`La réception fait courir les garanties de parfait achèvement (1 an), de bon fonctionnement (2 ans) et décennale (10 ans).${s.entreprise?.assuranceDecennale ? ` Assurance décennale : ${s.entreprise.assuranceDecennale}.` : ''}`, { size: 8.5, color: [85, 85, 85] });
      w.espace(2);
      w.signatures(['Le maître d’ouvrage (signature précédée de « Lu et approuvé »)', 'L’entreprise']);
    }

    att.maj('Finalisation…');
    const blob = w.fin();
    att.close();
    proposerPdf(blob, titreDoc);
  } catch (e) {
    att.close();
    toastError(e);
  }
}
