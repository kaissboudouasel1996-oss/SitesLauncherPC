'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let id = null; let back = null; let data = null; let seat = -1;

  const where = (s) => ({ row: Math.floor(s / 10) + 1, table: Math.floor((s % 10) / 2) + 1, side: s % 2 === 0 ? 'gauche' : 'droite' });

  function render() {
    $('sTitle').textContent = 'Plan de classe · ' + data.name;
    $('sInfo').textContent = `${data.placed}/${data.total} placés · ${data.waiting} sans place`;
    $('sBoard').textContent = data.board;
    const room = $('sRoom');
    room.textContent = '';
    for (let row = 0; row < 4; row++) {
      const col = el('div', 'srow');
      col.appendChild(el('div', 'srh', 'Rangée ' + (row + 1)));
      for (let t = 0; t < 5; t++) {
        const table = el('div', 'stable');
        for (let side = 0; side < 2; side++) {
          const n = row * 10 + t * 2 + side;
          const s = data.seats[n];
          const b = el('button', 'seat' + (s.student >= 0 ? ' taken' : ''), s.label);
          b.title = `Rangée ${row + 1} · Table ${t + 1} · ${side ? 'droite' : 'gauche'}`;
          b.addEventListener('click', () => choose(n));
          table.appendChild(b);
        }
        col.appendChild(table);
      }
      room.appendChild(col);
    }
  }

  async function openSeating(classId, onBack) {
    id = classId; back = onBack;
    data = await window.api.seating.get(id);
    if (!data) { if (back) back(); return; }
    render();
  }
  window.openSeating = openSeating;

  function choose(n) {
    seat = n;
    const w = where(n);
    $('seatTitle').textContent = `Rangée ${w.row} · Table ${w.table} · ${w.side}`;
    const list = $('seatList');
    list.textContent = '';
    const add = (text, student, cls) => { const b = el('button', 'pickrow ' + (cls || ''), text); b.value = String(student); b.addEventListener('click', async (e) => { e.preventDefault(); $('dlgSeat').close(); data = await window.api.seating.assign(id, seat, student); render(); }); list.appendChild(b); };
    const here = data.seats[n].student;
    if (here >= 0) add('✖ Libérer cette place', -1, 'free');
    data.students.filter((s) => s.seat < 0).forEach((s) => add(s.name, s.index));
    data.students.filter((s) => s.seat >= 0 && s.index !== here).forEach((s) => { const p = where(s.seat); add(`${s.name}  (R${p.row} · T${p.table})`, s.index, 'placed'); });
    if (!list.children.length) list.appendChild(el('p', 'muted', 'Aucun élève dans cette classe.'));
    $('dlgSeat').showModal();
  }

  $('sBack').addEventListener('click', () => { if (back) back(); });
  $('sBoard').addEventListener('click', () => window.alert(data.board));
  $('sFill').addEventListener('click', async () => {
    if (!window.confirm('Placer les élèves dans l’ordre de la liste ? Les places actuelles seront remplacées.')) return;
    data = await window.api.seating.autofill(id); render();
  });
  $('sClear').addEventListener('click', async () => {
    if (!window.confirm('Libérer toutes les places ?')) return;
    data = await window.api.seating.clear(id); render();
  });
  $('sPdf').addEventListener('click', async () => {
    const r = await window.api.seating.pdf(id);
    $('sInfo').textContent = !r.ok ? r.error : (r.canceled ? $('sInfo').textContent : 'Plan enregistré : ' + r.path);
  });
})();
