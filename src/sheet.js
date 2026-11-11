'use strict';
// Reads a table (Excel .xlsx, CSV, "Excel" exported as a web page) and finds the student list in it.
// Port of SheetSource / OfficeText.xlsxSheets of the Android app.
const fs = require('fs');
const { ZipReader } = require('./zip');
const xml = require('./xml');

const ID_KEYS = /(nom|prénom|prenom|name|massar|code|n°|numéro|numero|اسم|الاسم|النسب|نسب|مسار|رمز|رقم|تلميذ|élève|eleve|متعلم|ر\.ت)/i;
const MARK_KEYS = /(note|نقطة|نقط|moyenne|معدل|مراقبة|contrôle|controle|devoir|فرض|rang|ترتيب|observation|ملاحظ)/i;
const CODE_COL = /(massar|code|n°|numéro|numero|رمز|مسار|رقم|ر\.ت)/i;
const NAME_COL = /(nom|prénom|prenom|name|اسم|الاسم|النسب|نسب|تلميذ|élève|eleve|متعلم)/i;

function sniff(buf) {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return 'xlsx';
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'ole';
  const head = buf.subarray(0, 2048).toString('utf8').toLowerCase();
  if (/<\s*(table|html|!doctype)/.test(head)) return 'html';
  return 'text';
}

function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

function xlsxSheets(file) {
  const z = new ZipReader(file);
  try {
    const shared = [];
    if (z.has('xl/sharedStrings.xml')) {
      let cur = ''; let inT = false; let inPh = false;
      xml.parse(z.readText('xl/sharedStrings.xml'), {
        open(n) { if (n === 'si') cur = ''; else if (n === 'rPh') inPh = true; else if (n === 't') inT = !inPh; },
        text(s) { if (inT) cur += s; },
        close(n) { if (n === 't') inT = false; else if (n === 'rPh') inPh = false; else if (n === 'si') shared.push(cur); }
      });
    }
    const names = [];
    if (z.has('xl/workbook.xml')) xml.parse(z.readText('xl/workbook.xml'), { open(n, a) { if (n === 'sheet') names.push(a.name || ''); } });
    const files = [...z.entries.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/(\d+)\.xml$/)[1], 10) - parseInt(b.match(/(\d+)\.xml$/)[1], 10));
    return files.map((name, i) => {
      const rows = [];
      let row = null; let type = ''; let col = 0; let val = ''; let inV = false; let inT = false;
      xml.parse(z.readText(name), {
        open(n, a) {
          if (n === 'row') row = [];
          else if (n === 'c') { type = a.t || ''; col = a.r ? colIndex(a.r) : (row ? row.length : 0); val = ''; }
          else if (n === 'v') inV = true;
          else if (n === 't') inT = true;
        },
        text(s) { if (inV || (inT && type === 'inlineStr')) val += s; },
        close(n) {
          if (n === 'v') inV = false;
          else if (n === 't') inT = false;
          else if (n === 'c' && row) {
            let out = val;
            if (type === 's') out = shared[parseInt(val, 10)] || '';
            else if (type === 'b') out = val === '1' ? 'TRUE' : 'FALSE';
            while (row.length < col) row.push('');
            row[col] = out;
          } else if (n === 'row' && row) { rows.push(row); row = null; }
        }
      });
      return { title: names[i] || 'Sheet ' + (i + 1), rows };
    });
  } finally { z.close(); }
}

function parseDelimited(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const first = clean.split(/\r?\n/).find((l) => l.trim()) || '';
  const count = (d) => first.split(d).length - 1;
  const delim = [';', '\t', ','].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted && ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === delim) { row.push(cell); cell = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Web pages from the sites are not always UTF-8 (Massar uses windows-1256 for Arabic): the declared charset is used then. */
function decodeHtml(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, ''); } catch (e) { /* not UTF-8 */ }
  const head = buf.subarray(0, 2048).toString('latin1');
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(head);
  for (const cs of [m ? m[1] : 'windows-1256', 'windows-1252']) { try { return new TextDecoder(cs).decode(buf).replace(/^\uFEFF/, ''); } catch (e) { /* next */ } }
  return buf.toString('latin1');
}

function htmlTables(html) {
  const tables = [];
  const tre = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = tre.exec(html))) {
    const rows = [];
    const rre = /<tr[\s\S]*?<\/tr>/gi;
    let r;
    while ((r = rre.exec(m[0]))) {
      const cells = [];
      const cre = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let c;
      while ((c = cre.exec(r[0]))) cells.push(xml.decode(c[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

/** Returns the rows of the biggest table of the file, or null. */
function readTable(file) {
  const buf = fs.readFileSync(file);
  const kind = sniff(buf);
  try {
    if (kind === 'xlsx') { const s = xlsxSheets(file); return s.length ? s.reduce((a, b) => (b.rows.length > a.rows.length ? b : a)).rows : null; }
    if (kind === 'html') { const t = htmlTables(decodeHtml(buf)); return t.length ? t.reduce((a, b) => (b.length > a.length ? b : a)) : null; }
    if (kind === 'ole') return null; // very old .xls
    return parseDelimited(buf.toString('utf8'));
  } catch (e) { return null; }
}

/** Finds the header and the student rows, keeping only the identity columns (no existing marks). */
function parseRoster(raw) {
  const rows = raw.map((r) => r.map((c) => String(c == null ? '' : c).trim())).filter((r) => r.some((c) => c));
  if (rows.length < 2) return null;
  const firstRows = rows.slice(0, 15);
  let hi = firstRows.findIndex((r) => r.filter((c) => ID_KEYS.test(c)).length >= 2);
  if (hi < 0) hi = firstRows.findIndex((r) => r.filter((c) => c).length >= 2);
  if (hi < 0) return null;
  const header = rows[hi];
  const body = rows.slice(hi + 1).filter((r) => r.filter((c) => c).length >= 2);
  if (!body.length) return null;
  let cols = header.map((_, i) => i).filter((i) => ID_KEYS.test(header[i]) && !MARK_KEYS.test(header[i]));
  if (!cols.length) {
    cols = header.map((_, i) => i).filter((i) => !MARK_KEYS.test(header[i]) && (header[i] || body.some((r) => r[i]))).slice(0, 4);
  }
  if (!cols.length) return null;
  const students = body.map((r) => cols.map((i) => r[i] || '')).filter((r) => r.some((c) => c));
  if (!students.length) return null;
  return { header: cols.map((i) => header[i]), rows: students };
}

function loadRoster(file) { const t = readTable(file); return t ? parseRoster(t) : null; }

/** The student's name only (no Massar code, no number). */
function studentName(cl, i) {
  const row = cl.rows[i];
  if (!row) return '';
  let cols = cl.header.map((_, k) => k).filter((k) => NAME_COL.test(cl.header[k]) && !CODE_COL.test(cl.header[k]));
  if (!cols.length) cols = cl.header.map((_, k) => k).filter((k) => !CODE_COL.test(cl.header[k]));
  if (!cols.length) cols = cl.header.map((_, k) => k);
  const s = cols.map((k) => row[k] || '').filter(Boolean).join(' ');
  return s || row.filter(Boolean).join(' ');
}

module.exports = { htmlTables, decodeHtml, readTable, parseRoster, loadRoster, studentName, parseDelimited, xlsxSheets };
