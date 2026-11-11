'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  async function add(id) {
    const r = await window.api.calendar.add(id);
    $('calMsg').textContent = !r.ok ? r.error : (r.canceled ? '' : r.opened ? 'Fichier calendrier ouvert : confirmez l’ajout dans votre application de calendrier.' : 'Fichier enregistré : ' + r.path);
  }

  function card(i, big) {
    const c = el(i.addable ? 'button' : 'div', 'hcard' + (i.past ? ' past' : '') + (big ? ' next' : ''));
    const head = el('div', 'hhead');
    head.append(el('span', 'hicon', i.icon), el('b', 'hname', i.name));
    if (!big) head.appendChild(el('span', 'hdays', i.daysLabel));
    c.appendChild(head);
    c.appendChild(el('span', 'hdate', i.dateText));
    if (i.status) c.appendChild(el('span', 'hstatus ' + i.status.kind, i.status.text));
    if (i.addable) c.addEventListener('click', () => add(i.id));
    return c;
  }

  async function showCalendar() {
    const v = await window.api.calendar.view();
    $('calMsg').textContent = '';
    const next = $('calNext');
    next.textContent = '';
    if (v.next) { next.appendChild(el('p', 'hnextlabel', 'Prochaine vacance')); next.appendChild(card(v.next, true)); }
    const list = $('calList');
    list.textContent = '';
    v.items.forEach((i) => list.appendChild(card(i, false)));
    $('calNote').textContent = v.note;
  }
  window.showCalendar = showCalendar;

  $('calAll').addEventListener('click', () => add(null));
})();
