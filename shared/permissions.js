// Rôles, modules et niveaux d'accès. Partagé serveur / client.
// Niveaux : 0 = aucun, 1 = lecture, 2 = écriture, 3 = écriture + suppression.

export const MODULES = {
  chantiers: 'Chantiers (fiches, photos, journal)',
  clients: 'Clients',
  planning: 'Planning, tâches, heures',
  ca: 'Prix des chantiers, devis et chiffre d’affaires',
  equipe: 'Utilisateurs et rôles',
  parametres: 'Paramètres de l’entreprise',
};

/** Type d'enregistrement → module qui le gouverne. */
export const TYPE_MODULE = {
  chantier: 'chantiers', photo: 'chantiers', note: 'chantiers',
  client: 'clients',
  devis: 'ca',
  tache: 'planning', evenement: 'planning', pointage: 'planning', membre: 'planning',
  parametres: 'parametres',
};
export const TYPES = Object.keys(TYPE_MODULE);

const all = (lvl) => Object.fromEntries(Object.keys(MODULES).map((m) => [m, lvl]));

export const ROLES = {
  admin: { label: 'Administrateur', perms: all(3) },
  gestionnaire: { label: 'Gestionnaire', perms: { ...all(3), equipe: 1 } },
  chef_chantier: { label: 'Responsable de chantier', perms: { chantiers: 3, clients: 1, planning: 3, ca: 0, equipe: 1, parametres: 0 } },
  carreleur: { label: 'Carreleur', perms: { chantiers: 2, clients: 1, planning: 2, ca: 0, equipe: 0, parametres: 0 } },
  aide: { label: 'Aide / manœuvre', perms: { chantiers: 1, clients: 0, planning: 1, ca: 0, equipe: 0, parametres: 0 } },
  sous_traitant: { label: 'Sous-traitant', perms: { chantiers: 1, clients: 0, planning: 1, ca: 0, equipe: 0, parametres: 0 } },
};

/** Permissions effectives : rôle de base + surcharges individuelles. */
export function effectivePerms(user) {
  const base = ROLES[user?.role]?.perms || {};
  const own = Object.fromEntries(Object.entries(user?.permissions || {}).filter(([m]) => m in MODULES));
  return { ...base, ...own };
}

export function can(user, module, level = 1) {
  return (effectivePerms(user)[module] || 0) >= level;
}

export function canType(user, type, level = 1) {
  const m = TYPE_MODULE[type];
  return !!m && can(user, m, level);
}

/** Champs d'argent d'une fiche, réservés au module « ca ». */
export const MONEY_FIELDS = { chantier: ['prixHT', 'chiffrage'], parametres: ['prixRef'] };

/** Retire les champs d'argent d'une fiche pour qui n'a pas accès au chiffre d'affaires. */
export function hideMoney(user, rec) {
  const f = rec && MONEY_FIELDS[rec.type];
  if (!f || can(user, 'ca', 1)) return rec;
  const out = { ...rec };
  for (const k of f) delete out[k];
  return out;
}
