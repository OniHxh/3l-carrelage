import { esc, icon, api, relTime, qs } from '../core.js';
import * as store from '../store.js';
import { app } from '../app.js';
import * as local from '../local.js';
import * as cloud from '../cloud.js';
import { pickJson } from './accueil.js';
import { toast, toastError, fieldHtml, readForm, confirmDialog } from '../ui.js';
import { PRESTATIONS, FOURNITURES, GESTION, referencePrix } from '../../shared/calc.js';

const ENT_FIELDS = [
  { name: 'raisonSociale', label: 'Raison sociale', required: true }, { name: 'formeJuridique', label: 'Forme juridique', placeholder: 'SARL, SAS, EI…' },
  { name: 'adresse', label: 'Adresse', full: true }, { name: 'cp', label: 'Code postal' }, { name: 'ville', label: 'Ville' },
  { name: 'tel', label: 'Téléphone', type: 'tel' }, { name: 'email', label: 'E-mail', type: 'email' },
  { name: 'siret', label: 'SIRET' }, { name: 'rcs', label: 'RCS / RM' },
  { name: 'assuranceDecennale', label: 'Assurance décennale (assureur, n° de contrat, zone)', full: true },
];
const refRow = (p, cur) => `<tr><td>${esc(p.label)}<div class="tiny muted">${esc(p.unite === '%' ? '%' : '€ / ' + p.unite)} · défaut ${p.min}–${p.max}</div></td>
  <td><input class="input" type="number" inputmode="decimal" step="any" min="0" name="${p.key}.min" value="${cur.min}"></td>
  <td><input class="input" type="number" inputmode="decimal" step="any" min="0" name="${p.key}.max" value="${cur.max}"></td></tr>`;
const refTable = (id, titre, list, cur) => `<div class="card"><div class="card-head"><h2>${titre}</h2></div><div class="table-wrap"><table class="table perm-table" id="${id}"><thead><tr><th style="text-align:left">Prestation</th><th>Min</th><th>Max</th></tr></thead><tbody>${list.map((p) => refRow(p, cur[p.key])).join('')}</tbody></table></div></div>`;
const readRef = (table, list) => Object.fromEntries(list.map((p) => [p.key, { min: Number(table.querySelector(`[name="${p.key}.min"]`).value || 0), max: Number(table.querySelector(`[name="${p.key}.max"]`).value || 0) }]));

export default {
  main: {
    title: 'Paramètres', live: false,
    render({ query }) {
      const prixOk = app.can('ca', 1);
      const tab = query.tab === 'donnees' ? 'donnees' : query.tab === 'prix' && prixOk ? 'prix' : 'entreprise';
      const s = store.settings();
      const canW = app.can('parametres', 2);
      let body = '';
      if (tab === 'entreprise') {
        body = `<div class="card card-pad"><form class="form" id="ent">${ENT_FIELDS.map((f) => fieldHtml(f, s.entreprise || {})).join('')}</form>
          <div class="row" style="margin-top:16px;justify-content:flex-end">${canW ? '<button class="btn primary" id="save-ent">Enregistrer</button>' : ''}</div>
          <p class="small muted">Ces informations apparaissent sur les rapports de chantier PDF, avec le logo 3L Carrelage.</p></div>`;
      }
      if (tab === 'prix') {
        const ref = referencePrix(s.prixRef);
        const canP = canW && app.can('ca', 2);
        body = `<div class="stack">
          <p class="small muted" style="margin:0">Ces fourchettes servent d’indicateurs dans le <a href="#/outils" style="text-decoration:underline">chiffrage</a>. Prix HT pratiqués à Strasbourg et dans le Bas-Rhin pour une situation standard (carreaux 30 à 60 cm, pose droite, support sain). Les majorations (format, type de pose, accès…) s’appliquent automatiquement. Ajustez-les avec vos propres devis acceptés.</p>
          <div class="card card-pad"><h2 style="margin-top:0">Vos coûts internes</h2><form class="form" id="gest">${GESTION.map((g) => fieldHtml({ name: g.key, label: g.label, type: 'number', help: g.help }, ref.gestion)).join('')}</form></div>
          <div class="grid g2">${refTable('t-prest', 'Prestations (pose seule)', PRESTATIONS, ref.prestations)}${refTable('t-fourn', 'Fournitures (prix d’achat)', FOURNITURES, ref.fournitures)}</div>
          ${canP ? '<div class="row" style="justify-content:flex-end;gap:8px"><button class="btn" id="reset-prix">Revenir aux valeurs par défaut</button><button class="btn primary" id="save-prix">Enregistrer</button></div>' : ''}
        </div>`;
      }
      if (tab === 'donnees') {
        const on = cloud.enabled(), tok = cloud.planToken();
        body = `<div class="grid g2">
          <div class="card card-pad stack"><h2>Synchronisation téléphone ↔ Mac</h2>
            ${on ? `<dl class="kv"><dt>État</dt><dd>${cloud.state.error ? `<span style="color:var(--red-ink)">${esc(cloud.state.error)}</span>` : 'Activée, chiffrée de bout en bout'}</dd><dt>Dernière synchro</dt><dd>${cloud.info().since ? relTime(cloud.info().since) : 'jamais'}</dd></dl>
              <div class="actions"><button class="btn dark" id="sy-now">${icon('refresh')}Synchroniser</button><button class="btn" id="sy-off">Désactiver sur cet appareil</button></div>`
            : `<p class="small muted" style="margin:0">Copie chiffrée dans un Gist GitHub privé. Utilisez la même clé et la même phrase secrète sur chaque appareil.</p>
              <ol class="small" style="margin:0;padding-left:18px;line-height:1.5"><li>${tok ? 'La clé de l’application Plan est reprise automatiquement.' : 'Créez une clé : <a href="https://github.com/settings/tokens/new?scopes=gist&amp;description=3L%20Carrelage%20sync" target="_blank" rel="noopener" style="text-decoration:underline">github.com → Generate token</a>, cochez seulement « gist », puis copiez la clé.'}</li><li>Choisissez une phrase secrète (8 caractères min.) et notez-la : sans elle, la copie en ligne est illisible.</li></ol>
              <label class="field"><span>Clé GitHub</span><input class="input" id="sy-token" name="gh-sy-key" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" placeholder="ghp_…" value="${esc(tok)}"></label>
              <label class="field"><span>Phrase secrète</span><input class="input" id="sy-pass" name="sync-sy-phrase" type="text" style="-webkit-text-security:disc" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true"></label>
              <div class="actions"><button class="btn primary" id="sy-on">Activer la synchronisation</button></div>`}
          </div>
          <div class="card card-pad stack"><h2>Sauvegarde</h2>
            <p class="small muted" style="margin:0">Un fichier complet (fiches, photos, devis, journal) à garder dans iCloud Drive ou sur le Mac. L’import fusionne : il n’efface rien.</p>
            <div class="actions"><button class="btn dark" id="exp">${icon('download')}Exporter tout</button><button class="btn" id="imp">Importer un fichier</button></div>
            <div class="hr"></div>
            <h2>Cet appareil</h2>
            <div class="actions"><button class="btn" id="notif">${icon('bell')}Activer les notifications</button></div>
            <p class="small muted" style="margin:0"><b>Installer l’application :</b> sur iPhone, Safari → Partager → « Sur l’écran d’accueil ». Sur Mac (Chrome), icône d’installation dans la barre d’adresse ; sur Mac (Safari), Fichier → « Ajouter au Dock ».</p>
          </div></div>`;
      }
      const tabs = [['entreprise', 'Entreprise'], ...(prixOk ? [['prix', 'Prix de référence']] : []), ...(app.can('parametres', 3) ? [['donnees', 'Données & appareil']] : [])];
      return `<div class="page-head"><div><h1>Paramètres</h1></div></div>
        <div class="tabs">${tabs.map(([k, l]) => `<a class="tab ${tab === k ? 'active' : ''}" href="#/parametres?tab=${k}">${l}</a>`).join('')}</div>${body}`;
    },
    mount(root) {
      const saveSettings = async (patch) => { await store.save('parametres', { ...store.settings(), id: 'parametres', ...patch }); toast('Paramètres enregistrés.'); };
      qs('#save-ent', root)?.addEventListener('click', () => saveSettings({ entreprise: { ...(store.settings().entreprise || {}), ...readForm(qs('#ent', root), ENT_FIELDS) } }).catch(toastError));
      qs('#save-prix', root)?.addEventListener('click', () => {
        const gestion = readForm(qs('#gest', root), GESTION.map((g) => ({ name: g.key, type: 'number' })));
        const prixRef = { gestion, prestations: readRef(qs('#t-prest', root), PRESTATIONS), fournitures: readRef(qs('#t-fourn', root), FOURNITURES) };
        saveSettings({ prixRef }).catch(toastError);
      });
      qs('#reset-prix', root)?.addEventListener('click', async () => {
        if (!(await confirmDialog('Remplacer vos prix de référence et coûts internes par les valeurs par défaut ?', { ok: 'Rétablir' }))) return;
        saveSettings({ prixRef: null }).then(() => app.go('#/parametres?tab=prix')).catch(toastError);
      });
      qs('#exp', root)?.addEventListener('click', async () => {
        try {
          const data = await local.snapshot({ withBlobs: true });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
          a.download = `3l-carrelage-donnees-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.append(a); a.click(); a.remove();
          toast('Export prêt.');
        } catch (e) { toastError(e); }
      });
      qs('#imp', root)?.addEventListener('click', async () => {
        const data = await pickJson(); if (!data) return;
        try { const n = await local.merge(data); await store.sync(); toast(`${n} élément(s) ajouté(s) ou mis à jour.`); } catch (e) { toastError(e); }
      });
      qs('#sy-on', root)?.addEventListener('click', async (e) => {
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Connexion…';
        try { await cloud.enable(qs('#sy-token', root).value, qs('#sy-pass', root).value); await store.sync(); toast('Synchronisation activée.'); app.go('#/parametres?tab=donnees'); }
        catch (err) { cloud.disable(); toastError(err); b.disabled = false; b.textContent = 'Activer la synchronisation'; }
      });
      qs('#sy-now', root)?.addEventListener('click', async () => { await cloud.syncNow(); await store.sync(); toast(cloud.state.error || 'Données à jour.', cloud.state.error ? 'error' : ''); app.go('#/parametres?tab=donnees'); });
      qs('#sy-off', root)?.addEventListener('click', async () => {
        if (!(await confirmDialog('Désactiver la synchronisation sur cet appareil ? Les données restent sur l’appareil et en ligne.'))) return;
        cloud.disable(); toast('Synchronisation désactivée.'); app.go('#/parametres?tab=donnees');
      });
      qs('#notif', root)?.addEventListener('click', async () => {
        if (!('Notification' in window)) return toast('Notifications non prises en charge sur ce navigateur. Sur iPhone, installez d’abord l’application sur l’écran d’accueil.', 'error');
        const p = await Notification.requestPermission();
        toast(p === 'granted' ? 'Notifications activées pour les alertes importantes.' : 'Notifications refusées.', p === 'granted' ? '' : 'error');
      });
    },
  },

  profil: {
    title: 'Mon profil', live: false,
    render() {
      const u = app.user;
      return `<div class="page-head"><div><h1>Mon profil</h1><p>${esc(u.roleLabel)}</p></div></div>
        <div class="grid g2">
          <div class="card card-pad stack"><h2>Informations</h2>
            <form class="form" id="pf">${fieldHtml({ name: 'name', label: 'Nom', required: true }, u)}${fieldHtml({ name: 'tel', label: 'Téléphone', type: 'tel' }, u.profile)}${fieldHtml({ name: 'fonction', label: 'Fonction' }, u.profile)}${fieldHtml({ name: 'competences', label: 'Compétences', full: true }, u.profile)}</form>
            <div class="row" style="justify-content:flex-end"><button class="btn primary" id="save-p">Enregistrer</button></div></div>
          <div class="card card-pad stack"><h2>Données</h2><p class="small muted" style="margin:0">Sauvegarde, import et synchronisation entre appareils.</p><div class="actions"><a class="btn dark" href="#/parametres?tab=donnees">Données &amp; appareil</a></div></div>
        </div>`;
    },
    mount(root) {
      qs('#save-p', root).addEventListener('click', async () => {
        const f = qs('#pf', root);
        try {
          const { user } = await api('/me', { method: 'PUT', body: { name: f.name.value, profile: { tel: f.tel.value, fonction: f.fonction.value, competences: f.competences.value } } });
          Object.assign(app.user, user); toast('Profil mis à jour.'); store.sync();
        } catch (e) { toastError(e); }
      });
    },
  },
};
