'use strict';
(async () => {
  const t = await window.tb.texts();
  document.documentElement.dir = t.rtl ? 'rtl' : 'ltr';
  document.getElementById('title').textContent = t.title;
  document.getElementById('back').textContent = (t.rtl ? '→ ' : '← ') + t.back;
  document.getElementById('home').textContent = t.home;
  document.getElementById('tile').textContent = t.tile;
  const close = document.getElementById('close'); close.title = t.hide;
  for (const id of ['back', 'home', 'tile', 'close']) document.getElementById(id).addEventListener('click', () => window.tb.act(id));
})();
