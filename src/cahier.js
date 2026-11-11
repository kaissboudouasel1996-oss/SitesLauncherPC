'use strict';
// Lesson log (cahier de texte). Port of Cahier.kt / Sommaire.kt / CahierData.kt of the Android app.
// Dates are "YYYY-MM-DD" strings; all the arithmetic is done in UTC so that daylight saving never shifts a day.
const fs = require('fs');
const path = require('path');
const BOOKS = require('./data/books.json');
const OBJ = require('./data/objectifs.json');
const { DAYS } = require('./timetable');

// ---------- dates ----------
const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dayIndex = (s) => (toDate(s).getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
const todayIso = () => { const n = new Date(); return iso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))); };
const D_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const M_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function fmtDate(s) {
  const d = toDate(s);
  const day = d.getUTCDate() === 1 ? '1er' : String(d.getUTCDate());
  return `${D_FR[d.getUTCDay()]} ${day} ${M_FR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---------- school days (keep in step with the school calendar) ----------
const START = '2026-10-26';
const off = (name, from, to, estimated = false) => ({ name, from, to: to || from, estimated });
const OFF = [
  off('Première période de vacances intermédiaires', '2026-10-18', '2026-10-25'),
  off('Fête de l’Unité', '2026-10-31'),
  off('Anniversaire de la Marche verte', '2026-11-06'),
  off('Fête de l’Indépendance', '2026-11-18'),
  off('Deuxième période de vacances intermédiaires', '2026-12-06', '2026-12-13'),
  off('Nouvel An (1er janvier)', '2027-01-01'),
  off('Anniversaire de la présentation du Manifeste de l’Indépendance', '2027-01-11'),
  off('Nouvel An amazigh', '2027-01-14'),
  off('Vacances de mi-année scolaire', '2027-01-24', '2027-01-31'),
  off('Aïd al-Fitr', '2027-03-08', '2027-03-10', true),
  off('Troisième période de vacances intermédiaires', '2027-03-21', '2027-03-28'),
  off('Fête du Travail', '2027-05-01'),
  off('Quatrième période de vacances intermédiaires', '2027-05-09', '2027-05-16'),
  off('Aïd al-Adha', '2027-05-16', '2027-05-18', true),
  off('Nouvel An de l’Hégire (1er mouharram)', '2027-06-07', '2027-06-07', true)
];
const BREAK_RE = /vacances/i;
const holiday = (date) => OFF.find((o) => date >= o.from && date <= o.to) || null;
/** The day after the end of the first school break that starts after [after] (null when there is none). */
function resumeAfter(after) {
  const b = OFF.filter((o) => BREAK_RE.test(o.name) && o.from > after).sort((a, c) => (a.from < c.from ? -1 : 1))[0];
  return b ? addDays(b.to, 1) : null;
}

// ---------- the pupil's book ----------
const SEANCES_PER_UNIT = 10, UNITS = 10, SEANCES_PER_PERIOD = 20;
const CONSOLIDATION = 'Consolider les acquis de l’unité didactique : Vocabulaire, structures, actes de parole, fluence, stratégies de lecture,...';
const REVISION = 'Révision de l’évaluation et évaluation';
const KEYS = ['voc1', 'co', 'actes', 'po', 'cg1', 'lf1', 'voc2', 'cg2', 'lf2', 'outils', 'pe', 'tache'];

const bookUnit = (level, n) => (BOOKS[String(level).toUpperCase().replace(/ /g, '')] || []).find((u) => u.number === n) || null;
const defaultObj = (level, unit, key) => { const i = KEYS.indexOf(key); return i < 0 ? '' : ((OBJ[`${level}|${unit}`] || [])[i] || ''); };

const SPECS = [
  { titles: ['Vocabulaire', 'Compréhension de l’oral'], keys: ['voc1', 'co'] },
  { titles: ['Actes de parole', 'Production de l’oral'], keys: ['actes', 'po'] },
  { titles: ['Lecture fluence', 'Compréhension globale'], keys: ['lf1', 'cg1'] },
  { titles: ['Compréhension détaillée'], keys: ['cd1'] },
  { titles: ['Vocabulaire', 'Lecture fluence'], keys: ['voc2', 'lf2'] },
  { titles: ['Compréhension globale', 'Compréhension détaillée'], keys: ['cg2', 'cd2'] },
  { titles: ['Outils de langue'], keys: ['outils'] },
  { titles: ['Production de l’écrit'], keys: ['pe'] },
  { titles: ['Production de l’écrit'], keys: ['pe'] },
  { titles: ['Consolidation'], keys: [] }
];
const SEANCE_COURSES = [[0, 1], [2, 3], [4], [5], [6, 7], [7, 8], [9], [10], [10], [11]];

/** The book page(s) of a séance, every page written out: « 6-7 », « 14-15-16 ». */
function pagesOf(u, seance) {
  if (u.courses.length !== 12) return '';
  const idx = SEANCE_COURSES[seance - 1];
  if (!idx) return '';
  const set = new Set();
  idx.forEach((i) => {
    const c = u.courses[i];
    const last = i === 10 || i === 11 ? Math.max(c.lastPage, c.page + 1) : c.lastPage;
    for (let p = c.page; p <= last; p++) set.add(p);
  });
  const pages = [...set].sort((a, b) => a - b);
  if (!pages.length) return '';
  const together = pages.length > 1 && pages[pages.length - 1] - pages[0] === pages.length - 1;
  return pages.join(together ? '-' : ', ');
}
const pagesLabel = (i) => (/[-,]/.test(i.pages) ? 'Pages : ' : 'Page : ');

// ---------- what the teacher changed ----------
class CahierStore {
  constructor(dir) { this.file = path.join(dir, 'cahier.json'); }
  load() {
    let o = {};
    try { o = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { /* new */ }
    return { days: Object.assign({}, o.days), skipped: new Set(o.skipped || []), manual: Object.assign({}, o.manual) };
  }
  save(st) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ days: st.days, skipped: [...st.skipped], manual: st.manual }), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

// ---------- the lesson log ----------
const CLASS_RE = /(?<!\d)([0-9])[ \t]*(APIC|AC)[ \t]*[-_/.]?[ \t]*(\d{1,2}|[A-Za-z](?![A-Za-z]))?/i;
function parse(cell) {
  const m = CLASS_RE.exec(cell || '');
  if (!m) return null;
  const key = m[1] + 'APIC' + (m[3] || '').toUpperCase();
  const name = (cell.split(/\r?\n/).map((l) => l.trim()).find(Boolean)) || key;
  return { key, name };
}
const levelOf = (key) => (key[0] === '1' ? '1AC' : key[0] === '3' ? '3AC' : null);

/** Why this day has no classes (null when it has): the holiday, or the day marked by the teacher. */
function offReason(st, date) {
  const o = st.days[date];
  if (o === 'on') return null;
  if (o === 'off') return { name: 'Jour sans cours', from: date, to: date, estimated: false };
  return holiday(date);
}
const isOff = (st, date) => !!offReason(st, date);

/** The classes of [date], in the order of the hours. */
function sessions(tt, date) {
  const di = dayIndex(date);
  if (di >= DAYS) return [];
  const out = [];
  tt.periods.forEach((label, p) => {
    const c = parse((tt.cells[di] || [])[p]);
    if (c) out.push({ date, period: p, label, name: c.name, key: c.key, level: levelOf(c.key) });
  });
  return out;
}
const skipKey = (s) => `${s.date}|${s.period}`;

/** Where this class is on this session (séance number n, 0 = first), counting from the first day of classes. */
function position(st, tt, s) {
  if (s.date < START || isOff(st, s.date) || st.skipped.has(skipKey(s))) return null;
  let n = 0; let resume = null; let d = START;
  while (d <= s.date) {
    const di = dayIndex(d);
    if (di < DAYS && !isOff(st, d)) {
      for (let p = 0; p < tt.periods.length; p++) {
        if (d === s.date && p > s.period) break;
        if (st.skipped.has(`${d}|${p}`)) continue;
        const c = parse((tt.cells[di] || [])[p]);
        if (!c || c.key !== s.key) continue;
        if (resume && d >= resume) resume = null;
        const revision = resume !== null;
        if (d === s.date && p === s.period) return { n, revision };
        if (!revision) {
          n++;
          if (n % SEANCES_PER_PERIOD === 0 && n < SEANCES_PER_UNIT * UNITS) resume = resumeAfter(d);
        }
      }
    }
    d = addDays(d, 1);
  }
  return { n, revision: false };
}

function revisionPeriode(level, n) { const u = bookUnit(level, Math.floor(n / SEANCES_PER_UNIT)); return u ? u.periode : Math.floor(n / SEANCES_PER_PERIOD); }

const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const mkey = (level, unit, key) => `${level}|${unit}|${key}`;
function value(st, level, unit, key) {
  const m = st.manual[mkey(level, unit, key)];
  return m !== undefined ? clean(m) : clean(defaultObj(level, unit, key));
}
function setManual(st, level, unit, key, text) {
  const t = String(text || '').trim();
  if (!t) delete st.manual[mkey(level, unit, key)]; else st.manual[mkey(level, unit, key)] = t;
}
const hasManual = (st, level, unit, key) => Object.prototype.hasOwnProperty.call(st.manual, mkey(level, unit, key));

/** The lesson log of séance number n (0 = first) of a class of [level]. Null when the book has no such unit. */
function info(st, level, n) {
  const unit = Math.floor(n / SEANCES_PER_UNIT) + 1;
  const seance = (n % SEANCES_PER_UNIT) + 1;
  const bu = bookUnit(level, unit);
  if (!bu) return null;
  const spec = SPECS[seance - 1];
  const objectifs = [];
  if (!spec.keys.length) objectifs.push({ key: 'fixed', text: CONSOLIDATION, missing: false });
  else {
    const seen = new Set();
    for (const k of spec.keys) {
      const v = value(st, level, unit, k);
      if (v && seen.has(v.toLowerCase())) continue;
      if (v) seen.add(v.toLowerCase());
      objectifs.push({ key: k, text: v, missing: !v });
    }
  }
  let tache = null;
  if (seance === 1) { const t = value(st, level, unit, 'tache') || value(st, level, unit, 'pe'); tache = { key: 'tache', text: t, missing: !t }; }
  return { periode: bu.periode, unit, unitTitle: bu.title, seance, titles: spec.titles.join(' / '), tache, objectifs, pages: pagesOf(bu, seance) };
}

/** Fills the empty objectives with those of a Fiche technique that was just made. Never replaces an existing one. */
function learnFromFiche(st, niveau, unite, seance, objectifs) {
  const first = String(niveau).trim()[0];
  const level = first === '1' ? '1AC' : first === '3' ? '3AC' : null;
  if (!level) return 0;
  const unit = parseInt((/\d+/.exec(unite) || [])[0], 10);
  const sea = parseInt((/\d+/.exec(seance) || [])[0], 10);
  if (!(unit >= 1 && unit <= UNITS) || !(sea >= 1 && sea <= SEANCES_PER_UNIT)) return 0;
  const keys = SPECS[sea - 1].keys;
  const texts = objectifs.map(clean).filter(Boolean);
  if (!keys.length || !texts.length) return 0;
  let pairs;
  if (keys.length === 1) pairs = [[keys[0], texts.join(' ')]];
  else if (texts.length === keys.length) pairs = keys.map((k, i) => [k, texts[i]]);
  else return 0;
  let added = 0;
  for (const [k, v] of pairs) if (!value(st, level, unit, k)) { setManual(st, level, unit, k, v); added++; }
  return added;
}

/** A plain text copy of the lesson log, to paste elsewhere. */
function asText(i) {
  const t = (l) => (l.missing ? '…' : l.text);
  let s = `Période : ${i.periode}\n`;
  if (i.tache) s += `Unité ${i.unit} : ${i.unitTitle}\nTâche finale : ${t(i.tache)}\n`;
  s += `Séance ${i.seance} : ${i.titles}\n${i.objectifs.length > 1 ? 'Objectifs :' : 'Objectif :'}`;
  i.objectifs.forEach((o) => { s += `\n• ${t(o)}`; });
  if (i.pages) s += `\n${pagesLabel(i)}${i.pages}`;
  return s;
}

// What the classroom board shows (Seating plan): the lesson of the day of a class.
const BOARD = { OK: 0, UNKNOWN_CLASS: 1, OFF: 2, NO_CLASS: 3, NOT_HELD: 4, NO_PROGRAM: 5 };
function board(st, tt, className, date) {
  const c = parse(className);
  if (!c) return { kind: BOARD.UNKNOWN_CLASS };
  if (date < START) return { kind: BOARD.NO_CLASS };
  if (isOff(st, date)) return { kind: BOARD.OFF };
  const slots = sessions(tt, date).filter((s) => s.key === c.key);
  if (!slots.length) return { kind: BOARD.NO_CLASS };
  let held = false;
  for (const s of slots) {
    if (st.skipped.has(skipKey(s))) continue;
    held = true;
    if (!s.level) continue;
    const pos = position(st, tt, s);
    if (!pos) continue;
    if (pos.revision) return { kind: BOARD.OK, hour: s.label, text: `Période : ${revisionPeriode(s.level, pos.n)}\n${REVISION}` };
    const entry = info(st, s.level, pos.n);
    if (!entry) continue;
    return { kind: BOARD.OK, hour: s.label, text: asText(entry) };
  }
  return { kind: held ? BOARD.NO_PROGRAM : BOARD.NOT_HELD };
}

/** The text written on the board of the seating plan. */
function boardText(st, tt, className, date) {
  const b = board(st, tt, className, date);
  switch (b.kind) {
    case BOARD.OK: return `${className}  ·  ${b.hour}\n${b.text}`;
    case BOARD.UNKNOWN_CLASS: return `${className}\nLe nom de la classe doit ressembler à 1APIC3 pour retrouver son cours.`;
    case BOARD.OFF: return `${className}\nJour sans cours`;
    case BOARD.NOT_HELD: return `${className}\nSéance non assurée`;
    case BOARD.NO_PROGRAM: return `${className}\nPas de programme pour ce niveau.`;
    default: return `${className}\nPas de cours aujourd’hui.`;
  }
}

// ---------- what the screen shows ----------
function dayView(st, tt, date) {
  const v = { date, label: fmtDate(date), status: 'ok', slots: [] };
  if (date < START) return Object.assign(v, { status: 'before', startLabel: fmtDate(START) });
  const o = offReason(st, date);
  if (o) return Object.assign(v, { status: 'off', off: { name: o.name + (o.estimated ? ' (date estimée)' : ''), marked: st.days[date] === 'off' } });
  const slots = sessions(tt, date);
  v.ttEmpty = !tt.cells.some((r) => r.some((c) => c.trim()));
  slots.forEach((s) => {
    const skipped = st.skipped.has(skipKey(s));
    const pos = position(st, tt, s);
    let sub; let muted = false; let openable = true;
    if (skipped) { sub = 'Séance non assurée'; muted = true; }
    else if (!s.level || !pos) { sub = 'Pas de programme pour ce niveau.'; muted = true; openable = false; }
    else if (pos.revision) sub = REVISION;
    else {
      const i = info(st, s.level, pos.n);
      if (!i) { sub = 'Programme terminé.'; muted = true; openable = false; } else sub = `Unité ${i.unit} · Séance ${i.seance} — ${i.titles}`;
    }
    v.slots.push({ period: s.period, label: s.label, name: s.name, sub, muted, openable, skipped });
  });
  v.restorable = !!holiday(date) && st.days[date] === 'on';
  v.markable = !v.restorable && slots.length > 0;
  return v;
}

function detailView(st, tt, date, period) {
  const s = sessions(tt, date).find((x) => x.period === period);
  if (!s || !s.level) return null;
  const out = { title: `${s.name} · ${s.label}`, date, period, level: s.level, skipped: st.skipped.has(skipKey(s)) };
  if (out.skipped) return out;
  const pos = position(st, tt, s);
  if (!pos) return null;
  if (pos.revision) {
    const periode = revisionPeriode(s.level, pos.n);
    return Object.assign(out, { revision: true, periode, text: REVISION, copyText: `Période : ${periode}\n${REVISION}` });
  }
  const i = info(st, s.level, pos.n);
  if (!i) return null;
  const edit = (l) => Object.assign({}, l, { editable: l.key !== 'fixed', manual: l.key !== 'fixed' && hasManual(st, s.level, i.unit, l.key) });
  return Object.assign(out, {
    revision: false, periode: i.periode, unit: i.unit, unitTitle: i.unitTitle, seance: i.seance, titles: i.titles,
    tache: i.tache ? edit(i.tache) : null, objectifs: i.objectifs.map(edit), objLabel: i.objectifs.length > 1 ? 'Objectifs :' : 'Objectif :',
    pages: i.pages, pagesLabel: i.pages ? pagesLabel(i) : '', copyText: asText(i)
  });
}

module.exports = {
  CahierStore, SchoolDays: { START, OFF, holiday, resumeAfter }, Cahier: { parse, sessions, position, info, board, boardText, asText, offReason, isOff, setManual, value, learnFromFiche, dayView, detailView, BOARD },
  fmtDate, todayIso, addDays, bookUnit, KEYS
};
