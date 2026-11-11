'use strict';
// Arabic spelling of the provincial directorate and of the school, for the Arabic tracking sheet.
// Known provinces are built in; anything else is asked once and remembered. Port of ArabicNames.kt.
const BUILT_IN = require('./data/ar_names.json');

const key = (s) => s.trim().normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[\s'’-]+/g, ' ').trim();
const hasArabic = (s) => /[\u0600-\u06FF]/.test(s);

class ArabicNames {
  /** saved: an object kept by the caller ({ key: arabic }). */
  constructor(saved) { this.saved = saved || {}; }
  /** The saved or built-in spelling, the text itself when it is already Arabic, or null when it is not known yet. */
  lookup(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (hasArabic(t)) return t;
    const k = key(t);
    return this.saved[k] || BUILT_IN[k] || null;
  }
  save(text, arabic) { const a = String(arabic || '').trim(); if (a) this.saved[key(text)] = a; }
  /** What to print in the Arabic PDF: the Arabic spelling if known, otherwise the text as typed. */
  forPdf(text) { return !text || !String(text).trim() ? text : (this.lookup(text) || text); }
  /** The texts among [list] that have no Arabic spelling yet. */
  missing(list) { return [...new Set(list.map((x) => String(x || '').trim()).filter((t) => t && this.lookup(t) === null))]; }
}

module.exports = { ArabicNames, hasArabic, key };
