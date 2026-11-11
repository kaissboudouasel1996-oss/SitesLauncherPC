'use strict';
// Finds the consigne of an activity in the pupil's book (1AC or 3AC), by reading the page picture. Port of BookConsigne.kt.
// Used by the Fiche technique when the PowerPoint does not show the consigne of a « Pratique guidée » clearly.
// A page is read once with the text recognition of Windows; its lines are then kept in a small file so that the next fiche does not read it again.
const fs = require('fs');
const path = require('path');

const CACHE_DIR = 'book_ocr_v1';
const LABEL = /^activit\p{L}*\s*[:.]?\s*(\d{1,2})(?![\p{L}\p{N}_])[\s:.\-–]*(.*)$/iu;

/** « 8 » -> [8]; « 10-11 » -> [10, 11]; « 10-11, 13 » -> [10, 11, 13]. At most 6 pages. */
function pageList(text) {
  if (!text || !String(text).trim()) return [];
  const out = [];
  for (const part of String(text).split(/[,;/]|\bet\b/)) {
    const m = /(\d+)(?:\s*[-–]\s*(\d+))?/.exec(part); if (!m) continue;
    const a = parseInt(m[1], 10); const b = m[2] !== undefined ? parseInt(m[2], 10) : a;
    if (b < a || b - a > 5) { out.push(a); continue; }
    for (let p = a; p <= b; p++) out.push(p);
  }
  return [...new Set(out)].slice(0, 6);
}

const lineHeight = (l) => Math.max(1, l.bottom - l.top);
const centerY = (l) => Math.floor((l.top + l.bottom) / 2);

/** Activity number -> its consigne, for every « Activité N » label of the page. */
function activities(lines) {
  const out = new Map();
  for (const lab of lines) {
    const m = LABEL.exec(lab.text.trim()); if (!m) continue;
    const number = String(parseInt(m[1], 10));
    if (out.has(number)) continue;
    let text = m[2].trim(); let startLeft = lab.right;
    if (text.length < 8) {
      // the label is a coloured tag: the consigne is the text on the same row, to its right
      const row = lines.filter((l) => l !== lab && l.left >= lab.right - 10 && Math.abs(centerY(l) - centerY(lab)) <= lineHeight(lab) * 0.7).sort((a, b) => a.left - b.left);
      if (!row.length) continue;
      text = row.map((l) => l.text).join(' ').trim(); startLeft = row[0].left;
    }
    // a long consigne goes on a second row, just below
    if (text && !':.?!'.includes(text[text.length - 1])) {
      const below = lines.filter((l) => l.top > lab.bottom - 4 && l.top - lab.bottom < lineHeight(lab) * 1.3 && l.left >= startLeft - 40 && l.left <= startLeft + 60 && !LABEL.test(l.text.trim()))
        .sort((a, b) => a.top - b.top)[0];
      if (below && below.text.length > 3) text = text + ' ' + below.text.trim();
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length >= 8) out.set(number, text);
  }
  return out;
}

class BookConsigne {
  /**
   * library: BookLibrary; dir: where the read pages are kept; recognize(imagePath) -> Promise<[{ text, left, top, right, bottom }]> (the lines of the page).
   */
  constructor({ library, dir, recognize }) { this.library = library; this.dir = path.join(dir, CACHE_DIR); this.recognize = recognize; this.readerFailed = false; }

  /** « 1AC » -> « 1ac », only when this book is known and has its pages. */
  bookId(niveau) {
    const id = String(niveau || '').toLowerCase().replace(/\s+/g, '');
    return this.library.find(id) && this.library.pageCount(id) > 0 ? id : null;
  }

  cacheFile(id, page) { return path.join(this.dir, id, 'p' + String(page).padStart(3, '0') + '.tsv'); }

  /** The lines of a page that was already read, or null. */
  cached(id, page) {
    const f = this.cacheFile(id, page);
    try {
      return fs.readFileSync(f, 'utf8').split('\n').filter((r) => r.length).map((row) => {
        const c = row.split('\t'); if (c.length < 5) return null;
        return { left: +c[0], top: +c[1], right: +c[2], bottom: +c[3], text: c.slice(4).join('\t') };
      }).filter(Boolean);
    } catch (e) { return null; }
  }

  /** The consigne printed in the book for [activity] on [pages] (« 8 » or « 8-9 »). Only pages already read are used: call prefetch first. Null when nothing sure is found. */
  find(niveau, activity, pages) {
    const id = this.bookId(niveau); if (!id) return null;
    const nums = pageList(pages); if (!nums.length) return null;
    const total = this.library.pageCount(id); const found = [];
    for (const n of nums) {
      if (n < 1 || n > total) continue;
      const lines = this.cached(id, n); if (!lines) continue;
      const acts = activities(lines);
      if (activity !== null && activity !== undefined) { const k = /^\d+$/.test(activity) ? String(parseInt(activity, 10)) : activity; if (acts.has(k)) found.push(acts.get(k)); } else found.push(...acts.values());
    }
    return found.length === 1 ? found[0] : null;
  }

  /** Reads the pages that are not read yet. Returns { read, failed }: failed is true when the text recognition could not be used. */
  async prefetch(niveau, pages) {
    const id = this.bookId(niveau); const res = { read: 0, failed: false };
    if (!id) return res;
    const total = this.library.pageCount(id);
    for (const n of [...new Set(pages)].filter((p) => p >= 1 && p <= total).slice(0, 12)) {
      if (this.cached(id, n) !== null) continue;
      const file = this.library.fileFor(id, n - 1); if (!file) continue;
      let lines;
      try { lines = await this.recognize(file); } catch (e) { this.readerFailed = true; res.failed = true; res.error = e; break; }
      try {
        fs.mkdirSync(path.dirname(this.cacheFile(id, n)), { recursive: true });
        fs.writeFileSync(this.cacheFile(id, n), lines.map((l) => `${Math.round(l.left)}\t${Math.round(l.top)}\t${Math.round(l.right)}\t${Math.round(l.bottom)}\t${l.text.replace(/[\t\n]/g, ' ')}`).join('\n'), 'utf8');
      } catch (e) { /* not kept: read again next time */ }
      res.read++;
    }
    return res;
  }
}

module.exports = { BookConsigne, pageList, activities };
