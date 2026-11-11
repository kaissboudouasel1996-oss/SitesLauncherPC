'use strict';
// Seating plan: 4 rows x 5 tables x 2 seats. Seat number = row * 10 + table * 2 + side (table 0 is the closest to the board).
const { studentName } = require('./sheet');
const { SEAT_COUNT } = require('./classes');

const students = (c) => c.rows.map((_, i) => i).filter((i) => c.rows[i].some(Boolean));

/** Forgets places that point to nobody, and students written twice. Returns true when something changed. */
function sanitize(c) {
  const ok = new Set(students(c)); const seen = new Set(); let changed = false;
  c.seats.forEach((s, i) => { if (s >= 0 && (!ok.has(s) || seen.has(s))) { c.seats[i] = -1; changed = true; } else if (s >= 0) seen.add(s); });
  return changed;
}

/** Puts [student] on [seat] (-1 frees it); a student who already has a seat swaps places with whoever is on [seat]. */
function assign(c, seat, student) {
  if (seat < 0 || seat >= SEAT_COUNT) return false;
  if (student < 0) { c.seats[seat] = -1; return true; }
  const prev = c.seats.indexOf(student);
  if (prev === seat) return false;
  if (prev >= 0) c.seats[prev] = c.seats[seat];
  c.seats[seat] = student;
  return true;
}
function autoFill(c) { c.seats.fill(-1); students(c).slice(0, SEAT_COUNT).forEach((s, n) => { c.seats[n] = s; }); }
function clear(c) { c.seats.fill(-1); }

const where = (seat) => ({ row: Math.floor(seat / 10) + 1, table: Math.floor((seat % 10) / 2) + 1, side: seat % 2 === 0 ? 'gauche' : 'droite' });

function view(c) {
  const list = students(c);
  const seats = c.seats.map((s, seat) => ({ seat, student: s, label: s >= 0 ? studentName(c, s) : '' }));
  const placed = c.seats.filter((s) => s >= 0).length;
  return {
    id: c.id, name: c.name, seats, placed, total: SEAT_COUNT, waiting: list.length - placed,
    students: list.map((i) => ({ index: i, name: studentName(c, i), seat: c.seats.indexOf(i) }))
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A4 landscape page: the board on top, the tables below (row 1 on the left). */
function buildHtml(c, boardText, opts) {
  const tr = opts && opts.tr ? opts.tr : (x) => x;
  const cols = [0, 1, 2, 3].map((row) => {
    const tables = [0, 1, 2, 3, 4].map((t) => {
      const seat = (side) => { const s = c.seats[row * 10 + t * 2 + side]; return `<div class="s" dir="auto">${s >= 0 ? esc(studentName(c, s)) : ''}</div>`; };
      return `<div class="t">${seat(0)}${seat(1)}</div>`;
    }).join('');
    return `<div class="r"><div class="rh">${esc(tr('Rangée ' + (row + 1)))}</div>${tables}</div>`;
  }).join('');
  return `<!doctype html><html lang="${opts && opts.rtl ? 'ar' : 'fr'}"${opts && opts.rtl ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><title>Plan de classe ${esc(c.name)}</title><style>
@page{size:A4 landscape;margin:10mm}
*{box-sizing:border-box}
body{margin:0;font-family:Calibri,"Segoe UI",Arial,sans-serif;color:#000}
h1{font-size:18px;text-align:center;margin:0 0 6px}
.board{background:#2f5d50;color:#fff;border:2px solid #7a5a2b;border-radius:4px;padding:4px 10px;margin:0 auto 6px;width:70%;text-align:center;font-size:10px;min-height:12mm;white-space:pre-line}
.room{display:flex;gap:8px;direction:ltr}
.r{flex:1;display:flex;flex-direction:column;gap:5px}
.rh{text-align:center;font-weight:700;font-size:12px}
.t{display:flex;border:1.3px solid #000;background:#FFE699;height:21mm}
.s{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;padding:2px;overflow:hidden;background:#fff;margin:2px}
.teacher{margin:6px 0 0 auto;width:30mm;border:1.3px solid #000;background:#ddd;text-align:center;font-size:11px;padding:3px}
</style></head><body><h1>${esc(tr('Plan de classe'))} · ${esc(c.name)}</h1>${boardText ? `<div class="board">${esc(boardText)}</div>` : ''}<div class="room">${cols}</div><div class="teacher">${esc(tr('Bureau'))}</div></body></html>`;
}

module.exports = { students, sanitize, assign, autoFill, clear, where, view, buildHtml };
