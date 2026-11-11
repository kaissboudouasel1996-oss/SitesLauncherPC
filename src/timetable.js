'use strict';
// Weekly timetable: Monday to Saturday (rows) by hour (columns). Every box is free text. Same JSON as the Android app.
const fs = require('fs');
const path = require('path');

const DAYS = 6;
const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const defaultPeriods = () => ['08h - 09h', '09h - 10h', '10h - 11h', '11h - 12h', '14h - 15h', '15h - 16h', '16h - 17h', '17h - 18h'];

function normalize(o) {
  o = o || {};
  const periods = Array.isArray(o.periods) && o.periods.length ? o.periods.map(String) : defaultPeriods();
  const cells = Array.from({ length: DAYS }, (_, d) => periods.map((_, p) => String(((o.cells || [])[d] || [])[p] || '')));
  return { periods, cells };
}
const isEmpty = (t) => t.cells.every((r) => r.every((c) => !c.trim()));

class TimetableStore {
  constructor(dir) { this.file = path.join(dir, 'timetable.json'); }
  load() { try { return normalize(JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch (e) { return normalize({}); } }
  save(t) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const n = normalize(t);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(n), 'utf8');
    fs.renameSync(tmp, this.file);
    return n;
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A4 landscape page of the timetable, for the PDF. */
function buildHtml(t, title = 'Emploi du temps', opts = {}) {
  const days = opts.days || DAY_NAMES;
  const head = `<tr><th class="d"></th>${t.periods.map((p) => `<th>${esc(p)}</th>`).join('')}</tr>`;
  const rows = t.cells.map((r, d) => `<tr><th class="d">${days[d]}</th>${r.map((c) => `<td dir="auto">${esc(c).replace(/\r?\n/g, '<br>')}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html lang="${opts.rtl ? 'ar' : 'fr'}"${opts.rtl ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page{size:A4 landscape;margin:12mm}
*{box-sizing:border-box}
body{margin:0;font-family:Calibri,"Segoe UI",Arial,sans-serif;color:#000}
h1{font-size:20px;text-align:center;margin:0 0 10px}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{border:1.3px solid #000;text-align:center;vertical-align:middle;padding:4px;font-size:13px;height:25mm}
tr:first-child th{height:11mm;background:#5B9BD5;font-weight:600}
th.d{width:24mm;background:#FFE699;font-weight:600}
td{background:#fff}
</style></head><body><h1>${esc(title)}</h1><table>${head}${rows}</table></body></html>`;
}

module.exports = { TimetableStore, normalize, isEmpty, buildHtml, DAYS, DAY_NAMES, defaultPeriods };
