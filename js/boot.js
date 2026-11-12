// Garde-fou du démarrage (script classique, chargé avant l'application).
// - Si l'application reste bloquée sur le logo, affiche un bouton « Réparer » qui vide le cache
//   de l'interface (les données saisies hors ligne, stockées à part, sont conservées).
(function () {
  var sent = 0;
  // Plus de serveur : les erreurs sont seulement gardées dans la console.
  function report(kind, message) { if (sent++ < 10) console.warn('[3L]', kind, message); }
  window.__report = report;

  function stuck() {
    var app = document.getElementById('app');
    return !!(app && app.querySelector('.boot'));
  }

  window.addEventListener('error', function (e) {
    var where = e.filename ? ' @ ' + e.filename.replace(location.origin, '') + ':' + e.lineno + ':' + e.colno : '';
    report('erreur', (e.message || (e.target && e.target.src ? 'Chargement impossible : ' + e.target.src : 'erreur')) + where);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    report('promesse', r && (r.stack || r.message) ? (r.message + ' ' + (r.stack || '')) : String(r));
  });

  async function repair() {
    try {
      if ('serviceWorker' in navigator) {
        var regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(function (r) { return r.unregister(); }));
      }
      if (window.caches) {
        var keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }
    } catch (e) {}
    location.replace(location.pathname + '?r=' + Date.now() + '#/');
  }

  setTimeout(function () {
    if (!stuck()) return;
    report('bloque', 'Démarrage bloqué après 15 s · sw=' + !!(navigator.serviceWorker && navigator.serviceWorker.controller) + ' · online=' + navigator.onLine);
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:32px;max-width:420px;margin:0 auto;padding:16px;border-radius:14px;background:#fff;color:#111;box-shadow:0 8px 30px rgba(0,0,0,.25);font:15px/1.4 -apple-system,system-ui,sans-serif;text-align:center;z-index:9999';
    box.innerHTML = '<b>L’application ne démarre pas.</b><br><span style="color:#555">Réparez l’application : vos données, enregistrées à part sur l’appareil, sont conservées.</span><br>';
    var b = document.createElement('button');
    b.textContent = 'Réparer et recharger';
    b.style.cssText = 'margin-top:12px;padding:12px 18px;border:0;border-radius:10px;background:#D7262E;color:#fff;font-weight:600;font-size:15px';
    b.addEventListener('click', function () { b.disabled = true; b.textContent = 'Réparation…'; repair(); });
    box.appendChild(b);
    document.body.appendChild(box);
  }, 15000);
})();
