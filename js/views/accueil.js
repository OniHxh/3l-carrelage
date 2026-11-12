// Premier lancement sur un appareil : importer ses données, les récupérer depuis la synchronisation, ou démarrer à vide.
import { esc, qs } from '../core.js';
import { toastError } from '../ui.js';
import * as local from '../local.js';
import * as cloud from '../cloud.js';

const frame = (inner) => `<div class="auth">
  <div class="auth-visual"><img src="icons/logo-full.png" alt="3L Carrelage — Revêtement &amp; rénovation"></div>
  <div class="auth-form">${inner}</div>
</div>`;

export function pickJson() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return resolve(null);
      try { resolve(JSON.parse(await f.text())); } catch { toastError(new Error('Fichier illisible.')); resolve(null); }
    };
    input.click();
  });
}

export function renderWelcome(onDone) {
  const tok = cloud.planToken();
  qs('#app').innerHTML = frame(`<div class="stack" style="width:min(460px,100%)">
    <img class="auth-mobile-logo" src="icons/logo.png" alt="3L Carrelage">
    <div><h1>Bienvenue</h1><p class="muted" style="margin:6px 0 0">Vos données restent sur cet appareil. La synchronisation chiffrée les copie entre votre téléphone et votre Mac.</p></div>

    <div class="card card-pad stack" style="gap:10px">
      <b>1. Récupérer mes données depuis un autre appareil</b>
      <p class="small muted" style="margin:0">Si la synchronisation est déjà activée sur votre Mac ou votre téléphone.</p>
      <label class="field"><span>Clé GitHub</span><input class="input" id="w-token" autocomplete="off" placeholder="ghp_…" value="${esc(tok)}"></label>
      ${tok ? '<small class="muted">Clé reprise de l’application Plan.</small>' : ''}
      <label class="field"><span>Phrase secrète</span><input class="input" id="w-pass" type="password" autocomplete="off"></label>
      <button class="btn primary" id="w-sync">Récupérer mes données</button>
    </div>

    <div class="card card-pad stack" style="gap:10px">
      <b>2. Importer un fichier</b>
      <p class="small muted" style="margin:0">Fichier « 3l-carrelage-donnees-….json » (export de l’ancienne application ou de cette application).</p>
      <button class="btn dark" id="w-import">Choisir le fichier</button>
    </div>

    <details class="card card-pad"><summary style="cursor:pointer;font-weight:600">3. Commencer avec une application vide</summary>
      <div class="stack" style="gap:10px;margin-top:12px">
        <label class="field"><span>Votre nom</span><input class="input" id="w-name"></label>
        <button class="btn" id="w-empty">Commencer</button>
      </div>
    </details>
  </div>`);

  const busy = (b, on, label) => { b.disabled = on; if (label) b.textContent = label; };
  qs('#w-sync').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    busy(b, true, 'Connexion…');
    try { await cloud.enable(qs('#w-token').value, qs('#w-pass').value); if (await local.isEmpty()) throw new Error('Aucune donnée trouvée en ligne.'); onDone(); }
    catch (err) { cloud.disable(); toastError(err); busy(b, false, 'Récupérer mes données'); }
  });
  qs('#w-import').addEventListener('click', async (e) => {
    const data = await pickJson();
    if (!data) return;
    const b = e.currentTarget;
    busy(b, true, 'Import…');
    try { await local.merge(data, { takeOwner: true }); onDone(); }
    catch (err) { toastError(err); busy(b, false, 'Choisir le fichier'); }
  });
  qs('#w-empty').addEventListener('click', async () => {
    const name = qs('#w-name').value.trim();
    if (!name) return toastError(new Error('Indiquez votre nom.'));
    await local.ensureOwner(name);
    onDone();
  });
}
