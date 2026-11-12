'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const msg = (t) => { $('spMsg').textContent = t; };
  function report(r) {
    if (!r) return;
    if (r.canceled) { msg(''); return; }
    if (!r.ok) { msg(r.error || 'Les fenêtres n’ont pas pu être placées.'); return; }
    msg(r.word && r.ppt && r.desk ? 'Les trois fenêtres sont en place. Utilisez la barre en haut de l’écran pour revenir.' : 'Une fenêtre est introuvable. Vérifiez que Word et PowerPoint sont installés, puis utilisez Réorganiser les fenêtres.');
  }
  async function run(fn) {
    ['spStart', 'spTile', 'spWord', 'spPpt'].forEach((i) => { $(i).disabled = true; });
    msg('Ouverture des fenêtres… cela peut prendre quelques secondes.');
    try { report(await fn()); } catch (e) { msg('Les fenêtres n’ont pas pu être placées.'); }
    ['spStart', 'spTile', 'spWord', 'spPpt'].forEach((i) => { $(i).disabled = false; });
  }
  $('spStart').addEventListener('click', () => run(() => window.api.split.start()));
  $('spTile').addEventListener('click', () => run(() => window.api.split.tile()));
  $('spWord').addEventListener('click', () => run(() => window.api.split.openWord()));
  $('spPpt').addEventListener('click', () => run(() => window.api.split.openPpt()));
  window.showSplit = () => msg('');
})();
