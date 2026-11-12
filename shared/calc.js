// Calculs métier partagés entre le serveur (agent IA, contrôles) et le navigateur.
// Aucune dépendance : ce module est servi tel quel au client.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
export const addDays = (iso, n) => {
  const d = new Date(iso || todayISO());
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Évaluation du risque d'un chantier, avec raisons lisibles. */
export function chantierRisque(c, today = todayISO()) {
  const raisons = [];
  if (['termine', 'annule', 'prospect'].includes(c.statut)) return { niveau: 'aucun', raisons };
  const enRetard = c.dateFin && c.dateFin < today;
  if (enRetard) raisons.push(`Date de fin dépassée (${c.dateFin})`);
  if (c.dateDebut && c.dateFin && c.statut === 'en_cours') {
    const total = Math.max(1, daysBetween(c.dateDebut, c.dateFin));
    const ecoule = Math.min(total, Math.max(0, daysBetween(c.dateDebut, today)));
    const attendu = (ecoule / total) * 100;
    if (attendu - num(c.avancement) > 20) raisons.push(`Avancement ${num(c.avancement)} % pour ${Math.round(attendu)} % attendu`);
  }
  const niveau = enRetard || raisons.length >= 2 ? 'eleve' : raisons.length ? 'moyen' : 'faible';
  return { niveau, raisons, enRetard };
}

/** Indicateurs du tableau de bord. `recs` = { type: [records] }. */
export function dashboardKpis(recs, today = todayISO()) {
  const ch = recs.chantier;
  const enCours = ch.filter((c) => c.statut === 'en_cours');
  const aVenir = ch.filter((c) => c.statut === 'planifie');
  const termines = ch.filter((c) => c.statut === 'termine');
  const risques = ch.map((c) => ({ c, r: chantierRisque(c, today) }));
  const chantiersRetard = risques.filter((x) => x.r.enRetard).map((x) => x.c);
  const chantiersRisque = risques.filter((x) => x.r.niveau === 'eleve' || x.r.niveau === 'moyen');
  const tachesRetard = recs.tache.filter((t) => t.statut !== 'fait' && t.echeance && t.echeance < today);
  const debut = addDays(today, -((new Date(today + 'T12:00:00').getDay() + 6) % 7));
  const heuresSemaine = round2(recs.pointage.filter((p) => p.date >= debut && p.date <= today).reduce((s, p) => s + num(p.heures), 0));
  return {
    chantiersEnCours: enCours, chantiersAVenir: aVenir, chantiersTermines: termines,
    chantiersRetard, chantiersRisque, tachesRetard, heuresSemaine,
  };
}

/** Calculateur de matériaux pour la pose de carrelage. */
export function calculCarrelage({ surface, longueur, largeur, formatL, formatH, joint = 3, perte = 10, m2ParCarton = 1.44, epaisseur = 9, colleKgM2 = 5, sacColleKg = 25 }) {
  const S = num(surface) || num(longueur) * num(largeur);
  const pertes = num(perte) / 100;
  const surfaceCommande = round2(S * (1 + pertes));
  const cartons = num(m2ParCarton) > 0 ? Math.ceil(surfaceCommande / num(m2ParCarton)) : null;
  const L = num(formatL) * 10, H = num(formatH) * 10; // cm -> mm
  const j = num(joint), e = num(epaisseur);
  // Formule fabricant usuelle : kg/m² = ((L + H) / (L × H)) × j × e × 1,6
  const jointKgM2 = L > 0 && H > 0 ? ((L + H) / (L * H)) * j * e * 1.6 : 0;
  const jointKg = round2(jointKgM2 * S * 1.1);
  const colleKg = round2(S * num(colleKgM2));
  const sacsColle = Math.ceil(colleKg / (num(sacColleKg) || 25));
  const nbCarreaux = L > 0 && H > 0 ? Math.ceil((surfaceCommande * 1e6) / ((L + j) * (H + j))) : null;
  return { surface: round2(S), surfaceCommande, cartons, nbCarreaux, jointKg, jointKgM2: round2(jointKgM2), colleKg, sacsColle };
}

/**
 * Chiffrage approximatif d'un chantier de carrelage.
 * Renvoie le prix de vente (HT/TTC), le temps estimé et les matériaux.
 */
export function chiffrageChantier(v = {}) {
  const mat = calculCarrelage(v);
  const S = mat.surface;
  const fourni = v.carrelageFourni !== 'client';
  // Main-d'œuvre facturée
  const pose = round2(S * num(v.prixPoseM2));
  const depose = round2(S * num(v.prixDeposeM2));
  const ragreage = round2(S * num(v.prixRagreageM2));
  const plinthes = round2(num(v.plinthesMl) * num(v.prixPlintheMl));
  const mainOeuvreHT = round2(pose + depose + ragreage + plinthes);
  // Fournitures (prix d'achat)
  const carrelageAchat = fourni ? round2(mat.surfaceCommande * num(v.prixCarrelageM2)) : 0;
  const colleAchat = round2(mat.sacsColle * num(v.prixSacColle));
  const jointAchat = round2(Math.ceil(mat.jointKg) * num(v.prixJointKg));
  const fournituresAchat = round2(carrelageAchat + colleAchat + jointAchat + num(v.autresFrais));
  const fournituresVente = round2(fournituresAchat * (1 + num(v.margeFournituresPct) / 100));
  const totalHT = round2(mainOeuvreHT + fournituresVente);
  const tvaPct = v.tva == null || v.tva === '' ? 10 : num(v.tva);
  const totalTVA = round2(totalHT * tvaPct / 100);
  // Temps
  const rendement = num(v.m2ParJour);              // m² réalisés par jour et par personne
  const personnes = Math.max(1, num(v.personnes) || 1);
  const heuresJour = num(v.heuresParJour) || 8;
  const joursPersonne = rendement > 0 ? round2(S / rendement) : 0;
  const heures = round2(joursPersonne * heuresJour);
  const joursChantier = round2(joursPersonne / personnes);
  return {
    ...mat, pose, depose, ragreage, plinthes, mainOeuvreHT,
    carrelageAchat, colleAchat, jointAchat, fournituresAchat, fournituresVente,
    totalHT, tvaPct, totalTVA, totalTTC: round2(totalHT + totalTVA),
    joursPersonne, heures, joursChantier,
  };
}

/** Temps passé sur un chantier : heures pointées, heures prévues, estimation de fin. */
export function tempsChantier(c, pointages = []) {
  const heures = round2(pointages.filter((p) => p.chantierId === c.id).reduce((s, p) => s + num(p.heures), 0));
  const prevues = num(c.heuresPrevues);
  const av = num(c.avancement);
  // Si 40 % du chantier a pris 20 h, le chantier entier prendra ~50 h
  const heuresFinEstimees = av > 0 && av < 100 && heures > 0 ? round2(heures / (av / 100)) : null;
  return { heures, prevues, depassementPct: prevues > 0 ? round2((heures / prevues) * 100) : null, heuresFinEstimees };
}

const dateCA = (c) => c.dateFinReelle || c.dateFin || c.dateDebut || '';

/** Chiffre d'affaires HT d'une année : chantiers terminés (mois de fin), plus les chantiers en cours. */
export function chiffreAffaires(recs, year, today = todayISO()) {
  const y = String(year || today.slice(0, 4));
  const avecPrix = recs.chantier.filter((c) => num(c.prixHT) > 0);
  const termines = avecPrix.filter((c) => c.statut === 'termine' && dateCA(c).startsWith(y)).sort((a, b) => dateCA(b).localeCompare(dateCA(a)));
  const enCours = y === today.slice(0, 4) ? avecPrix.filter((c) => ['en_cours', 'en_pause', 'planifie'].includes(c.statut)) : [];
  const total = (l) => round2(l.reduce((s, c) => s + num(c.prixHT), 0));
  const mois = Array.from({ length: 12 }, (_, i) => {
    const m = `${y}-${String(i + 1).padStart(2, '0')}`;
    return { mois: m, ca: total(termines.filter((c) => dateCA(c).startsWith(m))) };
  });
  const prev = avecPrix.filter((c) => c.statut === 'termine' && dateCA(c).startsWith(String(Number(y) - 1)));
  return {
    annee: y, termines, enCours, ca: total(termines), caEnCours: total(enCours), caAnneePrecedente: total(prev),
    mois, moyenneParChantier: termines.length ? round2(total(termines) / termines.length) : null,
  };
}
