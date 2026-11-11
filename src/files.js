'use strict';
// The files downloaded from the sites: where they are kept, how they are named, and what they really are.
// Port of FileStore.kt, Downloader.kt (naming part) and Spreadsheet.convertHtmlExcel of the Android app.
const fs = require('fs');
const path = require('path');
const { ZipReader, writeZip } = require('./zip');
const sheet = require('./sheet');

const WEB_PAGE_MESSAGE = 'Le site a envoyé une page web au lieu du fichier. Votre session a peut-être expiré, ou ce lien ne fonctionne qu’une fois. Revenez à la page et appuyez de nouveau sur le bouton de téléchargement.';
const SPECIFIC = new Set(['pdf', 'png', 'jpg', 'gif', 'webp', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);
const DISGUISED_HTML = new Set(['xls', 'xlsx', 'doc', 'docx', 'html', 'htm']);
/** Extensions that say nothing about the real type (web scripts, « bin », no extension...). */
const WEAK = new Set(['', 'bin', 'php', 'asp', 'aspx', 'jsp', 'jspx', 'do', 'action', 'cgi', 'ashx', 'dat', 'download', 'tmp']);

const extName = (name) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
function stem(name) { const d = name.lastIndexOf('.'); return d > 0 ? name.slice(0, d) : name; }

/** A safe file name: no folders, no characters Windows refuses, not too long. */
function sanitize(name) {
  let n = String(name).split('/').pop().split('\\').pop();
  n = n.replace(/[\u0000-\u001f:*?"<>|]/g, '_').trim().replace(/^\.+|\.+$/g, '').trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = '_' + n; // names Windows reserves
  if (!n) n = 'file';
  if (n.length > 120) { const d = n.lastIndexOf('.'); const ext = d > 0 && n.length - d <= 10 ? n.slice(d) : ''; n = n.slice(0, 100) + ext; }
  return n;
}

/** Looks at the first bytes of the file: « pdf », « png », « jpg », « gif », « webp », « docx », « xlsx », « pptx », « odt », « ods », « odp », « zip », « html », « ole » (old .doc/.xls/.ppt) or null. */
function sniff(file) {
  let head;
  try { const fd = fs.openSync(file, 'r'); try { head = Buffer.alloc(1024); const n = fs.readSync(fd, head, 0, 1024, 0); head = head.subarray(0, n); } finally { fs.closeSync(fd); } } catch (e) { return null; }
  if (!head.length) return null;
  const starts = (...b) => head.length >= b.length && b.every((x, i) => head[i] === x);
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'pdf';
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (starts(0xff, 0xd8, 0xff)) return 'jpg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && head.length >= 12 && head.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (starts(0x50, 0x4b, 0x03, 0x04)) return sniffZip(file);
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return 'ole';
  const text = head.toString('latin1').replace(/^\u00ef\u00bb\u00bf/, '').trimStart().toLowerCase();
  return text.startsWith('<!doctype html') || text.startsWith('<html') || text.startsWith('<table') || text.includes('<html') || text.includes('<body') ? 'html' : null;
}

function sniffZip(file) {
  let z;
  try {
    z = new ZipReader(file);
    if (z.has('word/document.xml')) return 'docx';
    if (z.has('xl/workbook.xml')) return 'xlsx';
    if (z.has('ppt/presentation.xml')) return 'pptx';
    if (z.has('mimetype')) {
      const t = z.readText('mimetype');
      if (t.endsWith('opendocument.text')) return 'odt';
      if (t.endsWith('opendocument.spreadsheet')) return 'ods';
      if (t.endsWith('opendocument.presentation')) return 'odp';
    }
    return 'zip';
  } catch (e) { return null; } finally { if (z) z.close(); }
}

/** The extension to trust: the real content when it is recognisable, else the file name. */
function effectiveExtension(file) {
  const s = sniff(file);
  return s === null || s === 'ole' ? extName(path.basename(file)) : s;
}

const ICONS = [
  [['pdf'], '📕'], [['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'], '🖼️'], [['doc', 'docx', 'odt', 'rtf'], '📄'], [['xls', 'xlsx', 'ods', 'csv', 'tsv'], '📊'],
  [['ppt', 'pptx', 'odp'], '📽️'], [['txt', 'md', 'log', 'json', 'xml', 'html', 'htm'], '📝'], [['zip', 'rar', '7z'], '🗜️'], [['mp3', 'm4a', 'wav', 'ogg', 'aac', 'mp4', '3gp', 'webm', 'mkv'], '🎬']
];
const iconFor = (ext) => { const f = ICONS.find(([l]) => l.includes(ext)); return f ? f[1] : '📎'; };

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' Ko';
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' Mo';
}

// ---------- names ----------

const MIME_EXT = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.oasis.opendocument.text': 'odt', 'application/vnd.oasis.opendocument.spreadsheet': 'ods', 'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/zip': 'zip', 'application/x-zip-compressed': 'zip', 'text/plain': 'txt', 'text/csv': 'csv', 'text/html': 'html', 'application/json': 'json', 'application/rtf': 'rtf',
  'audio/mpeg': 'mp3', 'video/mp4': 'mp4'
};
function extFromMime(mime) {
  const m = String(mime || '').split(';')[0].trim().toLowerCase();
  if (!m || ['application/octet-stream', 'binary/octet-stream', 'application/force-download', 'application/download', 'application/x-download'].includes(m)) return null;
  return MIME_EXT[m] || null;
}

function nameFromDisposition(cd) {
  if (!cd || !cd.trim()) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(cd); // filename*=UTF-8''%D9%85...
  if (star) { try { const v = decodeURIComponent(star[2].trim().replace(/^"|"$/g, '')); if (v.trim()) return v; } catch (e) { /* next */ } }
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(cd); const plain = /filename\s*=\s*([^;]+)/i.exec(cd);
  let name = (quoted ? quoted[1] : plain ? plain[1] : null);
  if (name === null) return null;
  name = name.trim().replace(/^"|"$/g, '');
  if (name.includes('%')) { try { name = decodeURIComponent(name); } catch (e) { /* keep */ } }
  return name.trim() ? name : null;
}

function nameFromUrl(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  let last = '';
  try { last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || ''); } catch (e) { last = ''; }
  if (last && last.includes('.') && extName(last).length >= 1 && extName(last).length <= 5) return last;
  for (const key of ['filename', 'fileName', 'file', 'name', 'fichier']) { const v = u.searchParams.get(key); if (v && v.includes('.')) return v; }
  return null;
}

/** The file name the site suggests: Content-Disposition first, then the web address. */
function resolveName(url, ...dispositions) {
  for (const d of dispositions) { const n = nameFromDisposition(d); if (n) return sanitize(n); }
  const u = nameFromUrl(url);
  return u ? sanitize(u) : 'download';
}

// ---------- the folder ----------

class FileStore {
  constructor(dir) { this.dir = dir; }
  ensure() { fs.mkdirSync(this.dir, { recursive: true }); return this.dir; }
  /** A path that does not exist yet: « report.pdf », « report (1).pdf »... */
  uniquePath(name) {
    this.ensure();
    const clean = sanitize(name);
    let f = path.join(this.dir, clean);
    if (!fs.existsSync(f)) return f;
    const b = stem(clean); const e = clean.slice(b.length);
    for (let i = 1; ; i++) { f = path.join(this.dir, `${b} (${i})${e}`); if (!fs.existsSync(f)) return f; }
  }
  /** Newest first. Half-finished downloads (.part) are hidden. */
  list() {
    this.ensure();
    return fs.readdirSync(this.dir).filter((n) => !n.endsWith('.part') && !/\.mdb$/i.test(n)).map((n) => ({ n, f: path.join(this.dir, n) }))
      .filter((x) => { try { return fs.statSync(x.f).isFile(); } catch (e) { return false; } })
      .map((x) => { const st = fs.statSync(x.f); return { name: x.n, size: st.size, mtime: st.mtimeMs, ext: effectiveExtension(x.f) }; })
      .sort((a, b) => b.mtime - a.mtime)
      .map((x) => Object.assign(x, { sizeText: humanSize(x.size), icon: iconFor(x.ext) }));
  }
  /** The full path of a file of the folder, or null (a name from the screen never leaves the folder). */
  pathOf(name) {
    if (typeof name !== 'string' || !name || path.basename(name) !== name || name.endsWith('.part')) return null;
    const f = path.join(this.dir, name);
    try { return fs.statSync(f).isFile() ? f : null; } catch (e) { return null; }
  }
  remove(names) { let n = 0; for (const name of names) { const f = this.pathOf(name); if (f) { fs.unlinkSync(f); n++; } } return n; }
  /** Fixes older downloads saved as « .bin » although they are really PDFs, Word files... */
  repairNames() {
    for (const it of this.list()) {
      if (extName(it.name) !== 'bin') continue;
      const kind = sniff(path.join(this.dir, it.name));
      if (!kind || !SPECIFIC.has(kind) && kind !== 'zip') continue;
      fs.renameSync(path.join(this.dir, it.name), this.uniquePath(stem(it.name) + '.' + kind));
    }
  }

  /**
   * A finished download (the .part file) becomes a real file: the extension is the one of the content, not of the address.
   * « Excel » files that are really web pages with a table become a genuine .xlsx. Throws an Error with a readable message.
   */
  finish(part, rawName, mime, listenerMime) {
    const kind = sniff(part);
    const mimeExt = extFromMime(mime) || extFromMime(listenerMime);
    const original = extName(rawName);
    const base = stem(rawName);
    let ext = original;
    if (WEAK.has(ext) && mimeExt) ext = mimeExt;
    if (kind && SPECIFIC.has(kind)) {
      if (ext !== kind && !(kind === 'jpg' && ext === 'jpeg')) ext = kind;
    } else if (kind === 'zip') {
      if (WEAK.has(ext) || ext === 'html' || ext === 'htm' || ext === 'txt') ext = 'zip';
    } else if (kind === 'ole') {
      if (ext !== 'doc' && ext !== 'xls' && ext !== 'ppt') ext = ['doc', 'xls', 'ppt'].includes(mimeExt) ? mimeExt : 'doc';
    } else if (kind === 'html') {
      if (ext === 'xls' || ext === 'xlsx') {
        const rows = biggestTable(part);
        if (!rows) throw new Error(WEB_PAGE_MESSAGE);
        const target = this.uniquePath(base + '.xlsx');
        fs.writeFileSync(target, buildXlsx(rows));
        fs.unlinkSync(part);
        return target;
      }
      if (!DISGUISED_HTML.has(ext)) {
        const noType = !listenerMime || !listenerMime.trim() || listenerMime.toLowerCase().startsWith('text/html');
        if (WEAK.has(ext) && noType) ext = 'html'; else throw new Error(WEB_PAGE_MESSAGE);
      }
    }
    const target = this.uniquePath(ext ? `${base}.${ext}` : base);
    fs.renameSync(part, target);
    return target;
  }
}

function biggestTable(file) {
  try {
    const tables = sheet.htmlTables(sheet.decodeHtml(fs.readFileSync(file).subarray(0, 8000000)));
    return tables.length ? tables.reduce((a, b) => (b.length > a.length ? b : a)) : null;
  } catch (e) { return null; }
}

// ---------- a plain .xlsx from rows ----------

const colName = (index) => { let n = index; let s = ''; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
const xesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:[.,][0-9]+)?$/; // « 007 » (a code) stays text

function buildXlsx(rows, sheetName = 'Sheet1') {
  const cells = rows.flat().filter((c) => c !== '');
  const arabic = cells.length > 0 && cells.filter((c) => /[\u0600-\u06FF]/.test(c)).length * 2 > cells.length;
  const columns = Math.max(1, ...rows.map((r) => r.length));
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  let s = `${head}<worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0"${arabic ? ' rightToLeft="1"' : ''}/></sheetViews><cols><col min="1" max="${columns}" width="18" customWidth="1"/></cols><sheetData>`;
  rows.forEach((row, r) => {
    s += `<row r="${r + 1}">`;
    row.forEach((v, c) => {
      if (v === '') return;
      const ref = colName(c) + (r + 1);
      s += NUMBER.test(v) && v.length < 16 ? `<c r="${ref}"><v>${v.replace(',', '.')}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
    });
    s += '</row>';
  });
  s += '</sheetData></worksheet>';
  return writeZip([
    ['[Content_Types].xml', `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels', `${head}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${head}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="${xesc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${head}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', s]
  ]);
}

module.exports = { FileStore, sanitize, sniff, effectiveExtension, iconFor, humanSize, resolveName, extFromMime, buildXlsx, extName, stem, WEB_PAGE_MESSAGE };
