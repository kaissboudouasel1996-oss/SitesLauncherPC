'use strict';
// "Fiche de suivi" of a class as an A4 page (HTML, turned into a PDF by Electron).
// Same grid as the Android PdfExport: everything is placed on a 1080 x 1520 sheet scaled to the page.
const { studentName } = require('./sheet');

const W = 1080, H = 1520;
let RTL = false; // the Arabic sheet is the mirror image of the French one
const BASE_ROW = 26.5, PAD = 8, MARK_LINE = 20, BOTTOM = 1468;
const X = [65, 104, 322, 656, 849, 1014];
const COLORS = { blue: '#5B9BD5', yellow: '#FFE699', green: '#A9D18E', white: '#fff' };
const MARK_CHAR_W = 9.4, REMARK_CHAR_W = 7.6, REMARK_LINE = 19;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hasArabic = (s) => /[\u0600-\u06FF]/.test(s);

function marksLines(s, width) {
  if (!s) return [];
  const per = Math.max(1, Math.floor((width - 2 * PAD) / MARK_CHAR_W));
  const t = s.replace(/-/g, '−');
  const out = [];
  for (let i = 0; i < t.length; i += per) out.push(t.slice(i, i + per));
  return out;
}

function remarkLines(s) {
  if (!s) return 0;
  const per = Math.max(1, Math.floor((X[5] - X[4] - 2 * PAD) / REMARK_CHAR_W));
  let n = 0;
  for (const part of s.split(/\r?\n/)) n += Math.max(1, Math.ceil(part.length / per));
  return n;
}

function rowHeight(r) {
  const d = marksLines(r.disc, X[3] - X[2]).length * MARK_LINE + 8;
  const h = marksLines(r.hw, X[4] - X[3]).length * MARK_LINE + 8;
  const m = remarkLines(r.rem) * REMARK_LINE + 8;
  return Math.max(BASE_ROW, d, h, m);
}

function box(l0, t, r0, b, color, text, bold) {
  const [l, r] = RTL ? [W - r0, W - l0] : [l0, r0];
  const size = Math.max(10, Math.min(18, ((r - l - 8) / Math.max(1, text.length)) * 1.9));
  return `<div class="box" style="left:${l}px;top:${t}px;width:${r - l}px;height:${b - t}px;background:${color};font-size:${size.toFixed(1)}px;${bold ? 'font-weight:700' : ''}">${esc(text)}</div>`;
}

function tableHeader(L, top) {
  const m = top + BASE_ROW, b = m + BASE_ROW;
  return [
    box(X[0], top, X[2], m, COLORS.green, L.details), box(X[2], top, X[5], m, COLORS.green, L.observed),
    box(X[0], m, X[1], b, COLORS.yellow, L.no), box(X[1], m, X[2], b, COLORS.yellow, L.name),
    box(X[2], m, X[3], b, COLORS.yellow, L.discipline), box(X[3], m, X[4], b, COLORS.yellow, L.homework),
    box(X[4], m, X[5], b, COLORS.yellow, L.remarks)
  ].join('');
}

function rowHtml(r, top, h) {
  const cell = (i, inner, cls) => `<div class="cell ${cls || ''}" style="left:${RTL ? W - X[i + 1] : X[i]}px;top:${top}px;width:${X[i + 1] - X[i]}px;height:${h}px">${inner}</div>`;
  const marks = (s, i) => {
    const lines = marksLines(s, X[i + 1] - X[i]);
    return lines.length ? `<div class="marks${RTL ? ' rtl' : ''}">${lines.map((l) => `<div>${esc(l).replace(/\+/g, '<span class="p">+</span>').replace(/−/g, '<span class="m">−</span>')}</div>`).join('')}</div>` : '';
  };
  const name = r.name ? `<div class="nm" dir="auto" style="${RTL || hasArabic(r.name) ? 'text-align:right' : ''};font-size:${Math.max(10, Math.min(18, ((X[2] - X[1] - 2 * PAD) / Math.max(1, r.name.length)) * 1.9)).toFixed(1)}px">${esc(r.name)}</div>` : '';
  const rem = r.rem ? `<div class="rem" dir="${RTL ? 'rtl' : 'auto'}"><span>${esc(r.rem).replace(/\r?\n/g, "<br>")}</span></div>` : "";
  return cell(0, `<div class="num">${r.number}</div>`) + cell(1, name) + cell(2, marks(r.disc, 2)) + cell(3, marks(r.hw, 3)) + cell(4, rem);
}

const FR = {
  direction: 'Direction Provinciale', subject: 'Matière', school: 'Établissement', sheet: 'Fiche de suivi', year: 'Année scolaire',
  cls: 'Classe', details: 'Coordonnées', observed: 'Éléments observés', no: 'N°', name: 'Nom de l’élève',
  discipline: 'Discipline', homework: 'Devoirs', remarks: 'Remarques'
};

/** cl: a class (see classes.js). logo: data: URI of the ministry logo (or ''). */
function buildHtml(cl, logo, labels, opts) {
  RTL = !!(opts && opts.rtl);
  const L = Object.assign({}, FR, labels || {});
  const shown = cl.rows.map((_, i) => i).filter((i) => cl.rows[i].some((c) => c));
  const rows = shown.map((i, n) => ({ number: n + 1, name: studentName(cl, i), disc: cl.track[i][0], hw: cl.track[i][1], rem: cl.track[i][2] }));
  for (let k = 0; k < 2; k++) rows.push({ number: shown.length + k + 1, name: '', disc: '', hw: '', rem: '' }); // two empty lines, like the printed model

  const pages = [];
  let cur = null; let y = 0;
  const start = () => {
    const first = pages.length === 0;
    cur = { first, html: '' };
    pages.push(cur);
    cur.html += tableHeader(L, first ? 233 : 75);
    y = (first ? 233 : 75) + 2 * BASE_ROW;
  };
  start();
  for (const r of rows) {
    const h = rowHeight(r);
    if (y + h > BOTTOM) start();
    cur.html += rowHtml(r, y, h);
    y += h;
  }

  const head = (c) => (logo ? `<img class="logo" src="${logo}" style="left:${RTL ? W - 110 - 195 : 110}px;top:58px;width:195px">` : '') +
    box(370, 65, 566, 91, COLORS.blue, L.direction) + box(566, 65, 733, 91, COLORS.white, c.direction || '', true) +
    box(370, 115, 566, 141, COLORS.blue, L.subject) + box(566, 115, 733, 141, COLORS.white, c.subjectLabel || c.subject || '', true) +
    box(370, 166, 566, 192, COLORS.blue, L.school) + box(566, 166, 733, 192, COLORS.white, c.school || '', true) +
    box(759, 65, 1013, 91, COLORS.yellow, L.sheet) +
    box(759, 115, 899, 141, COLORS.blue, L.year) + box(899, 115, 1013, 141, COLORS.white, c.year || '', true) +
    box(759, 166, 899, 192, COLORS.blue, L.cls) + box(899, 166, 1013, 192, COLORS.white, c.name || '', true);

  const body = pages.map((p) => `<section class="page"><div class="frame"></div>${p.first ? head(cl) : ''}${p.html}</section>`).join('');
  return `<!doctype html><html lang="${RTL ? 'ar' : 'fr'}"${RTL ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><title>${esc(L.sheet)} ${esc(cl.name)}</title><style>
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;font-family:Calibri,"Segoe UI",Tahoma,Arial,sans-serif;color:#000}
.page{position:relative;width:${W}px;height:${H}px;zoom:0.7349;overflow:hidden;page-break-after:always;break-after:page}
.page:last-child{page-break-after:auto;break-after:auto}
.frame{position:absolute;left:43px;top:43px;width:993px;height:1440px;border:1.3px solid #000}
.box,.cell{position:absolute;border:1.3px solid #000;margin:0}
.box{display:flex;align-items:center;justify-content:center;text-align:center;white-space:nowrap;overflow:hidden;padding:0 4px}
.cell{background:#fff;overflow:hidden}
.logo{position:absolute;height:auto}
.num{height:${BASE_ROW}px;line-height:${BASE_ROW}px;text-align:center;font-size:18px}
.nm{height:${BASE_ROW}px;line-height:${BASE_ROW}px;padding:0 ${PAD}px;white-space:nowrap;overflow:hidden}
.marks{padding:4px ${PAD}px;font-size:16px;line-height:${MARK_LINE}px;display:flex;flex-direction:column;justify-content:center;height:100%}
.marks.rtl{direction:rtl;text-align:right}
.p{color:#2E9E4F;font-weight:700}.m{color:#D64545;font-weight:700}
.rem{padding:4px ${PAD}px;font-size:15px;line-height:${REMARK_LINE}px;height:100%;display:flex;align-items:center;overflow:hidden}
</style></head><body>${body}</body></html>`;
}

module.exports = { buildHtml, rowHeight, FR };
