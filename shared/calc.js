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
export function chiffrageChantier(v = {}, ref = REFERENCE) {
  const surfaceSol = round2(num(v.surface) || num(v.longueur) * num(v.largeur));
  const surfaceMur = round2(num(v.surfaceMur));
  // Les matériaux couvrent le sol et les murs (faïence)
  const mat = calculCarrelage({ ...v, surface: surfaceSol + surfaceMur });
  const S = surfaceSol;
  const fourni = v.carrelageFourni !== 'client';
  // Temps
  const rendement = num(v.m2ParJour);              // m² réalisés par jour et par personne
  const personnes = Math.max(1, num(v.personnes) || 1);
  const heuresJour = num(v.heuresParJour) || 8;
  const heuresAnnexes = num(v.nbMarches) * 1.5 + num(v.nbDouches) * 12; // marches, receveurs à carreler
  const joursPersonne = round2((rendement > 0 ? mat.surface / rendement : 0) + heuresAnnexes / heuresJour);
  const heures = round2(joursPersonne * heuresJour);
  const joursChantier = round2(joursPersonne / personnes);
  // Main-d'œuvre facturée
  const pose = round2(S * num(v.prixPoseM2));
  const faience = round2(surfaceMur * num(v.prixFaienceM2));
  const depose = round2(S * num(v.prixDeposeM2));
  const ragreage = round2(S * num(v.prixRagreageM2));
  const chape = round2(num(v.surfaceChape) * num(v.prixChapeM2));
  const etancheite = round2(num(v.surfaceEtancheite) * num(v.prixEtancheiteM2));
  const plinthes = round2(num(v.plinthesMl) * num(v.prixPlintheMl));
  const profiles = round2(num(v.profilesMl) * num(v.prixProfileMl));
  const marches = round2(num(v.nbMarches) * num(v.prixMarche));
  const douches = round2(num(v.nbDouches) * num(v.forfaitDouche));
  const evacuation = round2(num(v.evacuationHT));
  // Déplacement : aller-retour chaque jour de chantier, au-delà des km inclus
  const g = ref.gestion;
  const joursTrajet = joursChantier > 0 ? Math.ceil(joursChantier) : 0;
  const km = num(v.distanceKm);
  const deplacementCout = round2(joursTrajet * 2 * km * num(g.prixKm));
  const deplacement = v.facturerDeplacement === 'non' ? 0 : round2(joursTrajet * 2 * Math.max(0, km - num(g.kmInclus)) * num(g.prixKm));
  const mainOeuvreHT = round2(pose + faience + depose + ragreage + chape + etancheite + plinthes + profiles + marches + douches + evacuation + deplacement);
  // Fournitures (prix d'achat)
  const carrelageAchat = fourni ? round2(mat.surfaceCommande * num(v.prixCarrelageM2)) : 0;
  const colleAchat = round2(mat.sacsColle * num(v.prixSacColle));
  const jointAchat = round2(Math.ceil(mat.jointKg) * num(v.prixJointKg));
  const fournituresAchat = round2(carrelageAchat + colleAchat + jointAchat + num(v.autresFrais));
  const fournituresVente = round2(fournituresAchat * (1 + num(v.margeFournituresPct) / 100));
  const totalHT = round2(mainOeuvreHT + fournituresVente);
  const tvaPct = v.tva == null || v.tva === '' ? 10 : num(v.tva);
  const totalTVA = round2(totalHT * tvaPct / 100);
  return {
    ...mat, surfaceSol, surfaceMur,
    pose, faience, depose, ragreage, chape, etancheite, plinthes, profiles, marches, douches, evacuation, deplacement, deplacementCout,
    mainOeuvreHT, carrelageAchat, colleAchat, jointAchat, fournituresAchat, fournituresVente,
    totalHT, tvaPct, totalTVA, totalTTC: round2(totalHT + totalTVA),
    joursPersonne, heures, joursChantier, joursTrajet,
  };
}

// ---------- Aide au chiffrage : prix de référence et indicateurs ----------
// Fourchettes HT courantes à Strasbourg / Bas-Rhin (2026), pose seule, fournitures non comprises,
// pour une situation « standard » (carreaux 30 à 60 cm, pose droite, support sain, accès facile).
// Modifiables dans Paramètres → Prix de référence.
export const PRESTATIONS = [
  { key: 'pose', field: 'prixPoseM2', qte: 'surfaceSol', label: 'Pose carrelage sol', unite: 'm²', min: 35, max: 55, majore: true },
  { key: 'faience', field: 'prixFaienceM2', qte: 'surfaceMur', label: 'Pose faïence murale', unite: 'm²', min: 40, max: 65, majore: true },
  { key: 'depose', field: 'prixDeposeM2', qte: 'surfaceSol', label: 'Dépose ancien carrelage', unite: 'm²', min: 15, max: 30, optionnel: true },
  { key: 'ragreage', field: 'prixRagreageM2', qte: 'surfaceSol', label: 'Ragréage / préparation du support', unite: 'm²', min: 15, max: 30, optionnel: true },
  { key: 'chape', field: 'prixChapeM2', qte: 'surfaceChape', label: 'Chape', unite: 'm²', min: 25, max: 45 },
  { key: 'etancheite', field: 'prixEtancheiteM2', qte: 'surfaceEtancheite', label: 'Étanchéité sous carrelage (SPEC / SEL)', unite: 'm²', min: 25, max: 45 },
  { key: 'plinthe', field: 'prixPlintheMl', qte: 'plinthesMl', label: 'Pose plinthes', unite: 'ml', min: 10, max: 18 },
  { key: 'profile', field: 'prixProfileMl', qte: 'profilesMl', label: 'Profilés, nez de marche, baguettes', unite: 'ml', min: 12, max: 25 },
  { key: 'marche', field: 'prixMarche', qte: 'nbMarches', label: 'Marche d’escalier (pose)', unite: 'marche', min: 70, max: 130, majore: true },
  { key: 'douche', field: 'forfaitDouche', qte: 'nbDouches', label: 'Douche à l’italienne (forme de pente, siphon, hors carrelage)', unite: 'forfait', min: 900, max: 1800 },
  { key: 'evacuation', field: 'evacuationHT', qte: null, label: 'Évacuation des gravats (benne, déchetterie)', unite: 'forfait', min: 100, max: 350, optionnel: true },
];
// Prix d'achat courants des fournitures (négoce, prix artisan HT)
export const FOURNITURES = [
  { key: 'carrelage', field: 'prixCarrelageM2', label: 'Carrelage (achat)', unite: 'm²', min: 15, max: 60 },
  { key: 'colle', field: 'prixSacColle', label: 'Sac de colle 25 kg (C2)', unite: 'sac', min: 14, max: 35 },
  { key: 'joint', field: 'prixJointKg', label: 'Joint', unite: 'kg', min: 2, max: 7 },
  { key: 'margeFournitures', field: 'margeFournituresPct', label: 'Marge sur fournitures', unite: '%', min: 10, max: 30 },
];
// Coûts internes de l'entreprise
export const GESTION = [
  { key: 'coutHoraire', label: 'Coût d’une heure de travail (salaire chargé, €)', value: 32, help: 'Ce que vous coûte réellement une heure d’un poseur.' },
  { key: 'tauxHoraireCible', label: 'Taux horaire visé (€ HT facturé par heure)', value: 50, help: 'Ce qu’une heure de travail doit rapporter, hors fournitures.' },
  { key: 'fraisGenerauxPct', label: 'Frais généraux (% du CA)', value: 15, help: 'Véhicules, assurance décennale, outillage, comptable, local…' },
  { key: 'margeCiblePct', label: 'Bénéfice visé (% du prix HT)', value: 12 },
  { key: 'prixKm', label: 'Coût par km (€)', value: 0.6 },
  { key: 'kmInclus', label: 'Km inclus sans frais (zone Strasbourg)', value: 15, help: 'Distance aller sous laquelle le déplacement n’est pas facturé.' },
  { key: 'minimumHT', label: 'Minimum de facturation par chantier (€ HT)', value: 400 },
  { key: 'rendementBase', label: 'Rendement de base (m² / jour / personne)', value: 10, help: 'Situation standard, tout compris (préparation, pose, joints).' },
];

/** Majorations selon la situation du chantier (en % sur la pose). [valeur, libellé, %] */
export const SITUATIONS = {
  typePose: { label: 'Type de pose', options: [['droite', 'Droite / alignée', 0], ['decalee', 'Décalée (1/2, 1/3)', 5], ['diagonale', 'Diagonale', 15], ['opus', 'Opus / multi-formats', 20], ['chevron', 'Chevron / bâton rompu', 40]] },
  support: { label: 'État du support', options: [['bon', 'Bon : plan, sain, propre', 0], ['existant', 'Pose sur ancien carrelage', 5], ['reprendre', 'À reprendre (fissures, faux niveau)', 10], ['bois', 'Plancher bois', 15]] },
  piece: { label: 'Type de pièce', options: [['ouverte', 'Grande pièce ouverte, peu de découpes', 0], ['standard', 'Pièce standard', 5], ['sdb', 'Salle de bain / WC (beaucoup de découpes)', 15], ['exterieur', 'Extérieur / terrasse', 15]] },
  acces: { label: 'Accès au chantier', options: [['facile', 'Plain-pied ou ascenseur', 0], ['etage', 'Étage sans ascenseur', 8], ['centre', 'Centre de Strasbourg (stationnement, livraison)', 8], ['difficile', 'Accès très difficile', 15]] },
  occupe: { label: 'Logement', options: [['vide', 'Vide / neuf', 0], ['occupe', 'Occupé (protections, rangement, nettoyage)', 8]] },
  delai: { label: 'Délai', options: [['normal', 'Normal', 0], ['urgent', 'Urgent / week-end', 15]] },
};

/** Fusionne les prix de référence enregistrés dans les paramètres avec les valeurs par défaut. */
export function referencePrix(custom = {}) {
  const pick = (list, src = {}) => Object.fromEntries(list.map((p) => {
    const c = src[p.key] || {};
    const min = c.min != null && c.min !== '' ? num(c.min) : p.min;
    const max = c.max != null && c.max !== '' ? num(c.max) : p.max;
    return [p.key, { ...p, min: Math.min(min, max), max: Math.max(min, max) }];
  }));
  const gestion = Object.fromEntries(GESTION.map((p) => {
    const c = custom.gestion?.[p.key];
    return [p.key, c != null && c !== '' ? num(c) : p.value];
  }));
  return { prestations: pick(PRESTATIONS, custom.prestations), fournitures: pick(FOURNITURES, custom.fournitures), gestion };
}
export const REFERENCE = referencePrix();

/** Majoration liée au format du carreau (plus grand côté, en cm). */
export function majorationFormat(L, H) {
  const g = Math.max(num(L), num(H));
  if (!g) return { pct: 0, label: 'Format non renseigné' };
  if (g <= 10) return { pct: 50, label: 'Mosaïque / très petit format' };
  if (g <= 20) return { pct: 15, label: 'Petit format (≤ 20 cm)' };
  if (g <= 60) return { pct: 0, label: 'Format standard' };
  if (g <= 80) return { pct: 15, label: 'Grand format (60 à 80 cm)' };
  if (g <= 120) return { pct: 30, label: 'Très grand format (jusqu’à 120 cm)' };
  return { pct: 50, label: 'Format XXL (> 120 cm, manutention à 2)' };
}

/** Majoration liée à la surface (petits chantiers = installation, découpes, déplacements proportionnellement plus lourds). */
export function majorationSurface(S) {
  const s = num(S);
  if (!s) return { pct: 0, label: '' };
  if (s < 5) return { pct: 40, label: 'Très petite surface (< 5 m²)' };
  if (s < 10) return { pct: 25, label: 'Petite surface (< 10 m²)' };
  if (s < 20) return { pct: 10, label: 'Surface réduite (< 20 m²)' };
  if (s > 100) return { pct: -5, label: 'Grande surface (> 100 m²)' };
  return { pct: 0, label: '' };
}

/** Situe un prix dans une fourchette. */
export function niveauPrix(prix, min, max) {
  const p = num(prix);
  if (!p) return 'vide';
  if (p < min * 0.85) return 'tres_bas';
  if (p < min) return 'bas';
  if (p <= max) return 'ok';
  if (p <= max * 1.2) return 'haut';
  return 'tres_haut';
}
export const NIVEAUX = {
  vide: ['Non renseigné', ''], tres_bas: ['Très bas', 'red'], bas: ['Un peu bas', 'amber'],
  ok: ['Dans le marché', 'green'], haut: ['Un peu haut', 'amber'], tres_haut: ['Très haut', 'red'],
};

/** Nombre au format français (virgule, espaces). */
export const fr = (n) => (Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const arrondi = (n) => (n >= 200 ? Math.round(n / 10) * 10 : n >= 20 ? Math.round(n) : Math.round(n * 2) / 2);

/**
 * Aide au chiffrage : majorations selon la situation, fourchettes ajustées, prix conseillés,
 * rentabilité et alertes. `v` = valeurs saisies, `r` = résultat de chiffrageChantier.
 */
export function aideChiffrage(v = {}, r = chiffrageChantier(v), ref = REFERENCE) {
  const g = ref.gestion;
  // 1. Majorations
  const majorations = [];
  const fmt = majorationFormat(v.formatL, v.formatH);
  if (fmt.pct) majorations.push({ label: fmt.label, pct: fmt.pct });
  const surf = majorationSurface(r.surfaceSol + r.surfaceMur);
  if (surf.pct) majorations.push({ label: surf.label, pct: surf.pct });
  for (const [k, s] of Object.entries(SITUATIONS)) {
    const o = s.options.find((x) => x[0] === v[k]);
    if (o && o[2]) majorations.push({ label: `${s.label} : ${o[1]}`, pct: o[2] });
  }
  const majPct = majorations.reduce((s, m) => s + m.pct, 0);
  const coef = 1 + majPct / 100;

  // 2. Fourchettes par prestation
  const prix = {};
  const lignes = [...Object.values(ref.prestations), ...Object.values(ref.fournitures)];
  for (const p of lignes) {
    const k = p.majore ? coef : 1;
    const min = round2(p.min * k), max = round2(p.max * k);
    const qte = p.qte === undefined ? null : p.qte === null ? 1 : num(p.qte === 'surfaceSol' || p.qte === 'surfaceMur' ? r[p.qte] : v[p.qte]);
    prix[p.field] = { ...p, min, max, conseille: arrondi((min + max) / 2), niveau: niveauPrix(v[p.field], min, max), qte, utile: qte == null || qte > 0 };
  }

  // 3. Rendement conseillé
  const difficulte = Math.max(0, majPct - (surf.pct > 0 ? surf.pct : 0)); // la petite surface ne ralentit pas la pose au m²
  const rendementConseille = round2(num(g.rendementBase) / (1 + difficulte / 100));

  // 4. Rentabilité
  const coutMO = round2(r.heures * num(g.coutHoraire));
  const coutsDirects = round2(r.fournituresAchat + coutMO + r.deplacementCout);
  const fg = num(g.fraisGenerauxPct) / 100, mc = num(g.margeCiblePct) / 100;
  const fraisGeneraux = round2(r.totalHT * fg);
  const benefice = round2(r.totalHT - coutsDirects - fraisGeneraux);
  const beneficePct = r.totalHT > 0 ? round2((benefice / r.totalHT) * 100) : 0;
  const prixPlancher = fg < 1 ? round2(coutsDirects / (1 - fg)) : null;
  const prixConseille = fg + mc < 1 ? round2(coutsDirects / (1 - fg - mc)) : null;
  const tauxHoraireEffectif = r.heures > 0 ? round2((r.totalHT - r.fournituresAchat - r.deplacement) / r.heures) : null;
  const prixM2 = r.surfaceSol + r.surfaceMur > 0 ? round2(r.totalHT / (r.surfaceSol + r.surfaceMur)) : null;
  const rentab = { coutMO, coutsDirects, fraisGeneraux, benefice, beneficePct, prixPlancher, prixConseille, tauxHoraireEffectif, prixM2, minimumHT: num(g.minimumHT) };

  // 5. Verdict global
  let verdict = 'vide';
  if (r.totalHT > 0) {
    if (benefice < 0 || (prixPlancher && r.totalHT < prixPlancher)) verdict = 'perte';
    else if (prixConseille && r.totalHT < prixConseille * 0.97) verdict = 'juste';
    else if (Object.values(prix).some((p) => p.utile && ref.prestations[p.key] && ['haut', 'tres_haut'].includes(p.niveau))) verdict = 'cher'; // au-dessus du marché
    else verdict = 'bon';
  }

  // 6. Alertes et oublis. money = réservé à qui voit les prix.
  const alertes = [];
  const add = (niveau, texte, money = true) => alertes.push({ niveau, texte, money });
  const S = r.surfaceSol + r.surfaceMur;
  const L = Math.max(num(v.formatL), num(v.formatH));
  if (!S) add('info', 'Renseignez la surface (sol et/ou murs) pour obtenir un chiffrage.', false);

  for (const p of Object.values(prix)) {
    if (!p.utile || !S) continue;
    const val = num(v[p.field]);
    const isFourn = !!ref.fournitures[p.key];
    const u = p.unite === '%' ? ' %' : ' €';
    if (isFourn && p.key === 'carrelage' && v.carrelageFourni === 'client') continue;
    if (!val && p.qte > 0 && p.qte !== null && !p.optionnel && !isFourn) add('danger', `${p.label} : ${fr(p.qte)} ${p.unite} prévus mais aucun prix saisi, rien n’est facturé.`);
    else if (p.niveau === 'tres_bas') add(isFourn ? 'info' : 'danger', `${p.label} : ${fr(val)}${u} est très en dessous du marché (${fr(p.min)}–${fr(p.max)}${u}${p.unite === '%' ? '' : ' / ' + p.unite}).`);
    else if (p.niveau === 'bas') add(isFourn ? 'info' : 'warn', `${p.label} : ${fr(val)}${u} est sous la fourchette (${fr(p.min)}–${fr(p.max)}${u}). Conseillé : ${fr(p.conseille)}${u}.`);
    else if (p.niveau === 'tres_haut' && !isFourn) add('info', `${p.label} : ${fr(val)}${u} est au-dessus du marché (${fr(p.min)}–${fr(p.max)}${u}). À justifier auprès du client (contraintes, qualité).`);
  }
  if (num(v.margeFournituresPct) < 10 && v.carrelageFourni !== 'client' && r.fournituresAchat > 0) add('warn', 'Marge sur fournitures sous 10 % : elle couvre à peine le temps d’achat, de transport et la casse.');
  if (v.carrelageFourni === 'client') add('info', 'Carrelage fourni par le client : pas de marge sur le carrelage. Précisez sur le devis que la quantité, la qualité et les défauts du carrelage ne sont pas de votre responsabilité.');

  // Situation et oublis techniques
  if ((v.support === 'reprendre' || v.support === 'bois') && !num(v.prixRagreageM2) && r.surfaceSol > 0) add('warn', v.support === 'bois' ? 'Plancher bois : prévoir une préparation (panneaux, natte de désolidarisation ou ragréage fibré) et la facturer.' : 'Support à reprendre mais aucun ragréage facturé.');
  if (v.support === 'existant') add('info', 'Pose sur ancien carrelage : vérifier l’adhérence, prévoir un primaire d’accrochage et une colle adaptée (C2S1). Attention aux hauteurs de seuil et de portes.', false);
  if (v.support === 'existant' && num(v.prixDeposeM2) > 0) add('warn', 'Dépose facturée alors que la pose est prévue sur l’ancien carrelage : vérifiez la situation.');
  if ((v.piece === 'sdb' || num(v.nbDouches) > 0) && !num(v.surfaceEtancheite)) add('warn', 'Zone de douche : une étanchéité sous carrelage (SPEC / SEL) est nécessaire. Ajoutez la surface concernée.', false);
  if (v.piece === 'exterieur') add('info', 'Extérieur : carrelage R11 minimum et non gélif, colle et joint adaptés au gel, pente d’au moins 1,5 % et joints de fractionnement.', false);
  if (L >= 60 && num(v.colleKgM2) < 7) add('info', 'Grand format : double encollage obligatoire, comptez environ 7 kg/m² de colle.', false);
  if (L > 0 && L <= 10 && num(v.colleKgM2) > 3.5) add('info', 'Mosaïque : environ 3,5 kg/m² de colle suffisent (peigne fin).', false);
  if (L >= 60) add('info', 'Grand format : prévoir un système de nivellement (croisillons auto-nivelants) dans les autres frais.', false);
  const perteMin = { diagonale: 15, opus: 15, chevron: 20 }[v.typePose];
  if (perteMin && num(v.perte) < perteMin) add('warn', `Pose ${v.typePose} : prévoir au moins ${fr(perteMin)} % de pertes (actuellement ${fr(num(v.perte))} %).`, false);
  if (r.surfaceSol > 0 && !num(v.plinthesMl) && v.piece !== 'sdb' && v.piece !== 'exterieur') {
    const per = num(v.longueur) && num(v.largeur) ? ` Périmètre de la pièce ≈ ${round2(2 * (num(v.longueur) + num(v.largeur)))} ml (moins les portes).` : '';
    add('info', `Pas de plinthes prévues : oubli ?${per}`, false);
  }
  if (r.surfaceSol > 0 && v.piece !== 'exterieur' && !num(v.profilesMl)) add('info', 'Seuils de porte et finitions d’angle : pensez aux barres de seuil et profilés.', false);
  if (num(v.prixDeposeM2) > 0 && !num(v.evacuationHT)) add('warn', 'Dépose prévue mais pas d’évacuation des gravats facturée (benne, déchetterie).');
  if (num(v.m2ParJour) > rendementConseille * 1.3 && S) add('warn', `Rendement de ${fr(num(v.m2ParJour))} m²/jour optimiste pour cette situation : environ ${fr(rendementConseille)} m²/jour conseillé. Le temps et le coût sont sous-estimés.`, false);
  if (v.acces === 'centre') add('info', 'Centre de Strasbourg : prévoir le stationnement (zone payante, demande d’occupation du domaine public pour une benne) dans les autres frais.');
  if (num(v.distanceKm) > num(g.kmInclus) && v.facturerDeplacement === 'non') add('info', `Chantier à ${fr(num(v.distanceKm))} km : le déplacement n’est pas facturé (coût ≈ ${fr(r.deplacementCout)} €).`);

  // TVA
  if (num(v.tva) === 5.5) add('warn', 'TVA 5,5 % : réservée aux travaux de rénovation énergétique. Pour du carrelage seul, c’est 10 % (logement de plus de 2 ans) ou 20 %.');
  if (num(v.tva) === 10 || v.tva == null || v.tva === '') add('info', 'TVA 10 % : seulement pour un logement de plus de 2 ans. Faites confirmer par écrit au client (mention sur le devis ou attestation).');

  // Rentabilité
  if (r.totalHT > 0) {
    if (benefice < 0) add('danger', `Ce prix ne couvre pas vos coûts : perte estimée de ${fr(Math.abs(benefice))} €. Prix minimum ≈ ${fr(prixPlancher)} € HT.`);
    else if (beneficePct < num(g.margeCiblePct)) add('warn', `Bénéfice estimé ${fr(beneficePct)} % : sous votre objectif de ${fr(num(g.margeCiblePct))} %. Prix conseillé ≈ ${fr(prixConseille)} € HT.`);
    if (tauxHoraireEffectif != null && tauxHoraireEffectif < num(g.coutHoraire)) add('danger', `Une heure de travail rapporte ${fr(tauxHoraireEffectif)} € alors qu’elle vous coûte ${fr(num(g.coutHoraire))} €.`);
    else if (tauxHoraireEffectif != null && tauxHoraireEffectif < num(g.tauxHoraireCible)) add('warn', `Une heure de travail rapporte ${fr(tauxHoraireEffectif)} € HT (objectif ${fr(num(g.tauxHoraireCible))} €).`);
    if (r.totalHT < num(g.minimumHT)) add('warn', `Petit chantier : ${fr(r.totalHT)} € HT est sous votre minimum de facturation (${fr(num(g.minimumHT))} €).`);
  }
  const ordre = { danger: 0, warn: 1, info: 2 };
  alertes.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]);

  return { majorations, majPct, coef, prix, rendementConseille, rentab, verdict, alertes };
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
