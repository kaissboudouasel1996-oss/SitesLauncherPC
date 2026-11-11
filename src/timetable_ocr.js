'use strict';
// Turns the text found in a photo of a timetable into a Timetable. Port of TimetableOcr (Timetable.kt).
// The hour headings (08h - 09h ...) give the columns, and the rows are found from the vertical positions of the text.
// Works the same for a left-to-right or a right-to-left table.
const T = require('./timetable');

const HOURS = /([0-9OoIl|]{1,2})\s*[hHnN:]?\s*[-–—~_.]+\s*([0-9OoIl|]{1,2})\s*[hHnN:]?/g;
const ONE_AS_L = /^[lI|!]\s*(?=[aA][pP][iI][cC])/;
const APIC = /^([0-9lI|])\s*([aA][pP][iI][cC])\s*(\S{1,3})$/;
const CLASS_LIKE = /^\d[A-Za-z]{2,}/;
const LEADING_NUMBER = /^\D{0,3}(\d+)(.*)$/;
const TRAILING_NUMBER = /(\d{1,3})\D{0,6}$/;
const STD = [8, 9, 10, 11, 14, 15, 16, 17];

const width = (b) => b.right - b.left;
const height = (b) => b.bottom - b.top;
const cx = (b) => (b.left + b.right) / 2;
const cy = (b) => (b.top + b.bottom) / 2;
const median = (v) => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const avg = (v) => v.reduce((a, b) => a + b, 0) / v.length;

/** Characters that the reader often confuses with a digit at the end of a class name. */
function fixDigit(c) {
  if ('lI|i!'.includes(c)) return '1';
  if (c === '&' || c === 'B') return '8';
  if (c === 'S') return '5';
  if (c === 'O' || c === 'o') return '0';
  if (c === 'g' || c === 'q') return '9';
  return c;
}

/** The room number in a line such as « 10 ةعاقلا » or « 10 cll| » (the Arabic word is read as noise). */
function roomNumber(s) {
  const m = LEADING_NUMBER.exec(s);
  if (m) {
    let d = m[1]; const rest = m[2];
    if (d.length >= 3 && rest && /\p{L}/u.test(rest[0])) d = d.slice(0, 2);
    return d.slice(0, 3);
  }
  const t = TRAILING_NUMBER.exec(s);
  return t ? t[1] : null;
}

/** One line of a box: a class is kept (and repaired), a room becomes « Salle 10 », noise is dropped. Returns [text, isRoom] or null. */
function clean(raw, roomWord) {
  const s0 = raw.trim();
  if (!s0) return null;
  const m = APIC.exec(s0);
  if (m) {
    const head = fixDigit(m[1][0]); const tail = [...m[3]].map(fixDigit).join('');
    if (/^\d+$/.test(tail)) return [head + m[2] + tail, false];
  }
  const s = s0.replace(ONE_AS_L, '1');
  if (CLASS_LIKE.test(s)) return [s, false];
  const room = roomNumber(s);
  if (room !== null) return [roomWord + ' ' + room, true];
  const letters = [...s].filter((c) => /[a-zA-Z]/.test(c)).length;
  return letters >= 3 ? [s, false] : null;
}

const digits = (g) => parseInt([...g].map((c) => (c === 'O' || c === 'o' ? '0' : c === 'I' || c === 'l' || c === '|' ? '1' : c)).join(''), 10);
const label = (a, b) => `${String(a).padStart(2, '0')}h - ${String(b).padStart(2, '0')}h`;

/** Every « 08h - 09h » found in the text (a line may hold several), with its position. */
function findHeads(lines) {
  const all = []; const content = [];
  for (const l of lines) {
    const ms = [...l.text.matchAll(HOURS)];
    if (!ms.length) { content.push(l); continue; }
    const len = Math.max(1, l.text.length);
    for (const m of ms) {
      if (!/\d/.test(m[1]) || !/\d/.test(m[2])) continue;
      const a = digits(m[1]); const b = digits(m[2]);
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      const s = Math.min(a, b); const e = Math.max(a, b);
      if (s === e || e > 24) continue;
      const mid = (m.index + (m.index + m[0].length - 1) + 1) / 2;
      all.push({ start: s, end: e, cx: l.left + width(l) * mid / len, cy: cy(l), bottom: l.bottom });
    }
  }
  if (!all.length) return { heads: [], content };
  const lh = Math.max(12, median(lines.map(height)));
  const headY = median(all.map((h) => h.cy));
  const seen = new Set();
  const heads = all.filter((h) => Math.abs(h.cy - headY) <= lh * 1.5).sort((a, b) => a.start - b.start).filter((h) => (seen.has(h.start) ? false : seen.add(h.start)));
  return { heads, content };
}

/** True when the hour headings could be read (then the direction of the table is known). */
const hasHeadings = (lines) => findHeads(lines).heads.length >= 2;

/**
 * lines: [{ text, left, top, right, bottom }]. rtl (days on the right, as in the Arabic form) is only used when no hour heading
 * could be read: the columns are then taken from the width of the picture. Returns a timetable ({ periods, cells }) or null.
 */
function build(lines, imgW, imgH, rtl, roomWord = 'Salle') {
  if (!lines.length) return null;
  const lh = Math.max(12, median(lines.map(height)));

  // 1. Columns. The usual hours are always in this order, so two readable headings are enough to place all eight columns.
  const { heads, content } = findHeads(lines);
  let periods; let colCx; let headBottom;
  const std = heads.filter((h) => STD.includes(h.start) && h.end === h.start + 1);
  if (std.length >= 2) {
    const idx = std.map((h) => STD.indexOf(h.start)); const mi = avg(idx); const mx = avg(std.map((h) => h.cx));
    let num = 0; let den = 0;
    std.forEach((h, k) => { num += (idx[k] - mi) * (h.cx - mx); den += (idx[k] - mi) * (idx[k] - mi); });
    const slope = num / den;
    periods = STD.map((s) => label(s, s + 1));
    colCx = STD.map((_, i) => mx + slope * (i - mi));
    headBottom = Math.max(...std.map((h) => h.bottom));
  } else if (heads.length >= 2) {
    periods = heads.map((h) => label(h.start, h.end));
    colCx = heads.map((h) => h.cx);
    headBottom = Math.max(...heads.map((h) => h.bottom));
  } else {
    // No heading read: the picture is the table (the scanner crops it), with a day column on one side.
    const colW = imgW / 8.6; const day = colW * 0.6;
    periods = STD.map((s) => label(s, s + 1));
    colCx = STD.map((_, i) => { const x = day + (i + 0.5) * colW; return rtl ? imgW - x : x; });
    headBottom = imgH / 6.45 * 0.45;
  }
  const colPitch = Math.abs(colCx[1] - colCx[0]);

  // 2. Text under the headings, one piece per cleaned line.
  const pieces = [];
  for (const l of content) {
    const y = cy(l); if (y <= headBottom) continue;
    const x = cx(l);
    let col = -1; let bd = Infinity;
    colCx.forEach((c, i) => { const d = Math.abs(c - x); if (d < bd) { bd = d; col = i; } });
    if (col < 0 || bd > colPitch * 0.75) continue;
    const c = clean(l.text, roomWord); if (!c) continue;
    pieces.push({ cy: y, col, text: c[0], isRoom: c[1] });
  }
  if (!pieces.length) return null;

  // 3. Boxes: in each column a class line starts a box, and the room line(s) under it belong to it.
  const cells = [];
  for (let col = 0; col < colCx.length; col++) {
    let cur = null;
    for (const p of pieces.filter((q) => q.col === col).sort((a, b) => a.cy - b.cy)) {
      if (cur && !CLASS_LIKE.test(p.text) && cur.pieces.length < 3 && p.cy - cur.pieces[cur.pieces.length - 1].cy <= lh * 1.8) cur.pieces.push(p);
      else { cur = { col, pieces: [p] }; cells.push(cur); }
    }
  }
  for (const c of cells) { c.cy = avg(c.pieces.map((p) => p.cy)); c.text = c.pieces.map((p) => p.text).join('\n'); }
  cells.sort((a, b) => a.cy - b.cy);

  // 4. Rows: boxes whose centres are at the same height are in the same row.
  const clusters = [];
  for (const c of cells) {
    const last = clusters[clusters.length - 1];
    if (last && c.cy - last[last.length - 1].cy <= lh * 1.5) last.push(c); else clusters.push([c]);
  }
  const centers = clusters.map((cl) => avg(cl.map((c) => c.cy)));
  const jumps = new Array(clusters.length).fill(1);
  let pitch;
  if (clusters.length === 1) pitch = lh * 3;
  else {
    const diffs = centers.slice(1).map((c, i) => c - centers[i]);
    const dmin = Math.min(...diffs); let steps = 0;
    diffs.forEach((d, i) => { jumps[i + 1] = Math.max(1, Math.round(d / dmin)); steps += jumps[i + 1]; });
    pitch = diffs.reduce((a, b) => a + b, 0) / steps;
  }
  let row = Math.max(0, Math.round((centers[0] - headBottom) / pitch - 0.5));

  // 5. Fill the table.
  const grid = Array.from({ length: T.DAYS }, () => periods.map(() => ''));
  let any = false;
  for (let i = 0; i < clusters.length; i++) {
    if (i > 0) row += jumps[i];
    if (row >= T.DAYS) break;
    for (const c of clusters[i]) { const old = grid[row][c.col]; grid[row][c.col] = old ? old + '\n' + c.text : c.text; any = true; }
  }
  return any ? T.normalize({ periods, cells: grid }) : null;
}

module.exports = { build, hasHeadings, clean, findHeads };
