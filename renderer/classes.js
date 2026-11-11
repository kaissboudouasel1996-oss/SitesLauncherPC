'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const views = ['clsList', 'clsNew', 'clsDetail', 'clsSeating'];
  const show = (v) => views.forEach((x) => { $(x).hidden = x !== v; });
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let mode = 'pick'; // how the new class is created: 'pick' (file) or 'type' (names)
  let cur = null;    // class being edited
  const dirty = new Map();
  let timer = null;

  // ---------- list ----------
  async function showClassList() {
    await flush();
    show('clsList');
    const list = await window.api.classes.list();
    const box = $('clsCards');
    box.textContent = '';
    if (!list.length) { box.appendChild(el('p', 'muted', 'Aucune liste de classe pour le moment.')); return; }
    list.forEach((c) => {
      const card = el('button', 'cls');
      card.append(el('b', '', c.name), el('span', '', c.count + ' élèves'));
      card.addEventListener('click', () => openClass(c.id));
      box.appendChild(card);
    });
  }
  window.showClassList = showClassList;

  $('clsImport').addEventListener('click', async () => {
    $('clsMsg').textContent = '';
    const r = await window.api.classes.pick();
    if (r.canceled) return;
    if (!r.ok) { $('clsMsg').textContent = r.error; return; }
    mode = 'pick';
    $('clsNewTitle').textContent = `Nouvelle classe (${r.count} élèves)`;
    $('clsNamesBox').hidden = true;
    $('clsName').value = r.defaultName;
    $('clsNewMsg').textContent = '';
    show('clsNew');
    $('clsName').focus();
  });

  $('clsType').addEventListener('click', () => {
    mode = 'type';
    $('clsNewTitle').textContent = 'Saisir ou coller les noms';
    $('clsNamesBox').hidden = false;
    $('clsName').value = '';
    $('clsNames').value = '';
    $('clsNewMsg').textContent = '';
    show('clsNew');
    $('clsName').focus();
  });

  $('clsNewCancel').addEventListener('click', showClassList);
  $('clsNewOk').addEventListener('click', async () => {
    const name = $('clsName').value;
    const r = mode === 'pick' ? await window.api.classes.createFromPick(name) : await window.api.classes.createFromNames(name, $('clsNames').value);
    if (!r.ok) { $('clsNewMsg').textContent = r.error; return; }
    openClass(r.id);
  });

  // ---------- detail ----------
  async function openClass(id) {
    cur = await window.api.classes.get(id);
    if (!cur) { showClassList(); return; }
    dirty.clear();
    fillHeader();
    buildStudents();
    $('dStatus').textContent = '';
    $('dSearch').value = '';
    show('clsDetail');
    // the year and the last typed values are saved straight away, like on the phone
    window.api.classes.save({ id: cur.id, year: cur.year, subject: cur.subject, school: cur.school, direction: cur.direction });
  }

  function fillHeader() {
    $('dTitle').textContent = cur.name;
    $('dDirection').value = cur.direction;
    $('dYear').value = cur.year;
    $('dSchool').value = cur.school;
    $('dName').value = cur.name;
    const sel = $('dSubject');
    sel.textContent = '';
    sel.appendChild(new Option('—', ''));
    Object.entries(cur.subjects).forEach(([k, label]) => sel.appendChild(new Option(label, k)));
    if (cur.subject && !(cur.subject in cur.subjects)) sel.appendChild(new Option(cur.subject, cur.subject));
    sel.value = cur.subject;
  }

  const FIELDS = { dDirection: 'direction', dYear: 'year', dSchool: 'school', dName: 'name', dSubject: 'subject' };
  Object.entries(FIELDS).forEach(([id, key]) => {
    $(id).addEventListener(id === 'dSubject' ? 'change' : 'input', () => {
      if (!cur) return;
      cur[key] = $(id).value;
      if (key === 'name') $('dTitle').textContent = cur.name;
      schedule({ header: true });
    });
  });

  function schedule(what) {
    if (what && what.student) dirty.set(what.student.index, what.student);
    if (what && what.header) dirty.set('header', true);
    clearTimeout(timer);
    timer = setTimeout(flush, 600);
  }

  async function flush() {
    clearTimeout(timer);
    if (!cur || !dirty.size) return;
    const data = { id: cur.id, students: [] };
    for (const k of dirty.keys()) {
      if (k === 'header') Object.assign(data, { name: cur.name, subject: cur.subject, school: cur.school, direction: cur.direction, year: cur.year });
      else data.students.push(dirty.get(k));
    }
    dirty.clear();
    await window.api.classes.save(data);
  }

  function colored(s) {
    const frag = document.createDocumentFragment();
    for (const ch of s) { const sp = el('span', ch === '+' ? 'p' : 'm', ch === '+' ? '+' : '−'); frag.appendChild(sp); }
    return frag;
  }

  function markRow(label, s, key) {
    const wrap = el('div', 'markrow');
    wrap.appendChild(el('b', '', label));
    const marks = el('span', 'marks');
    const draw = () => { marks.textContent = ''; marks.appendChild(colored(s[key])); };
    draw();
    const add = (ch) => { if (s[key].length >= 50) { $('dStatus').textContent = 'Maximum 50 marques.'; return; } s[key] += ch; draw(); schedule({ student: s }); };
    const plus = el('button', 'mk', '+'); plus.addEventListener('click', () => add('+'));
    const minus = el('button', 'mk', '−'); minus.addEventListener('click', () => add('-'));
    const back = el('button', 'mk', '⌫'); back.addEventListener('click', () => { s[key] = s[key].slice(0, -1); draw(); schedule({ student: s }); });
    wrap.append(marks, plus, minus, back);
    return wrap;
  }

  function buildStudents() {
    const box = $('dStudents');
    box.textContent = '';
    $('dCount').textContent = cur.students.length + ' élèves';
    cur.students.forEach((s, n) => {
      const card = el('div', 'student');
      card.dataset.name = s.name.toLowerCase();
      card.appendChild(el('b', 'sname', `${n + 1}.  ${s.name}`));
      card.appendChild(markRow('Discipline', s, 'disc'));
      card.appendChild(markRow('Devoirs', s, 'hw'));
      const rem = el('textarea');
      rem.rows = 1;
      rem.placeholder = 'Remarques';
      rem.value = s.rem;
      rem.addEventListener('input', () => { s.rem = rem.value; schedule({ student: s }); });
      card.appendChild(rem);
      box.appendChild(card);
    });
  }

  $('dSearch').addEventListener('input', () => {
    const q = $('dSearch').value.trim().toLowerCase();
    document.querySelectorAll('#dStudents .student').forEach((c) => { c.hidden = !!q && !c.dataset.name.includes(q); });
  });

  $('dSeating').addEventListener('click', async () => {
    await flush();
    show('clsSeating');
    window.openSeating(cur.id, () => openClass(cur.id));
  });

  $('dBack').addEventListener('click', showClassList);

  // Arabic sheet: the Arabic spelling of the directorate and of the school is asked once, then remembered
  function askArabic(list) {
    return new Promise((resolve) => {
      const box = $('arList'); box.textContent = '';
      const inputs = list.map((fr) => { const l = el('label', 'field', fr); const i = el('input'); i.dir = 'rtl'; i.placeholder = 'بالعربية'; l.appendChild(i); box.appendChild(l); return [fr, i]; });
      const dlg = $('dlgArabic');
      const done = (ok) => { dlg.close(); resolve(ok ? Object.fromEntries(inputs.map(([fr, i]) => [fr, i.value])) : null); };
      $('arOk').onclick = () => done(true); $('arSkip').onclick = () => done(false);
      dlg.showModal();
    });
  }

  $('dPdf').addEventListener('click', async () => {
    await flush();
    $('dStatus').textContent = 'Création du PDF…';
    let r = await window.api.classes.pdf(cur.id);
    if (r.needArabic) {
      const map = await askArabic(r.needArabic);
      if (map) await window.api.classes.arabicNames(map);
      r = await window.api.classes.pdf(cur.id, { skipNames: true });
    }
    $('dStatus').textContent = !r.ok ? r.error : (r.canceled ? '' : 'Fiche enregistrée : ' + r.path);
  });

  $('dGrades').addEventListener('click', async () => {
    await flush();
    $('dStatus').textContent = 'Création de la feuille de notes…';
    const r = await window.api.classes.grades(cur.id, parseInt($('dCc').value, 10));
    $('dStatus').textContent = !r.ok ? r.error : (r.canceled ? '' : 'Feuille de notes enregistrée : ' + r.path);
  });

  $('dDelete').addEventListener('click', async () => {
    if (!window.confirm(`Supprimer la liste « ${cur.name} » ?`)) return;
    dirty.clear();
    await window.api.classes.remove(cur.id);
    cur = null;
    showClassList();
  });

  window.addEventListener('beforeunload', () => { flush(); });
})();
