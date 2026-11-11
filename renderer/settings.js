'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const radios = (name) => [...document.querySelectorAll(`input[name=${name}]`)];
  const T = (s) => (window.T ? window.T(s) : s);

  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  }

  async function showSettings() {
    const s = await window.api.settings.get();
    radios('setLang').forEach((r) => { r.checked = r.value === s.lang; });
    radios('setTheme').forEach((r) => { r.checked = r.value === s.theme; });
    $('setAutoUpdate').checked = s.autoUpdate;
    $('setVersion').textContent = `Version ${s.version}`;
    $('setUpdMsg').textContent = '';
    $('setInstall').hidden = true;
  }
  window.showSettings = showSettings;

  radios('setLang').forEach((r) => r.addEventListener('change', async () => { if (r.checked) { await window.api.lang.set(r.value); location.reload(); } }));
  radios('setTheme').forEach((r) => r.addEventListener('change', async () => { if (r.checked) { applyTheme(r.value); await window.api.settings.setTheme(r.value); } }));
  $('setAutoUpdate').addEventListener('change', () => window.api.settings.setAutoUpdate($('setAutoUpdate').checked));
  $('setFolder').addEventListener('click', () => window.api.settings.openDataFolder());
  $('setCheck').addEventListener('click', async () => { $('setUpdMsg').textContent = T('Recherche de mises à jour…'); const r = await window.api.update.check(); if (r && r.message) $('setUpdMsg').textContent = r.message; });
  $('setInstall').addEventListener('click', () => window.api.update.install());

  // progress of an update, sent by the program
  window.api.on('update:status', (u) => {
    const m = $('setUpdMsg'); if (!m) return;
    if (u.state === 'checking') m.textContent = T('Recherche de mises à jour…');
    else if (u.state === 'none') m.textContent = T('Vous avez la dernière version.');
    else if (u.state === 'available') m.textContent = T(`Une mise à jour est disponible (version ${u.version}) : téléchargement…`);
    else if (u.state === 'progress') m.textContent = T(`Téléchargement de la mise à jour : ${u.percent} %`);
    else if (u.state === 'ready') { m.textContent = T('Mise à jour téléchargée : elle s’installera à la fermeture de l’application.'); $('setInstall').hidden = false; }
    else if (u.state === 'unavailable') m.textContent = T('Les mises à jour automatiques ne sont pas disponibles dans cette version (version portable ou de développement).');
    else if (u.state === 'error') m.textContent = T('La recherche de mise à jour a échoué. Vérifiez votre connexion internet.');
  });

  // the hidden « À propos »: click the name of the application 7 times in a row
  let taps = 0; let last = 0;
  const brand = document.querySelector('.brand b, .brand strong, .brand');
  if (brand) brand.addEventListener('click', async () => {
    const now = Date.now(); taps = now - last > 2000 ? 1 : taps + 1; last = now;
    if (taps >= 7) {
      taps = 0;
      const s = await window.api.settings.get();
      $('abVersion').textContent = `Version ${s.version}`;
      $('dlgAbout').returnValue = ''; $('dlgAbout').showModal();
    }
  });
  $('abMail').addEventListener('click', (e) => { e.preventDefault(); window.api.settings.openExternal('mailto:boudouasel12@gmail.com'); });
  $('abPhone').addEventListener('click', (e) => { e.preventDefault(); window.api.settings.copy('0671677162'); $('abVersion').textContent = T('Numéro copié.'); });

  // the chosen theme is applied as soon as the program says which one it is
  try { window.api.settings.get().then((s) => applyTheme(s.theme)).catch(() => {}); } catch (e) { /* no settings yet */ }
})();
