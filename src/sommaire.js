'use strict';
// The « Sommaire » of the pupil's book: every unit has 12 courses, each with its title and its page. One list per level (1AC, 3AC).
// Port of Sommaire.kt; the table itself is in data/books.json (converted from the Kotlin file).
const BOOKS = require('./data/books.json');

const semestreOf = (u) => (u.periode <= 3 ? '1' : '2');

/** The unit [number] of the book of [niveau] (« 1AC »), or null when this book is not known. */
function unit(niveau, number) {
  const list = BOOKS[String(niveau).toUpperCase().replace(/ /g, '')];
  const u = list ? list.find((x) => x.number === number) : null;
  return u ? Object.assign({ semestre: semestreOf(u) }, u) : null;
}

const key = (t) => t.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^a-z0-9]/g, '');

/** The level of the book that has the unit [number] with this [title]; null when no book, or more than one, fits. */
function guessLevel(number, title) {
  const k = key(title);
  if (k.length < 5) return null;
  const hits = Object.keys(BOOKS).filter((lvl) => BOOKS[lvl].some((u) => { if (u.number !== number) return false; const t = key(u.title); return t.includes(k) || k.includes(t); }));
  return hits.length === 1 ? hits[0] : null;
}

/** The course of the book that a component of the PowerPoint belongs to. */
function courseName(comp) {
  const c = comp.replace(/\s*\d$/, '');
  return c === 'Lecture fluence' || c === 'Compréhension globale' || c === 'Lecture fluence et compréhension globale' ? 'Lecture fluence et compréhension globale' : c;
}

/**
 * The courses of one séance. seq is the « Repérage dans l'unité » of the PowerPoint: [séance, course name] in the order of the unit.
 * Each name is matched with the next course of that name in the book, so the two « Vocabulaire », the two « Lecture fluence et
 * compréhension globale » and the two « Compréhension détaillée » are told apart. Empty when the PowerPoint does not follow the book.
 */
function coursesOf(u, seq, seance) {
  const out = []; let cur = -1;
  for (const [k, name] of seq) {
    if (!(cur >= 0 && u.courses[cur].name === name)) {
      let j = cur + 1;
      while (j < u.courses.length && u.courses[j].name !== name) j++;
      if (j >= u.courses.length) return [];
      cur = j;
    }
    if (k === seance && !out.includes(u.courses[cur])) out.push(u.courses[cur]);
  }
  return out;
}

/** Without a « Repérage »: the course names of the lesson, only when each name is in the book once. */
function coursesByName(u, names) {
  const out = [];
  for (const n of [...new Set(names.map(courseName))]) {
    const hits = u.courses.filter((c) => c.name === n);
    if (hits.length !== 1) return [];
    out.push(hits[0]);
  }
  return out.sort((a, b) => a.page - b.page);
}

/** « 10-11 » for following pages (a course can cover several pages), « 13, 20 » otherwise. */
function pagesText(courses) {
  const set = new Set();
  courses.forEach((c) => { for (let p = c.page; p <= c.lastPage; p++) set.add(p); });
  const p = [...set].sort((a, b) => a - b);
  if (!p.length) return '';
  if (p.length > 1 && p[p.length - 1] - p[0] === p.length - 1) return `${p[0]}-${p[p.length - 1]}`;
  return p.join(', ');
}

/** The titles of the courses, once each, joined with « / ». */
function titlesText(courses) { return [...new Set(courses.map((c) => c.title).filter(Boolean))].join(' / '); }

module.exports = { unit, guessLevel, courseName, coursesOf, coursesByName, pagesText, titlesText };
