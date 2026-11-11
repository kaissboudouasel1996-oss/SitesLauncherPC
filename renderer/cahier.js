'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let date = null;
  let open = null; // { date, period } of the lesson dialog
  let lastDetail = null;

  const shift = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };

  async function showCahier() {
    if (!date) date = await window.api.cahier.today();
    render();
  }
  window.showCahier = showCahier;

  async function render() {
    const v = await window.api.cahier.day(date);
    $('kDate').value = date;
    $('kLabel').textContent = v.label.charAt(0).toUpperCase() + v.label.slice(1);
    const box = $('kContent');
    box.textContent = '';
    if (v.status === 'before') { box.appendChild(el('p', 'muted', `Les cours commencent le ${v.startLabel}.`)); return; }
    if (v.status === 'off') {
      const card = el('div', 'kcard');
      card.appendChild(el('b', 'koff', '🌴  ' + v.off.name));
      const b = el('button', 'btn', v.off.marked ? 'Rétablir ce jour' : 'Garder les cours ce jour');
      b.addEventListener('click', async () => { await window.api.cahier.setDay(date, v.off.marked ? null : 'on'); render(); });
      card.appendChild(b);
      box.appendChild(card);
      return;
    }
    if (!v.slots.length) box.appendChild(el('p', 'muted', v.ttEmpty ? 'Votre emploi du temps est vide. Remplissez-le d’abord (Emploi du temps).' : 'Pas de cours ce jour.'));
    v.slots.forEach((s) => {
      const card = el('button', 'kcard slot' + (s.muted ? ' muted2' : ''));
      card.appendChild(el('b', '', `${s.label}  ·  ${s.name}`));
      card.appendChild(el('span', 'ksub', s.sub));
      if (s.openable) card.addEventListener('click', () => openLesson(s.period)); else card.disabled = true;
      box.appendChild(card);
    });
    if (v.restorable) addDayButton(box, 'Rétablir ce jour', null);
    else if (v.markable) addDayButton(box, 'Marquer ce jour comme sans cours', 'off');
  }

  function addDayButton(box, text, state) {
    const b = el('button', 'btn', text);
    b.addEventListener('click', async () => { await window.api.cahier.setDay(date, state); render(); });
    box.appendChild(b);
  }

  function line(label, value, edit) {
    const p = el('p', 'lline');
    if (label) p.appendChild(el('b', '', label));
    const t = el('span', edit && edit.missing ? 'missing' : '', edit && edit.missing ? '… (à compléter)' : value);
    p.appendChild(t);
    if (edit && edit.editable) {
      p.classList.add('editable');
      p.addEventListener('click', () => editObjective(edit));
    }
    return p;
  }

  async function openLesson(period) {
    open = { date, period };
    const d = await window.api.cahier.detail(date, period);
    if (!d) return;
    lastDetail = d;
    $('lTitle').textContent = d.title;
    $('lMsg').textContent = '';
    const body = $('lBody');
    body.textContent = '';
    if (d.skipped) {
      body.appendChild(el('p', '', 'Cette séance est marquée comme non assurée.'));
      $('lSkip').textContent = 'Rétablir cette séance';
      $('lCopy').hidden = true; $('lHint').textContent = '';
    } else {
      $('lSkip').textContent = 'Cette séance n’a pas eu lieu';
      $('lCopy').hidden = false;
      body.appendChild(line('Période : ', String(d.periode)));
      if (d.revision) body.appendChild(line('', d.text));
      else {
        if (d.tache) { body.appendChild(line(`Unité ${d.unit} : `, d.unitTitle)); body.appendChild(line('Tâche finale : ', d.tache.text, d.tache)); }
        body.appendChild(line(`Séance ${d.seance} : `, d.titles));
        body.appendChild(line(d.objLabel, ''));
        d.objectifs.forEach((o) => body.appendChild(line('• ', o.text, o)));
        if (d.pages) body.appendChild(line(d.pagesLabel, d.pages));
      }
      $('lHint').textContent = d.revision ? '' : 'Touchez un objectif pour le modifier.';
    }
    if (!$('dlgLesson').open) { $('dlgLesson').returnValue = ''; $('dlgLesson').showModal(); }
  }

  $('lCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(lastDetail.copyText); $('lMsg').textContent = 'Copié.'; }
    catch (e) { $('lMsg').textContent = 'Copie impossible.'; }
  });

  $('lSkip').addEventListener('click', async () => {
    await window.api.cahier.skip(open.date, open.period, !lastDetail.skipped);
    $('dlgLesson').close('close');
    render();
  });

  // ---- edit one objective ----
  let editing = null;
  function editObjective(l) {
    editing = l;
    $('oText').value = l.missing ? '' : l.text;
    $('oBook').hidden = !l.manual;
    $('dlgObj').returnValue = '';
    $('dlgObj').showModal();
    $('oText').focus();
  }
  async function saveObjective(text) {
    await window.api.cahier.setManual(lastDetail.level, lastDetail.unit, editing.key, text);
    await openLesson(open.period);
    render();
  }
  $('dlgObj').addEventListener('close', () => { if ($('dlgObj').returnValue === 'ok') saveObjective($('oText').value); });
  $('oBook').addEventListener('click', () => { $('dlgObj').close('book'); saveObjective(''); });

  // ---- navigation ----
  $('kPrev').addEventListener('click', () => { date = shift(date, -1); render(); });
  $('kNext').addEventListener('click', () => { date = shift(date, 1); render(); });
  $('kToday').addEventListener('click', async () => { date = await window.api.cahier.today(); render(); });
  $('kDate').addEventListener('change', () => { if ($('kDate').value) { date = $('kDate').value; render(); } });
})();
