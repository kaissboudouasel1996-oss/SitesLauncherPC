'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const chosen = new Set();
  let items = [];

  const when = (ms) => new Date(ms).toLocaleString(window.I18N.locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  function render() {
    const q = $('fSearch').value.trim().toLowerCase();
    const box = $('fList');
    box.textContent = '';
    const shown = items.filter((i) => !q || i.name.toLowerCase().includes(q));
    if (!items.length) box.appendChild(el('p', 'muted', 'Aucun fichier pour le moment. Un fichier téléchargé depuis un site apparaît ici.'));
    else if (!shown.length) box.appendChild(el('p', 'muted', 'Aucun fichier ne correspond.'));
    shown.forEach((i) => {
      const row = el('div', 'frow');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = chosen.has(i.name);
      cb.addEventListener('change', () => { if (cb.checked) chosen.add(i.name); else chosen.delete(i.name); $('fDel').hidden = !chosen.size; $('fDel').textContent = `Supprimer la sélection (${chosen.size})`; });
      const info = el('div', 'finfo');
      info.append(el('b', 'fname', i.name), el('span', 'fmeta', `${i.sizeText} · ${when(i.mtime)}`));
      const open = el('button', 'btn', 'Ouvrir'); open.addEventListener('click', async () => { const r = await window.api.files.open(i.name); $('fMsg').textContent = r.ok ? '' : r.error; });
      const dir = el('button', 'btn', 'Dossier'); dir.title = 'Afficher dans l’explorateur'; dir.addEventListener('click', () => window.api.files.reveal(i.name));
      row.append(cb, el('span', 'ficon', i.icon), info, open, dir);
      row.addEventListener('dblclick', () => open.click());
      box.appendChild(row);
    });
  }

  async function showFiles() {
    const r = await window.api.files.list();
    items = r.items;
    for (const n of [...chosen]) if (!items.some((i) => i.name === n)) chosen.delete(n);
    $('fDel').hidden = !chosen.size;
    render();
  }
  window.showFiles = showFiles;
  window.api.on('files:changed', () => { if (!$('page-files').hidden) showFiles(); });

  $('fSearch').addEventListener('input', render);
  $('fFolder').addEventListener('click', () => window.api.files.folder());
  $('fAdd').addEventListener('click', async () => { const r = await window.api.files.add(); if (r.added) { $('fMsg').textContent = `${r.added} fichier(s) ajouté(s).`; showFiles(); } });
  $('fDel').addEventListener('click', async () => {
    if (!chosen.size || !window.confirm(`Supprimer ${chosen.size} fichier(s) ? Cette action est définitive.`)) return;
    const n = await window.api.files.remove([...chosen]);
    chosen.clear(); $('fMsg').textContent = `${n} fichier(s) supprimé(s).`; showFiles();
  });
})();
