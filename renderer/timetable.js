'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let data = null; // { table: {periods, cells}, days }
  let cell = null; // { d, p } or { header: p }

  async function save() { await window.api.timetable.save(data.table); }

  function render() {
    const t = data.table;
    const tb = $('tTable');
    tb.textContent = '';
    const head = el('tr');
    head.appendChild(el('th', 'dayh', ''));
    t.periods.forEach((p, i) => { const th = el('th', 'hourh', p); th.title = 'Modifier l’heure'; th.addEventListener('click', () => edit({ header: i })); head.appendChild(th); });
    tb.appendChild(head);
    t.cells.forEach((row, d) => {
      const tr = el('tr');
      tr.appendChild(el('th', 'dayh', data.days[d]));
      row.forEach((txt, p) => { const td = el('td', 'tcell' + (txt.trim() ? ' full' : ''), txt); td.addEventListener('click', () => edit({ d, p })); tr.appendChild(td); });
      tb.appendChild(tr);
    });
  }

  async function showTimetable() {
    data = await window.api.timetable.get();
    $('tStatus').textContent = '';
    render();
  }
  window.showTimetable = showTimetable;

  async function edit(target) {
    cell = target;
    const t = data.table;
    if (target.header != null) {
      $('cTitle').textContent = 'Heure';
      $('cLabel').textContent = 'Exemple : 08h - 09h';
      $('cText').rows = 1;
      $('cText').value = t.periods[target.header];
      $('cClassesBox').hidden = true;
      $('cClear').hidden = true;
    } else {
      $('cTitle').textContent = `${data.days[target.d]}, ${t.periods[target.p]}`;
      $('cLabel').textContent = 'Classe, puis salle (exemple : 3APIC-2, Salle 10)';
      $('cText').rows = 3;
      $('cText').value = t.cells[target.d][target.p];
      $('cClear').hidden = false;
      const classes = await window.api.classes.list();
      const sel = $('cClasses');
      sel.textContent = '';
      sel.appendChild(new Option('—', ''));
      classes.forEach((c) => sel.appendChild(new Option(c.name, c.name)));
      $('cClassesBox').hidden = !classes.length;
    }
    $('dlgCell').returnValue = '';
    $('dlgCell').showModal();
    $('cText').focus();
  }

  $('cClasses').addEventListener('change', () => {
    const v = $('cClasses').value;
    if (!v) return;
    const room = $('cText').value.split(/\r?\n/).slice(1).join('\n');
    $('cText').value = v + (room ? '\n' + room : '');
    $('cClasses').value = '';
  });

  $('cClear').addEventListener('click', () => { $('cText').value = ''; $('dlgCell').close('ok'); });

  $('dlgCell').addEventListener('close', async () => {
    if ($('dlgCell').returnValue !== 'ok' || !cell) return;
    const v = $('cText').value.trim();
    if (cell.header != null) { if (v) data.table.periods[cell.header] = v; }
    else data.table.cells[cell.d][cell.p] = v;
    render();
    await save();
  });

  $('tClear').addEventListener('click', async () => {
    if (!window.confirm('Vider toutes les cases de l’emploi du temps ?')) return;
    data.table.cells = data.table.cells.map((r) => r.map(() => ''));
    render();
    await save();
  });

  // a photo of the timetable (or a screenshot): read with the text recognition of Windows
  function askSide() {
    return new Promise((resolve) => {
      const dlg = $('dlgAsk');
      $('askTitle').textContent = window.T('Où sont les jours ?');
      $('askText').textContent = window.T('Les horaires n’ont pas pu être lus. De quel côté sont écrits les jours ?');
      $('askA').textContent = window.T('À gauche'); $('askB').textContent = window.T('À droite');
      const done = (v) => { dlg.close(); resolve(v); };
      $('askA').onclick = () => done(false); $('askB').onclick = () => done(true);
      dlg.addEventListener('close', () => resolve(null), { once: true });
      dlg.returnValue = ''; dlg.showModal();
    });
  }
  async function importPhoto(source) {
    $('tStatus').textContent = window.T('Lecture de l’emploi du temps...');
    let r = await window.api.timetable.fromPhoto(source, {});
    if (r.canceled) { $('tStatus').textContent = ''; return; }
    if (r.needDirection) {
      const rtl = await askSide();
      if (rtl === null) { $('tStatus').textContent = ''; return; }
      $('tStatus').textContent = window.T('Lecture de l’emploi du temps...');
      r = await window.api.timetable.fromPhoto(source, { again: true, rtl });
    }
    if (!r.ok) { $('tStatus').textContent = r.error; return; }
    if (r.hasCurrent && !window.confirm(window.T('Remplacer l’emploi du temps ?') + '\n' + window.T('L’emploi du temps de la photo remplacera celui que vous avez actuellement.'))) { $('tStatus').textContent = ''; return; }
    data.table = r.table; await save(); render();
    $('tStatus').textContent = window.T('Emploi du temps importé. Vérifiez-le et touchez une case pour la corriger.');
  }
  $('tPhoto').addEventListener('click', () => importPhoto('file'));
  $('tClip').addEventListener('click', () => importPhoto('clipboard'));

  $('tPdf').addEventListener('click', async () => {
    $('tStatus').textContent = 'Création du PDF…';
    const r = await window.api.timetable.pdf();
    $('tStatus').textContent = !r.ok ? r.error : (r.canceled ? '' : 'Emploi du temps enregistré : ' + r.path);
  });
})();
