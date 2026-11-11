'use strict';
// Turns the slides of a lesson into the content of a "Fiche technique". Port of FicheBuilder.kt (v75).
// Nothing is invented: it all comes from the PPT.

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/’/g, "'").replace(/‘/g, "'");

const Role = { STRUCTURE: 'STRUCTURE', REPERAGE: 'REPERAGE', ORIENT: 'ORIENT', CONTROLE: 'CONTROLE', DEVOIR: 'DEVOIR', CONTENT: 'CONTENT' };

const isBlank = (s) => !s || !s.trim();
const SPLIT_SENT = /(?<=[.!?])\s+/;

function headOf(s) { return norm(!isBlank(s.title) ? s.title : (s.paras[0] || '')); }

function roleOf(s) {
  let h = headOf(s);
  // A short banner can be split in several paragraphs (« Contrôle » / « des devoirs »): read them together.
  if (isBlank(s.title) && s.paras.length >= 2 && s.paras.length <= 3) {
    const j = norm(s.paras.join(' '));
    if (j.length <= 40) h = j;
  }
  // The titles of these slides are plain text boxes, so they are not always the first paragraph.
  const first = [s.title || ''].concat(s.paras.slice(0, 12)).map(norm);
  if (h.includes('structure de la seance') || first.some((t) => t.startsWith('structure de la seance'))) return Role.STRUCTURE;
  // in some decks the same slide (with the times) is called « Pratique pédagogique efficace de la semaine »
  if ((h.includes('pratique pedagogique efficace') || first.some((t) => t.includes('pratique pedagogique efficace'))) &&
    s.paras.some((p) => DUR.test(norm(p)))) return Role.STRUCTURE;
  if (h.includes('reperage') || first.some((t) => t.includes('reperage dans'))) return Role.REPERAGE; // "... dans l'unité didactique", "... dans la semaine"
  if ((h.includes('orientation') && h.includes('didactique')) || first.some((t) => t.includes('orientations didactiques'))) return Role.ORIENT;
  if (h.includes('prochaine seance')) return Role.DEVOIR;
  if (h.includes('checkpoint')) return Role.CONTROLE;
  if (h.includes('devoir') && /controle|correction|verification|corrige/.test(h)) return Role.CONTROLE;
  // a title such as « Travail à la maison » is short; a long sentence that merely mentions the homework is normal content
  if ((h.includes('a la maison') || h.includes('devoir')) && h.length <= 50) return Role.DEVOIR;
  return Role.CONTENT;
}

function isRealStructure(s) {
  const first = [s.title || ''].concat(s.paras.slice(0, 12)).map(norm);
  return headOf(s).includes('structure de la seance') || first.some((t) => t.startsWith('structure de la seance'));
}

/** Hidden slides are skipped, except the "reference" slides (final task, objectives, structure with the times). */
function usable(deck) {
  return deck.slides.map((s) => [s, roleOf(s)])
    .filter(([s, r]) => !s.hidden || r === Role.REPERAGE || r === Role.ORIENT || r === Role.STRUCTURE);
}

// ---------- components ----------

const COMPS = [
  { name: 'Compréhension de l’oral', re: /comprehension (?:de l'? ?)?(?:oral|orale)/ },
  { name: 'Production de l’oral', re: /production (?:de l'? ?)?(?:oral|orale)/ },
  { name: 'Actes de parole', re: /actes? de parole/ },
  { name: 'Vocabulaire', re: /vocabulaire/ },
  { name: 'Lecture fluence', re: /fluence/ },
  { name: 'Compréhension globale', re: /comprehension globale/ },
  { name: 'Compréhension détaillée', re: /comprehension detaillee/ },
  { name: 'Outils de langue', re: /outils? de langue/ },
  { name: 'Production de l’écrit', re: /(?:production (?:de l'? ?)?(?:ecrit|ecrite)|preparation de la tache)\s*(\d)?/ },
  { name: 'Consolidation', re: /consolidation/ }
];

/** The component named in a text (already normalised), or null. The earliest one wins. */
function componentIn(n) {
  let bestPos = Infinity, bestName = null;
  for (const c of COMPS) {
    const m = c.re.exec(n);
    if (!m) continue;
    if (m.index < bestPos) {
      bestPos = m.index;
      const digit = m.length > 1 && m[1] ? m[1] : '';
      bestName = digit ? c.name + ' ' + digit : c.name;
    }
  }
  return bestName;
}

function componentOf(s) {
  const t = !isBlank(s.title) ? componentIn(norm(s.title)) : null;
  if (t) return t;
  for (const p of s.paras.slice(0, 2)) {
    const c = componentIn(norm(p));
    if (c) return c;
  }
  return null;
}

// ---------- small text helpers ----------

const BULLETS = new Set(['•', '-', '–', '—', '▪', '●', '*', ' ', '\u00a0', '✓', '➢', '►']);
function trimStartBullets(s) { let i = 0; while (i < s.length && BULLETS.has(s[i])) i++; return s.slice(i); }
const clean = (s) => trimStartBullets(s.replace(/\s+/g, ' ').trim()).trim();
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const trimEndChars = (s, chars) => { let e = s.length; while (e > 0 && chars.includes(s[e - 1])) e--; return s.slice(0, e); };
const trimStartChars = (s, chars) => { let b = 0; while (b < s.length && chars.includes(s[b])) b++; return s.slice(b); };
const startsWithVowel = (s) => { const c = norm(s)[0]; return !!c && 'aeiouyh'.includes(c); };

const SENTENCE_END = /(?<![pP])(?<!\d)[.!?;](?:\s|$)/;
const ACTIVITE = /activit[ée]s?\s*(?:n\s*[°º]|no\.?|num[ée]ro)?\s*(\d+)/i;
const PAGE = /(?:pages?|p\.)\s*(\d+(?:\s*[-–]\s*\d+)?)/i;

/** One line if possible. Keeps the activity number and page when the text is cut. */
function shorten(s0, max = 125) {
  const s = clean(s0);
  if (s.length <= max) return s;
  const m = SENTENCE_END.exec(s);
  if (m && m.index >= 15 && m.index < max) return s.slice(0, m.index + 1);
  let cut = s.lastIndexOf(' ', max);
  const comma = s.lastIndexOf(',', max);
  if (comma > max / 2) cut = comma;
  if (cut < 20) cut = max;
  return trimEndChars(s.slice(0, cut), ',; :') + '.';
}

const withEnd = (s) => (!s || '.!?)»'.includes(s[s.length - 1]) ? s : s + '.');

const INFINITIVES = new Set([
  'lire', 'demander', 'accorder', 'montrer', 'rappeler', 'indiquer', 'expliquer', 'présenter', 'annoncer',
  'faire', 'écrire', 'corriger', 'écouter', 'observer', 'repérer', 'relever', 'identifier', 'associer',
  'relier', 'compléter', 'répondre', 'choisir', 'classer', 'reformuler', 'justifier', 'ordonner', 'proposer',
  'rédiger', 'produire', 'utiliser', 'employer', 'réviser', 'vérifier', 'souligner', 'entourer', 'cocher',
  'noter', 'copier', 'dire', 'nommer', 'décrire', 'comparer', 'compter', 'chercher', 'trouver', 'découvrir',
  'retrouver', 'remplir', 'travailler', 'mettre', 'former', 'inviter', 'guider', 'amener', 'inciter',
  'donner', 'distribuer', 'afficher', 'projeter', 'accompagner', 'lancer', 'laisser', 'déclarer',
  'pratiquer', 'réaliser', 'préparer', 'effectuer', 'créer', 'imaginer', 'reconnaître', 'sélectionner',
  'exiger', 'revenir', 'insister', 'encourager', 'accorder'
].map(norm));

const IRREGULAR = {
  lisez: 'lire', ecrivez: 'écrire', repondez: 'répondre', prenez: 'prendre', mettez: 'mettre', voyez: 'voir',
  venez: 'venir', suivez: 'suivre', reconnaissez: 'reconnaître', decrivez: 'décrire', dites: 'dire', faites: 'faire'
};

/** An instruction from the slide, put in the infinitive ("Lisez" becomes "Lire"). Null if it is not an instruction. */
const LEAD = /^(?:maintenant|ensuite|puis|enfin|alors|mais|donc|d['’]abord|avant de commencer(?:\s+(?:le|la|ce|cette)\s+\p{L}+)?|apr[eè]s)\s*[,:]?\s*/iu;

function actionize(t0) {
  let t = clean(t0);
  for (let k = 0; k < 3; k++) {
    const m = LEAD.exec(t);
    if (!m || !m[0]) break;
    t = t.slice(m[0].length);
  }
  if (t.length < 4) return null;
  const fm = /^[\p{L}’']+/u.exec(t);
  if (!fm) return null;
  const first = fm[0];
  const fn = norm(first);
  if (INFINITIVES.has(fn)) return capFirst(t);
  if (Object.prototype.hasOwnProperty.call(IRREGULAR, fn)) return capFirst(IRREGULAR[fn] + t.slice(first.length));
  if (fn.endsWith('ez') && fn.length >= 5) {
    const inf = fn.endsWith('issez') ? first.slice(0, -5) + 'ir' : first.slice(0, -2) + 'er';
    return capFirst(inf + t.slice(first.length));
  }
  // « Résume le texte », « Relève les mots »: the same spelling as « je », followed by an article
  const tu = FIRST_PERSON[first.toLowerCase()];
  if (tu && TU_NEXT.test(norm(t.slice(first.length)))) return capFirst(tu + t.slice(first.length));
  return null;
}

const TU_NEXT = /^\s+(?:l'|(?:le|la|les|un|une|des|ton|ta|tes|ce|cette|ces|chaque|en|dans|au|aux|par|sur|tous|toutes|quelques)\b)/;

/** Like actionize, but also looks at the start of each later sentence ("Nous passons à un exercice. Cochez ..."). */
function actionizeAny(t) {
  const a = actionize(t);
  if (a) return a;
  const sentences = clean(t).split(SPLIT_SENT);
  for (let k = 1; k < sentences.length; k++) {
    const r = actionize(sentences[k]);
    if (r) return r;
  }
  // a capital letter in the middle of a sentence: « …c’est la lettre Observez le texte et répondez… »
  for (const sent of sentences) {
    const m = /\s([A-ZÉÈÀ]\p{L}+ez)(?![\p{L}\d_])/u.exec(sent);
    if (!m) continue;
    if (NOT_IMPERATIVE.has(norm(m[1]))) continue;
    const r = actionize(sent.slice(m.index + 1));
    if (r) return r;
  }
  return null;
}

function isNoise(t) {
  const n = norm(clean(t));
  if (n.length <= 3) return true;
  if (n.includes('⏱') || /^(je fais|je dis)$/.test(n)) return true;
  if (/^[\d\s.\-–/]+$/.test(n)) return true;
  if (/^(collectif|collective|en binome|binome|autonome|modelage( \d)?|pratiques? guidees?|duree.*)$/.test(n)) return true;
  return false;
}

/** A slide « Avant de commencer, je me pose une question. » comes right after the objective: it carries the hook question. */
function isHookSlide(s) {
  return [s.title || ''].concat(s.paras).some((t) => norm(clean(t)).includes('je me pose une question'));
}

/** The hook question written on the slide (the sentence that ends with « ? »), or null when there is none. */
function hookQuestion(s) {
  for (const p of s.paras.slice().reverse()) {
    const c = clean(p);
    if (norm(c).includes('je me pose une question')) continue;
    const qs = c.split(SPLIT_SENT).filter((x) => x.trimEnd().endsWith('?'));
    const q = qs.length ? qs[qs.length - 1] : null;
    if (q === null) continue;
    if (q.length > 3) return q.trim();
  }
  return null;
}

/**
 * The speech acts of an « Actes de parole » lesson: the short boxes ending with « … » that sit next to the picture
 * (« Il y a beaucoup de … », « Je vois … »). The « Je retiens » slides and long sentences are not speech acts.
 */
function speechActs(slides) {
  const out = new Map();
  for (const s of slides) {
    if (isObjectiveSlide(s) || isHookSlide(s)) continue;
    if (s.paras.some((p) => norm(clean(p.replace(/\u00A0/g, ' '))).startsWith('je retiens'))) continue;
    for (const p of s.paras) {
      const c = clean(p.replace(/\u00A0/g, ' '));
      if (!(c.endsWith('…') || c.endsWith('...'))) continue;
      if (c.includes(',') || c.includes('+') || c.split(' ').length > 6) continue;
      const core = c.replace(/\s*(?:…|\.\.\.)$/, '').trim();
      if (core.length < 3) continue;
      if (!out.has(norm(core))) out.set(norm(core), core + '…');
    }
  }
  return [...out.values()];
}

// ---------- the same instruction written twice ----------

const SAME_STOP = new Set([
  'demander', 'eleves', 'aux', 'avec', 'dans', 'pour', 'leur', 'leurs', 'cette', 'ces', 'des', 'les', 'une', 'que', 'qui',
  'faire', 'page', 'puis', 'chaque', 'tous', 'toutes', 'quelques', 'comme', 'sont', 'etre', 'apres', 'avant', 'realiser', 'activite'
]);
const SAME_GENERIC = new Set(['image', 'phrase', 'texte', 'mots', 'exerci', 'vignet', 'page']);
const REF_RE = /\(?\s*activites?\s*\d+(?:\s*[,.\-–]*\s*(?:page|p\.?)\s*\d+)?\s*\)?/g;

function lineKey(line) {
  const n = trimStartChars(norm(clean(line)), '-').trim();
  const am = /activites?\s*(\d+)/.exec(n);
  const pm = /(?:page|\bp\.?)\s*(\d+)/.exec(n);
  const body = n.replace(REF_RE, ' ');
  const stems = new Set((body.match(/[a-z]+/g) || []).filter((w) => w.length > 3 && !SAME_STOP.has(w)).map((w) => w.slice(0, 6)));
  return { stems, activity: am ? am[1] : null, page: pm ? pm[1] : null };
}

const refScore = (k) => (k.activity !== null ? 1 : 0) + (k.page !== null ? 1 : 0);

/**
 * Two lines say the same thing only when the second adds nothing to the first. Lines of different activities or
 * different pages never merge, and neither do lines that differ by a detail (« à la Médina de Fès » / « dans une boulangerie »).
 */
function sameThing(a, b) {
  if (!a.stems.size || !b.stems.size) return false;
  if (a.activity !== null && b.activity !== null && a.activity !== b.activity) return false;
  if (a.page !== null && b.page !== null && a.page !== b.page) return false;
  const common = [...a.stems].filter((x) => b.stems.has(x));
  const small = a.stems.size <= b.stems.size ? a.stems : b.stems;
  // A: one line is entirely contained in the other
  if (small.size >= 2 && common.length === small.size) return true;
  // B: same activity, and one line is a short echo that has no page (« Comprendre la situation (Activité 1) »)
  if (a.activity !== null && a.activity === b.activity && (a.page === null) !== (b.page === null)) {
    const echo = a.page === null ? a : b;
    if (echo.stems.size <= 4 && common.some((x) => !SAME_GENERIC.has(x))) return true;
  }
  return false;
}

/** Repeated lines are written once: the one that keeps the activity number and the page wins. onMerge gets (dropped, kept). */
function dedupeLines(lines, onMerge = () => {}) {
  const kept = []; const keys = [];
  for (const l of [...new Set(lines)]) {
    const k = lineKey(l);
    const i = keys.findIndex((x) => sameThing(x, k));
    if (i < 0) { kept.push(l); keys.push(k); }
    else if (refScore(k) > refScore(keys[i])) { onMerge(kept[i], l); kept[i] = l; keys[i] = k; }
    else onMerge(l, kept[i]);
  }
  return kept;
}

function isObjectiveSlide(s) {
  return s.paras.some((p) => { const n = norm(p); return n.includes('objectif de la seance') || n.includes("voici l'objectif") || n.includes('serez capables de'); });
}

/**
 * The banner of the objective is sometimes cut in several text boxes (« Regrouper le vocabulaire par thème » /
 * « pour déduire » / « l’idée générale… »): the pieces that continue the sentence are joined to its first piece.
 */
function joinBanner(s, firstIdx, first) {
  let text = clean(first);
  const end = /[.!?…]$/;
  if (end.test(text)) return text;
  let added = 0;
  for (let j = firstIdx + 1; j < s.paras.length; j++) {
    const c = clean(s.paras[j]);
    if (c.length < 3 || isNoise(c) || !(c[0] === c[0].toLowerCase() && c[0] !== c[0].toUpperCase())) continue;
    text = text + ' ' + c;
    added++;
    if (end.test(c) || added >= 3) break;
  }
  return text;
}

function objectiveBanner(s) {
  const cap = s.paras.findIndex((p) => norm(p).includes('serez capables de'));
  if (cap >= 0) {
    const nc = norm(s.paras[cap]);
    const at = nc.indexOf('serez capables de');
    const after = trimEndChars(trimStartChars(nc.slice(at + 'serez capables de'.length).trim(), ' :'), ' :');
    if (after.length > 3) { const raw = s.paras[cap]; return clean(raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : ''); }
    for (let j = cap + 1; j < s.paras.length; j++) if (!isNoise(s.paras[j])) return joinBanner(s, j, s.paras[j]);
  }
  const k = s.paras.findIndex((p) => norm(p).includes('objectif de la seance'));
  if (k >= 0) {
    let j = k - 1;
    while (j >= 0 && /^image\s*\d*$/.test(norm(clean(s.paras[j])))) j--;
    if (j >= 0 && !isNoise(s.paras[j])) return joinBanner(s, j, s.paras[j]);
  }
  for (let i = 0; i < s.paras.length; i++) {
    const p = s.paras[i];
    if (norm(clean(p)).startsWith('objectif')) {
      const after = (p.includes(':') ? p.slice(p.indexOf(':') + 1) : '').trim();
      if (after.length > 3) return clean(after);
      const next = s.paras[i + 1];
      if (next !== undefined && !isNoise(next)) return joinBanner(s, i + 1, next);
    }
  }
  return null;
}

const slideText = (s) => [s.title || ''].concat(s.paras, s.notes || []).join('\n');

/** "(Activité 2, page 46)" when the slide gives them. */
function reference(s) {
  const all = slideText(s);
  const am = ACTIVITE.exec(all);
  // the page that follows « activité N » is the page of that activity (« relisez le texte p. 10, puis l’activité 1, p. 12 »)
  let pm = null;
  if (am) { const re = new RegExp(PAGE.source, 'gi'); re.lastIndex = am.index + am[0].length - 1; pm = re.exec(all); }
  if (!pm) pm = PAGE.exec(all);
  return [am ? am[1] : null, pm ? pm[1].replace(/\s+/g, '') : null];
}

function refText(act, page) {
  const parts = [];
  if (act !== null && act !== undefined) parts.push('Activité ' + act);
  if (page !== null && page !== undefined) parts.push('page ' + page);
  return parts.length ? parts.join(', ') : null;
}

// ---------- objectives of each séance, from the "Repérage dans l’unité didactique" slides ----------

const COMP_ALTS = '(?:' + COMPS.map((c) => '(?:' + (c.re.source === 'fluence' ? '(?:lecture\\s+)?fluence' : c.re.source) + ')').join('|') + ')';
const LABEL_COLON = new RegExp(COMP_ALTS + '\\s*:', 'g');
const LABEL_START = new RegExp('^' + COMP_ALTS + '(?:\\s+et\\s+(?:detaillee|globale|oral|orale|ecrit|ecrite))?\\s*[:\\-–]?\\s*');
const SEANCE_LABEL = /^s[ée]ance\s*(\d+)\s*$/;

const baseName = (n) => n.replace(/\s*\d$/, '');

function tidyEnd(t) {
  const x = t.trim();
  return x.endsWith('..') && !x.endsWith('...') ? trimEndChars(x, '.') + '.' : x;
}

/** Splits one paragraph ("Vocabulaire : ... Lecture fluence : ...") into entries. */
function addRepEntries(c, t) {
  const n = norm(t);
  const starts = n.length === t.length ? [...n.matchAll(LABEL_COLON)].map((m) => m.index) : [];
  if (!starts.length) {
    if (isNoise(t)) return;
    const last = c.length ? c[c.length - 1] : null;
    const ended = last !== null && /[.!?…]\s*$/.test(last.text);
    if (last !== null && !ended) { last.text = tidyEnd((last.text + ' ' + t).trim()); return; }
    // a new objective, with or without its component name (no colon)
    const m = n.length === t.length ? LABEL_START.exec(n) : null;
    if (m && m[0]) {
      const rest = t.slice(m[0].length).trim();
      if (rest.length > 3) {
        const prefix = n.slice(0, m[0].length);
        const first = componentIn(prefix);
        c.push({ comp: first, text: tidyEnd(rest) });
        // « Compréhension globale et détaillée : … »: the same objective is the one of both components
        if (first !== null && /\bet\s+(?:detaillee|globale)/.test(prefix)) {
          const b = baseName(first);
          const other = b === 'Compréhension globale' ? 'Compréhension détaillée' : b === 'Compréhension détaillée' ? 'Compréhension globale' : null;
          if (other !== null) c.push({ comp: other, text: tidyEnd(rest) });
        }
      }
      return;
    }
    c.push({ comp: null, text: tidyEnd(t) });
    return;
  }
  if (starts[0] > 0) {
    const last = c.length ? c[c.length - 1] : null;
    const pre = t.slice(0, starts[0]).trim();
    if (last !== null && pre.length > 3) last.text = tidyEnd((last.text + ' ' + pre).trim());
  }
  starts.forEach((st, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : t.length;
    const seg = t.slice(st, end);
    const ci = seg.indexOf(':');
    const label = ci < 0 ? seg : seg.slice(0, ci);
    const body = ci < 0 ? '' : seg.slice(ci + 1).trim();
    c.push({ comp: componentIn(norm(label)), text: tidyEnd(body) });
  });
}

/**
 * séance number -> its objectives. On these slides every séance is a "SÉANCE n" label with a text box
 * beside it; the boxes are not stored in reading order, so each text is matched to the label on
 * the same row (by vertical position).
 */
function reperage(list) {
  const out = new Map();
  for (const [s, role] of list) {
    if (role !== Role.REPERAGE) continue;
    const labels = []; const texts = [];
    s.paras.forEach((p, i) => {
      const t = clean(p); const n = norm(t);
      const y = s.ys && s.ys[i] !== undefined ? s.ys[i] : -1;
      const lab = SEANCE_LABEL.exec(n);
      if (lab) { labels.push({ no: parseInt(lab[1], 10), idx: i, y }); return; }
      if (n.startsWith('semaine') || n.startsWith('fin de l') || n.includes('reperage dans') || n.length <= 3) return;
      texts.push({ idx: i, text: t, y });
    });
    if (!labels.length) continue;
    const groups = new Map();
    labels.forEach((l) => { if (!groups.has(l.no)) groups.set(l.no, []); });
    const byPos = labels.every((l) => l.y >= 0) && texts.every((t) => t.y >= 0);
    if (byPos) {
      for (const t of texts) {
        let lab = null;
        for (const l of labels) if (!lab || Math.abs(l.y - t.y) < Math.abs(lab.y - t.y)) lab = l;
        if (lab) groups.get(lab.no).push(t);
      }
      groups.forEach((g) => g.sort((a, b) => (a.y - b.y) || (a.idx - b.idx)));
    } else {
      // no positions: a text belongs to the label written just before it
      for (const t of texts) {
        let lab = null;
        for (const l of labels) if (l.idx < t.idx) lab = l;
        if (lab) groups.get(lab.no).push(t);
      }
    }
    for (const [no, items] of groups) {
      if (!out.has(no)) out.set(no, []);
      for (const t of items) addRepEntries(out.get(no), t.text);
    }
  }
  return out;
}

// ---------- the sections of the session: Ouverture / one per component / Clôture ----------

const OPEN_RE = /^(?:ouverture|accueil|introduction|mise en route|rituels?)(?: de la seance)?$/;
const CLOSE_RE = /^(?:cloture|conclusion|bilan|fermeture)(?: de la seance)?$/;
const PURE_DUR = /^(?:duree\s*:?\s*)?[\d:. ]+\s*(?:min\w*|mn)?$/;

/** A section title slide: a few words (the name, usually with its time such as "20:00 min"). */
function markerOf(s) {
  // « Image 3 » texts and the clock symbol are not part of the title
  const ps = s.paras.map(clean).filter((x) => x && !/^image\s*\d*$/.test(norm(x)));
  const isDur = (t) => PURE_DUR.test(norm(t).replace(/^[^\p{L}\d]+/u, ''));
  if (!ps.length || ps.length > 4) return null;
  const label = ps.find((x) => !isDur(x));
  if (label === undefined) return null;
  const n = trimEndChars(norm(label), '.: ');
  if (OPEN_RE.test(n)) return ['open', null];
  if (CLOSE_RE.test(n)) return ['close', null];
  const comp = componentIn(n);
  if (comp && n.split(' ').length <= 6 && (ps.length <= 2 || ps.some(isDur))) return ['comp', comp];
  return null;
}

/** The slide with the picture, the name of the activity and its time: it only marks the start of the modelage. */
const isStart = (s) => { const m = markerOf(s); return !!m && m[0] === 'comp'; };

function sectionsOf(list) {
  const out = [];
  let cur = null;
  for (const [s, role] of list) {
    if (role === Role.STRUCTURE || role === Role.REPERAGE || role === Role.ORIENT) continue;
    const mk = markerOf(s);
    if (mk) { cur = { kind: mk[0], name: mk[1], marker: s, slides: [] }; out.push(cur); continue; }
    if (cur) cur.slides.push([s, role]);
  }
  return out;
}

// ---------- detection of the header fields ----------

function detect(deck) {
  const list = usable(deck);
  const allParas = []; // [slide, role, text]
  for (const [s, role] of list) for (const p of s.paras) allParas.push([s, role, p]);
  const file = deck.fileName || '';

  // Level
  const levelRe = /\b([123])\s*(?:ere|ère|eme|ème|e)?\s*A\.?\s?C\b/i;
  let niveau = '';
  for (const t of [file].concat(allParas.map((x) => x[2]))) {
    const m = levelRe.exec(t);
    if (m) { niveau = m[1] + 'AC'; break; }
  }

  // Unit
  const unitRe = /unit[ée]\s*(\d+)\s*[:\-–—.]?\s*(.*)/i;
  let unite = ''; let uniteTitre = '';
  outer: for (const [s] of list) {
    for (let i = 0; i < s.paras.length; i++) {
      const m = unitRe.exec(s.paras[i]);
      if (!m) continue;
      unite = m[1];
      uniteTitre = clean(m[2]);
      if (!uniteTitre) {
        const next = s.paras[i + 1];
        if (next !== undefined && next.length <= 70) uniteTitre = clean(next);
      }
      break outer;
    }
  }
  if (!unite) { const m = /UD\s*(\d+)/i.exec(file); unite = m ? m[1] : ''; }
  // The first slide shows the unit title (before "Séance", "Période", the level...)
  if (!uniteTitre) {
    const first = list.length ? list[0][0] : null;
    if (first) {
      const stop = /^(?:s[ée]ance|p[ée]riode|semestre|unit[ée]|fran[cç]ais|coll[eè]ge|dur[ée]e|ann[ée]e|prof|enseignant|[123]\s*(?:ere|ère|eme|ème|e)?\s*A\.?\s?C)\b/i;
      const parts = [];
      for (const p of first.paras) {
        const c = clean(p);
        if (!c) continue;
        const skipIt = stop.test(c) || componentIn(norm(c)) !== null || isNoise(c) || norm(c).startsWith('image') || c.length > 60;
        if (skipIt) { if (parts.length) break; else continue; }
        parts.push(c);
        if (parts.length >= 3) break;
      }
      if (parts.length) uniteTitre = parts.join(' ');
    }
  }
  // Last resort: the file name (« 3AC_UD1Voyages_S4.pptx » -> « Voyages »)
  if (!uniteTitre) {
    const dot = file.lastIndexOf('.');
    const base = dot >= 0 ? file.slice(0, dot) : file;
    const m = /UD\s*\d+[\s_\-:.]*([\p{L}][\p{L}\s'’]*)/iu.exec(base);
    const t = m ? m[1].replace(/_/g, ' ').replace(/\s*\bs\d*\s*$/i, '').replace(/\s+/g, ' ').trim() : '';
    if (t.length >= 3) uniteTitre = capFirst(t);
  }

  // Session number
  const seanceRe = /s[ée]ance\s*(?:n°|no|n)?\s*[:.]?\s*(\d+)/i;
  let seance = '';
  for (const [, role, t] of allParas) {
    if (role === Role.REPERAGE || role === Role.ORIENT) continue;
    const m = seanceRe.exec(t);
    if (m) { seance = m[1]; break; }
  }
  if (!seance) { const m = /(?:^|[^a-z])s(\d{1,2})(?![0-9])/i.exec(file); seance = m ? m[1] : ''; }

  // Semester
  let semestre = '1';
  for (const [, , t] of allParas) {
    const m = /semestre\s*(\d)/i.exec(t);
    if (m) { semestre = m[1]; break; }
  }

  // Final task: from the "repérage" slides
  let tache = '';
  const firstContent = list.findIndex(([s]) => markerOf(s) !== null);
  const beginning = firstContent > 0 ? list.slice(0, firstContent) : list;
  outer2: for (const [s] of beginning) {
    for (let i = 0; i < s.paras.length; i++) {
      const p = s.paras[i];
      if (!norm(p).includes('tache finale')) continue;
      const ci = p.indexOf(':');
      const after = ci < 0 ? '' : p.slice(ci + 1).trim();
      tache = after.length > 5 ? clean(after) : clean(s.paras[i + 1] || '');
      if (!tache) continue;
      tache = withEnd(capFirst(tache));
      break outer2;
    }
  }

  // Objectives of this séance: from the "repérage" slides (one box per séance)
  const rep = reperage(list);
  const objectifs = [];
  const sn = /^\d+$/.test(seance) ? parseInt(seance, 10) : -1;
  for (const e of rep.get(sn) || []) {
    const t = clean(e.text);
    if (t.length > 3 && !objectifs.includes(withEnd(capFirst(t)))) objectifs.push(withEnd(capFirst(t)));
  }
  const repKeys = [...rep.keys()].sort((a, b) => a - b);

  // Final task not written anywhere: take the objective of the first "Production de l’écrit"
  if (!tache) {
    for (const k of repKeys) {
      const e = rep.get(k).find((x) => x.comp !== null && baseName(x.comp) === 'Production de l’écrit' && clean(x.text).length > 3);
      if (e) { tache = withEnd(capFirst(shorten(clean(e.text)))); break; }
    }
    if (!tache) {
      for (const k of repKeys) {
        const e = rep.get(k).find((x) => norm(clean(x.text)).startsWith('rediger'));
        if (e) { tache = withEnd(capFirst(shorten(clean(e.text)))); break; }
      }
    }
  }

  // Otherwise the objectives from the "orientations didactiques" slide
  if (!objectifs.length) {
    for (const [s, role] of list) {
      if (role !== Role.ORIENT) continue;
      for (const p of s.paras) {
        if (p === s.title) continue;
        const c = clean(p);
        const n = norm(c);
        if (/^objectifs?\s*:?$/.test(n)) continue;
        if (n.includes('orientation') && n.includes('didactique')) continue;
        if (isNoise(c)) continue;
        if (!(n.startsWith('objectif') && c.includes(':'))) continue;
        const body = clean(c.slice(c.indexOf(':') + 1));
        if (body.length > 3) objectifs.push(withEnd(capFirst(body)));
      }
    }
  }

  // The « Sommaire » of the book (1AC or 3AC): semester, unit title, and the title and page(s) of this séance.
  // When the book or the unit is not known, or the PowerPoint does not follow the book, these stay empty.
  let titre = ''; let pages = ''; let periode = '';
  // The level (1AC / 3AC) comes from the PowerPoint; when it does not say it, the unit and its title tell it.
  if (!niveau && /^\d+$/.test(unite)) { const g = Sommaire.guessLevel(parseInt(unite, 10), uniteTitre); if (g) niveau = g; }
  const su = /^\d+$/.test(unite) ? Sommaire.unit(niveau, parseInt(unite, 10)) : null;
  if (su) {
    semestre = su.semestre;
    periode = String(su.periode);
    if (!uniteTitre) uniteTitre = su.title;
    if (/^\d+$/.test(seance)) {
      const seq = [];
      for (const k of repKeys) for (const e of rep.get(k)) if (e.comp) seq.push([k, Sommaire.courseName(baseName(e.comp))]);
      let cs = Sommaire.coursesOf(su, seq, parseInt(seance, 10));
      if (!cs.length) {
        const names = sectionsOf(list).filter((x) => x.kind === 'comp').map((x) => x.name).filter((x) => x);
        cs = Sommaire.coursesByName(su, names);
      }
      titre = Sommaire.titlesText(cs);
      pages = Sommaire.pagesText(cs);
    }
  }

  return { niveau, semestre, seance, unite, uniteTitre, tache, titre, objectifs: objectifs.slice(0, 8), pages, periode };
}

// ---------- durations ----------

/** "5 min", "5:00 min", "20:00" (minutes:seconds). */
const DUR = /(\d{1,3})(?:\s*[:.h]\s*(\d{2}))?\s*(?:minutes?|min|mn)\b|\b(\d{1,2})\s*:\s*(\d{2})\b/;

const durMinutes = (m) => { const v = m[1] || m[3]; return v && /^\d+$/.test(v) ? parseInt(v, 10) : null; };

function parseDurations(structure) {
  const out = [];
  for (const s of structure) {
    const ps = s.paras;
    for (let i = 0; i < ps.length; i++) {
      const n = norm(ps[i]);
      const m = DUR.exec(n);
      if (!m) continue;
      const minutes = durMinutes(m);
      if (minutes === null) continue;
      let label = n.slice(0, m.index);
      if (!/\p{L}/u.test(label)) {
        let j = i - 1;
        while (j >= 0 && j >= i - 4) {
          const c = norm(ps[j]);
          if (/\p{L}/u.test(c) && !DUR.test(c)) { label = c; break; }
          j--;
        }
      }
      let kind;
      if (/ouverture|accueil|introduction|mise en route|rituel/.test(label)) kind = 'open';
      else if (/cloture|conclusion|bilan|fermeture/.test(label)) kind = 'close';
      else { const c = componentIn(label); kind = c ? 'comp:' + c : 'other'; }
      out.push({ kind, minutes });
    }
  }
  return out;
}

// ---------- the work mode of a slide ----------

function modeFromText(s) {
  const n = norm(slideText(s));
  if (/en binome|binome|par deux|en duo/.test(n)) return 'B';
  if (/autonome|autonomie|individuel|\bseule?s?\b/.test(n)) return 'A';
  if (/collectif|collective|collectivement/.test(n)) return 'C';
  return null;
}

const modeLabel = (m) => (m === 'C' ? 'Collective :' : m === 'B' ? 'En binôme :' : 'Autonome :');

// ---------- objectives per component ----------

function hintFor(name) {
  if (name.startsWith('Production de l’écrit')) return /ecri|redig|produire|paragraphe|article|texte/;
  switch (name) {
    case 'Vocabulaire': return /vocabulaire|mots|expressions|lexique/;
    case 'Compréhension de l’oral': return /oral|ecout|entend|sonore/;
    case 'Production de l’oral': return /oral|parler|presenter|raconter|dialogue|prendre la parole/;
    case 'Lecture fluence': return /haute voix|fluence|rythme|lire/;
    case 'Compréhension globale': return /global|idee generale|theme|hypothese|indices/;
    case 'Compréhension détaillée': return /detail|informations?|relever|identifier|justifier/;
    case 'Outils de langue': return /grammaire|conjug|accord|temps|pronom|outil|utiliser|employer|phrase/;
    case 'Actes de parole': return /exprimer|demander|donner|proposer|inviter|decrire|acte/;
    case 'Consolidation': return /consolid|reinvest|reviser|integrer|mobiliser/;
    default: return null;
  }
}

/** The notes begin with « Modelage : » or « Modelage (penser à voix haute) : » — the fiche starts directly with the verb. */
function stripModelage(t) {
  const c = clean(t);
  const m = /^modelage\s*(?:\([^)]*\))?\s*[:：]?\s*/i.exec(c);
  if (!m) return t;
  const rest = c.slice(m[0].length).trim();
  return rest.length < 3 ? t : capFirst(rest);
}

/**
 * The title of the exercise written on the slide itself (« Je comprends la situation de communication. »),
 * not the instruction of the banner at the top. Null when the slide has none.
 */
function stepHeading(s) {
  const ps = s.paras.map(clean);
  const skip = /activite|\bpage\b|\bp\.|tous ensemble|binome|autonom|individuel|collectif|verifions|corrigeons|^image/;
  const ok = (t) => {
    const n = norm(t);
    return t.length >= 10 && t.length <= 110 && !t.endsWith('?') && !t.includes('…') && !t.includes('..') && !skip.test(n) && /^(?:je\s|j')/.test(n);
  };
  let found = null;
  for (let i = 1; i < ps.length; i++) { // a bare number (1, 2, 3) comes right before the title of the exercise
    if (/^\d{1,2}$/.test(ps[i - 1]) && ok(ps[i])) { found = ps[i]; break; }
  }
  if (found === null) {
    for (let i = 1; i < ps.length; i++) { // paragraph 0 is the banner; a title without number ends with « : »
      if (ps[i].endsWith(':') && ok(ps[i])) { found = ps[i]; break; }
    }
  }
  if (found === null) return null;
  return lowerFirst(trimEndChars(found, ':. !'));
}

// ---------- wording of the consignes (vouvoiement -> infinitive, no « ces / suivants ») ----------

const NOT_IMPERATIVE = new Set(['chez', 'assez', 'nez', 'avez', 'devez', 'pouvez', 'voulez', 'savez', 'rez', 'lez']);

// word boundaries that know about accented letters (the Android regex engine does; JS \b does not)
const WB = '(?:(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_])|(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_]))';
const rx = (src, flags = '') => new RegExp(src.replace(/\\b/g, WB), flags.includes('u') ? flags : flags + 'u');

/** « travaillez » -> « travailler », « répondez » -> « répondre »... Null when the word is not an imperative. */
function imperativeToInfinitive(w) {
  const n = norm(w);
  if (n === 'dites' || n === 'faites') return IRREGULAR[n];
  if (n.length < 5 || NOT_IMPERATIVE.has(n) || !n.endsWith('ez')) return null;
  if (Object.prototype.hasOwnProperty.call(IRREGULAR, n)) return IRREGULAR[n];
  const drop = (k) => w.slice(0, w.length - k);
  if (n === 'soyez') return 'être';
  if (n === 'ayez') return 'avoir';
  if (n === 'lisez' || n === 'relisez') return drop(5) + 'lire';
  if (n === 'voyez' || n === 'revoyez') return drop(5) + 'voir';
  if (n === 'venez' || n === 'revenez' || n === 'devenez') return drop(5) + 'venir';
  if (n.endsWith('crivez')) return drop(6) + 'crire';
  if (n.endsWith('ondez')) return drop(5) + 'ondre';
  if (n.endsWith('endez')) return drop(5) + 'endre';
  if (n.endsWith('prenez')) return drop(6) + 'prendre';
  if (n.endsWith('mettez')) return drop(6) + 'mettre';
  if (n.endsWith('naissez')) return drop(7) + 'naître';
  if (n.endsWith('suivez')) return drop(6) + 'suivre';
  if (n.endsWith('duisez')) return drop(4) + 'ire'; // déduisez, produisez, traduisez (the phone writes « déduiser »)
  if (n.endsWith('issez')) return drop(5) + 'ir';
  return drop(2) + 'er';
}

const CLAUSE_START = rx('(^|[.;!?]\\s+|,\\s+|\\bet\\s+|\\bpuis\\s+|\\bensuite\\s+)(\\p{L}+ez|dites|faites)\\b(-(?:le|la|les|y|en)\\b)?', 'gi');

/**
 * Puts a consigne written with « vous » in the infinitive, with a correct meaning: every verb of the sentence
 * (« lisez…, entourez… et répondez… »), « vos » -> « leurs », and no « ces / ce / cette / suivants » (the fiche does
 * not show the phrases or the words). With withDe the verbs that follow the first one get « de » (« Demander de lire…, d’entourer… »).
 */
function polishConsigne(t0, withDe) {
  let t = clean(t0);
  t = t.replace(CLAUSE_START, (all, lead, word, pronPart) => {
    const inf0 = imperativeToInfinitive(word);
    if (!inf0) return all;
    const inf = inf0.toLowerCase();
    const pron = pronPart ? trimStartChars(pronPart, '-') : '';
    const verb = pron ? pron + ' ' + inf : inf;
    const de = (startsWithVowel(verb) ? 'd’' : 'de ') + verb;
    const lt = lead.trimEnd();
    const sentenceEnd = lt.endsWith('.') || lt.endsWith('!') || lt.endsWith('?') || lt.endsWith(';');
    const ll = lead.toLowerCase();
    if (!lead) return capFirst(verb);
    if (sentenceEnd && withDe) return ' et ' + de;
    if (sentenceEnd) return lead + capFirst(verb);
    if (withDe && (lt.endsWith(',') || ll.startsWith('et') || ll.startsWith('puis') || ll.startsWith('ensuite'))) return lead + de;
    return lead + verb;
  });
  if (withDe) t = addDeBeforeInfinitives(t);
  t = t.replace(rx('\\bvos\\b', 'gi'), (m) => (m[0] === m[0].toUpperCase() ? 'Leurs' : 'leurs'));
  t = t.replace(rx('\\bvotre\\b', 'gi'), (m) => (m[0] === m[0].toUpperCase() ? 'Leur' : 'leur'));
  // « les groupes de mots suivants » -> « des groupes de mots », « la phrase suivante » -> « une phrase »
  t = t.replace(rx('\\bles (\\p{L}+(?:\\s+(?:de|d[\'’])\\s*\\p{L}+)?)\\s+suivant(?:e|s|es)?\\b', 'gi'), (m, a) => 'des ' + a);
  t = t.replace(rx('\\bla (\\p{L}+(?:\\s+(?:de|d[\'’])\\s*\\p{L}+)?)\\s+suivante\\b', 'gi'), (m, a) => 'une ' + a);
  t = t.replace(rx('\\ble (\\p{L}+(?:\\s+(?:de|d[\'’])\\s*\\p{L}+)?)\\s+suivant\\b', 'gi'), (m, a) => 'un ' + a);
  t = t.replace(rx('\\s+suivant(?:e|s|es)?\\b', 'gi'), '');
  // ces -> des, ce -> un, cette -> une (and « de ces » -> « des »)
  t = t.replace(rx('\\bde ces\\b', 'gi'), 'des');
  t = t.replace(rx('\\bde (?:ce|cet)\\b(?! (?:qui|que|qu[\'’]))', 'gi'), 'd’un');
  t = t.replace(rx('\\bde cette\\b', 'gi'), 'd’une');
  t = t.replace(rx('\\bces\\b', 'g'), 'des').replace(rx('\\bCes\\b', 'g'), 'Des');
  t = t.replace(rx('\\bcette\\b', 'g'), 'une').replace(rx('\\bCette\\b', 'g'), 'Une');
  t = t.replace(rx('\\b(?:ce|cet)\\b(?! (?:qui|que|qu[\'’]|sont|soit|est))', 'g'), 'un');
  t = t.replace(rx('\\b(?:Ce|Cet)\\b(?! (?:qui|que|qu[\'’]|sont|soit|est))', 'g'), 'Un');
  return t.replace(/\s{2,}/g, ' ').trim();
}

const LATER_INF = rx('(,\\s+|\\bet\\s+|\\bpuis\\s+|\\bensuite\\s+)((?:l[\'’]|le\\s+|la\\s+|les\\s+|se\\s+|s[\'’]|y\\s+|en\\s+)?)(\\p{L}+)\\b', 'gi');

/** « Demander de lire les phrases et souligner… » -> « …et de souligner… »: every infinitive after the first needs its own « de ». */
function addDeBeforeInfinitives(t) {
  return t.replace(LATER_INF, (all, lead, pron, word) => {
    if (!KNOWN_INF.has(norm(word))) return all;
    const de = !pron && startsWithVowel(word) ? 'd’' : 'de ';
    return lead + de + pron + word;
  });
}

/** What the text reader of the phone gets wrong in the book: « ’accord » for « l’accord », « I’accord », « l ’accord »... */
function repairOcr(s) {
  let t = s.replace(/\u00a0/g, ' ').replace(/`/g, '’').replace(/´/g, '’');
  t = t.replace(/(?<![\p{L}\d])[I|1](?=[’'][\p{L}])/gu, 'l');                                    // I’accord, |’accord
  t = t.replace(rx("\\b([lLdDnNmMtTsScC]|[qQ]u)\\s+(?=[’'][\\p{L}])", 'g'), (all, a) => a);       // l ’accord
  t = t.replace(/(^|\s)[’'](?=[aeiouyhàâéèêëîïôöûùAEIOUYHÀÂÉÈ])/gu, (all, a) => a + 'l’');       // ’accord
  return t.replace(/\s{2,}/g, ' ').trim();
}

/** « Je cherche d’abord le nom. Ensuite, j’observe leur ordre. » -> « Chercher d’abord le nom. Ensuite, observer leur ordre. » */
function sentencesToInfinitive(t0) {
  const t = clean(t0);
  const lead = /^((?:maintenant|ensuite|puis|enfin|alors)\s*,?\s*)?(.*)$/i;
  const isJe = /^(?:je\s|j['’])/i;
  const sentences = t.split(SPLIT_SENT);
  if (!sentences.some((s) => { const m = lead.exec(s); return !!m && isJe.test(m[2]); })) return t;
  return sentences.map((sent) => {
    const m = lead.exec(sent);
    const inf = isJe.test(m[2]) ? fromFirstPerson(m[2]) : null;
    if (inf === null) return sent;
    return withEnd(!m[1] ? inf : capFirst(trimEndChars(m[1].trim(), ',')) + ', ' + lowerFirst(inf));
  }).join(' ');
}

// ---------- short consignes (opening, rappel) ----------

const FIRST_PERSON = Object.assign(Object.create(null), {
  'complète': 'compléter', relie: 'relier', souligne: 'souligner', entoure: 'entourer', coche: 'cocher',
  'réponds': 'répondre', associe: 'associer', classe: 'classer', choisis: 'choisir', 'écris': 'écrire',
  cherche: 'chercher', identifie: 'identifier', transforme: 'transformer', justifie: 'justifier', observe: 'observer',
  lis: 'lire', trouve: 'trouver', range: 'ranger', remets: 'remettre', remplis: 'remplir', mets: 'mettre',
  note: 'noter', 'décris': 'décrire', 'repère': 'repérer', 'relève': 'relever', dis: 'dire', donne: 'donner',
  forme: 'former', corrige: 'corriger', 'réécris': 'réécrire', conjugue: 'conjuguer', accorde: 'accorder',
  utilise: 'utiliser', compare: 'comparer', reformule: 'reformuler', ordonne: 'ordonner', 'présente': 'présenter',
  raconte: 'raconter', discute: 'discuter', propose: 'proposer',
  'résume': 'résumer', explique: 'expliquer', imagine: 'imaginer', 'rédige': 'rédiger',
  retrouve: 'retrouver', indique: 'indiquer', 'déduis': 'déduire', regroupe: 'regrouper',
  relis: 'relire', 'écoute': 'écouter', rappelle: 'rappeler', 'précise': 'préciser',
  nomme: 'nommer', essaie: 'essayer', concentre: 'concentrer', 'dégage': 'dégager',
  devine: 'deviner', 'prépare': 'préparer', 'vérifie': 'vérifier', produis: 'produire',
  'réfléchis': 'réfléchir', 'lève': 'lever', pose: 'poser', fais: 'faire'
});

/** « …, et je les corrige » / « …, puis j’écris » / « …, et je l’écris »: the clause that follows the first verb. */
const FP_CLAUSE = /(,|\bet\b|\bpuis\b)\s+(?:je\s+|j['’])(?:(l['’]|m['’])|(le|la|les|me|m|se|y|en)\s+)?(\p{L}+)/giu;

/** Every verb that can follow « de » in a consigne written in the infinitive. */
const KNOWN_INF = new Set(Object.values(FIRST_PERSON).map(norm).concat([...INFINITIVES]));

/** Possessives and verbs of a sentence in the first person (« ma carte », « puis j’écris ») for the infinitive form. */
function genericInfinitive(v) {
  if (v.length < 4 || ['suis', 'vais', 'sais', 'peux', 'veux', 'dois'].includes(v)) return null;
  if (v === 'fais') return 'faire';
  if (v.endsWith('ds')) return v.slice(0, -2) + 'dre';
  if (v.endsWith('is')) return v.slice(0, -1) + 'r';
  if (v.endsWith('e')) return v + 'r';
  return null;
}

/** « Je complète par les marqueurs… » becomes « Compléter par les marqueurs… ». Null when the verb is not known. */
function fromFirstPerson(t) {
  const c = clean(t);
  const m = /^(?:je\s+(me\s+|m['’])|je\s+|j['’])(\p{L}+)(.*)$/iu.exec(c);
  if (!m) return null;
  const reflexive = !!m[1];
  const verb = m[2].toLowerCase();
  const inf = FIRST_PERSON[verb] || genericInfinitive(verb);
  if (!inf) return null;
  let rest = trimEndChars(m[3], ':. ');
  // « …, puis j’écris des phrases » -> « …, puis écrire des phrases »
  // with an object pronoun too: « …, et je les corrige » -> « …, et les corriger »
  rest = rest.replace(FP_CLAUSE, (all, lead, elid, wordRaw, vRaw) => {
    const v = vRaw.toLowerCase();
    const i2 = FIRST_PERSON[v] || genericInfinitive(v);
    if (!i2) return all;
    const elided = (elid || '').toLowerCase();
    const word = (wordRaw || '').toLowerCase();
    let pron;
    if (elided.startsWith('m')) pron = startsWithVowel(i2) ? 's’' : 'se ';
    else if (elided) pron = elided.slice(0, 1) + '’'; // l’ -> l’
    else if (word === 'me' || word === 'm') pron = startsWithVowel(i2) ? 's’' : 'se ';
    else if (word) pron = word + ' ';
    else pron = '';
    return lead + ' ' + pron + i2;
  });
  rest = rest.replace(/\b(?:ma|mon)\b/g, 'leur').replace(/\bmes\b/g, 'leurs');
  const pron = !reflexive ? '' : startsWithVowel(inf) ? 's’' : 'se ';
  return capFirst(pron + inf + rest);
}

/** « …On va désigner quelques uns pour le lire. » becomes « Désigner quelques élèves pour lire le texte ». */
function onVa(c) {
  const m = rx('(?:^|[.!?]\\s+)(?:on va|nous allons)\\s+(\\p{L}+(?:er|ir|re))\\b([^.!?]*)', 'i').exec(c);
  if (!m) return null;
  let rest = m[2];
  const verb = m[1];
  if (['passer', 'commencer', 'voir'].includes(norm(verb))) return null;
  rest = rest.replace(/quelques[- ]?uns?/gi, 'quelques élèves');
  if (norm(c).includes('lire le texte')) rest = rest.replace(/pour le lire/gi, 'pour lire le texte');
  return capFirst(verb + rest).trim();
}

/**
 * The consigne written on the first slides that carry one: an instruction (« Reliez… »), a sentence in the first
 * person (« Je complète… ») or, when allowQuestion, a question. The lines that only announce the correction are skipped.
 */
function consigneOf(slides, allowQuestion = false) {
  const intro = /^(?:passons|nous allons|allons|verifiez|corrigeons|corrigez|correction|voici l'objectif|objectif|bienvenue|bonjour)/;
  const fin = (x) => trimEndChars(shorten(polishConsigne(x, false)), '. :');
  for (const sl of slides) {
    for (const raw of sl.paras) {
      const c = clean(raw); const n = norm(c);
      if (isNoise(c) || c.length < 12 || n.startsWith('image') || intro.test(n)) continue;
      if (/^activite\s*\d+.*/.test(n) && c.length < 30) continue;
      let r = onVa(c); if (r) return fin(r);
      r = actionize(c); if (r) return fin(r);
      r = fromFirstPerson(c); if (r) return fin(r);
      r = fromClause(c); if (r) return fin(r);
      if (allowQuestion && c.trimEnd().endsWith('?')) return 'Poser la question : ' + lowerFirst(c.trimEnd());
    }
  }
  return null;
}

/** The sentence of the « Rappel » banner (« Rappel : pour lire avec expression… »), when the slides have one. */
function rappelOf(slides) {
  for (const sl of slides) {
    for (const raw of sl.paras) {
      const c = clean(raw);
      if (norm(c).startsWith('rappel') && c.length > 14) return withEnd(capFirst(c.replace(/(?<!\.)\.\.(?!\.)/g, '.')));
    }
  }
  return null;
}

// ---------- consignes: how to work, buttons, clauses ----------

/** « Tous ensemble », « Travaillez en binômes », « Travaillez chacun seul » at the end of a consigne: how to work, not what to do. */
const MODE_TAIL = /(?:(?<=[.!?:;])|(?<=\s)|^)(?:tous\s+ensemble|(?:travaillez|travailler)\s+(?:en\s+)?(?:bin[ôo]mes?|autonomie|groupes?|duo|classe\s+enti[èe]re|chacun(?:\s+seul(?:e)?)?|seul(?:e)?s?|ensemble|par\s+deux|[àa]\s+deux|individuellement))[\s:.!;]*$/iu;

/** The text without the « Tous ensemble / Travaillez en binômes » that ends it. */
function stripMode(t) {
  let x = clean(t);
  for (let k = 0; k < 3; k++) {
    const m = MODE_TAIL.exec(x);
    if (!m) break;
    const cut = trimEndChars(x.slice(0, m.index), ' :;,');
    if (cut.length < 4) break;
    x = cut;
  }
  return x;
}

/** A button or a label of the slide (« Justifier », « Justification : »): one or two words without a final point. */
function isLabel(t) {
  const c = clean(t);
  return c.split(' ').length <= 2 && !c.endsWith('.');
}

const CLAUSE_HEAD = rx("^(en\\s+\\p{L}+ant\\b[^,]{0,90}|[àa]\\s+partir\\s+(?:de|des|du|d['’])[^,]{0,90}|pour\\s+[^,]{3,90}),\\s*(.+)$", 'i');

/**
 * « En exploitant le vocabulaire du texte, je réponds aux questions » -> « Répondre aux questions en exploitant le vocabulaire du texte »;
 * « Pour vous aider à…, complétez le tableau » -> « Compléter le tableau ». Null when the sentence is not of this kind.
 */
function fromClause(t0) {
  for (const sent of clean(t0).split(SPLIT_SENT)) {
    const m = CLAUSE_HEAD.exec(sent.trim());
    if (!m) continue;
    const head = m[1].trim();
    const tail = m[2].trim();
    const main = actionize(tail) || fromFirstPerson(tail);
    if (!main) continue;
    const n = norm(head);
    let extra;
    if (n.startsWith('pour vous aider')) extra = '';
    else if (n.startsWith('a partir')) extra = 'à partir' + head.slice(8);
    else extra = lowerFirst(head);
    const base = trimEndChars(main, '. :');
    return !extra ? base : base + ' ' + extra;
  }
  return null;
}

/** The answers proposed on a slide (« narratif », « descriptif »…): short boxes without a final point. Empty when there are fewer than two. */
function choicesOf(sl) {
  const skip = /^(?:justifi|verifions|corrigeons|je fais|je dis|tous ensemble|travaill|binome|autonom|collectif|image|objectif|oui$|non$)/;
  const out = [];
  for (const p of sl.paras) {
    const c = clean(p); const n = norm(c);
    if (c.length < 3 || c.split(' ').length > 6 || isNoise(c) || p === sl.title) continue;
    if ('.:?!…'.includes(c[c.length - 1]) || c.includes('..') || c.includes('…') || /\p{Nd}/u.test(c)) continue;
    if (skip.test(n)) continue;
    if (!out.map(norm).includes(norm(c))) out.push(c);
  }
  return out.length >= 2 && out.length <= 6 ? out : [];
}

// ---------- modelage: numbered steps, rappels ----------

/** One step of a list of « Je … » sentences, in a few words: « Je lis le titre et les sous-titres. » -> « lire le titre et les sous-titres ». */
function stepClause(t) {
  const first = clean(t).split(SPLIT_SENT)[0];
  const c = fromFirstPerson(first) || first;
  let cut = c.replace(/\s+(?:avant de|afin de)\s+.*$/i, '');
  cut = cut.replace(/\s+dans\s+(?:ma|leur)\s+t[êe]te/i, '');
  const comma = cut.indexOf(',');
  if (comma >= 15) cut = cut.slice(0, comma);
  return trimEndChars(lowerFirst(shorten(isBlank(cut) ? c : cut, 70)), '. :');
}

/**
 * A slide like « Six étapes pour une bonne première lecture »: the numbers 1 to n and the steps written as « Je … » sentences.
 * Returns the line of the modelage, or null when the slide is not of this kind.
 */
function numberedStepsLine(s) {
  const ps = s.paras.map(clean);
  if (ps.filter((x) => /^[1-9]$/.test(x)).length < 3) return null;
  const je = /^(?:je\s|j['’])/i;
  const steps = ps.filter((x) => je.test(x) && x.length >= 8 && x.length <= 170 && !x.endsWith('?'));
  if (steps.length < 3 || steps.length > 9) return null;
  const head = ps.find((x) => norm(x).includes('etape') && x.length < 90 && !je.test(x));
  let title = 'les étapes';
  if (head !== undefined) { const h = lowerFirst(trimEndChars(head, '.: ')); title = h.startsWith('les ') ? h : 'les ' + h; }
  return '-Présenter ' + title + ' : ' + steps.map((x, i) => `${i + 1}) ${stepClause(x)}`).join(' ; ') + '.';
}

/** « Rappel (séance 4) : pour relever…, je suis ces étapes. » -> « Rappeler (séance 4) les étapes à suivre pour relever… ». */
function rappelLine(raw) {
  const c = clean(raw).replace(/(?<!\.)\.\.(?!\.)/g, '.');
  if (!norm(c).startsWith('rappel') || c.length < 14) return null;
  const m = /^rappel\s*(\([^)]*\))?\s*[:：]\s*(.*)$/i.exec(c);
  if (!m) return withEnd(capFirst(c));
  const seance = m[1] || '';
  const body = m[2].trim();
  if (body.length < 4) return null;
  const st = /^pour\s+(.+?),\s*je\s+(?:suis|fais|applique)\s+(?:ces|les)\s+[ée]tapes\.?$/i.exec(body);
  const tail = st ? 'les étapes à suivre pour ' + st[1] : lowerFirst(trimEndChars(body, '. '));
  return withEnd('Rappeler' + (seance ? ' ' + seance : '') + ' ' + tail);
}

/** Of all the slides that list numbered steps, the fullest one (the « bilan » shows the four steps, an earlier slide only three). */
function bestNumberedSteps(slides) {
  let best = null; let bestN = -1;
  for (const s of slides) {
    const l = numberedStepsLine(s);
    if (l === null) continue;
    const n = (l.match(/;/g) || []).length;
    if (n > bestN) { best = l; bestN = n; }
  }
  return best;
}

/** The instructions the notes of a practice slide give to the teacher (« Exiger une justification avec « parce que le nom est… » »). */
function practiceNoteLines(sl) {
  const out = [];
  for (const raw of sl.notes || []) {
    for (const sent of clean(raw).split(SPLIT_SENT)) {
      const t = sent.trim();
      if (t.length < 12) continue;
      const n = norm(t);
      if (n.startsWith('obliger les eleves a appliquer la strategie') || n.startsWith("attirer l'attention")) continue;
      const a = actionize(t);
      if (!a) continue;
      out.push(withEnd(shorten(a)));
    }
  }
  return out;
}

const hasRappel = (s) => s.paras.some((p) => rappelLine(p) !== null);

/** Every « Rappel » of the slides, as a line of the modelage, followed by its steps (« Lire les colonnes : … ») when the slide shows them. */
function rappelLines(slides) {
  const out = [];
  const labelled = /^([^:]{3,45}?)\s*:\s+.{8,}$/;
  const verb = /^\p{L}+(?:er|ir|re)\b/u;
  for (const sl of slides) {
    let line = null;
    for (const p of sl.paras) { const r = rappelLine(p); if (r !== null) { line = r; break; } }
    if (line === null) continue;
    const steps = [];
    for (const p of sl.paras.map(clean)) {
      if (norm(p).startsWith('rappel')) continue;
      const lm = labelled.exec(p);
      if (!lm) continue;
      const lab = lm[1].trim();
      if (verb.test(norm(lab)) && lab.split(' ').length <= 6) steps.push(lowerFirst(lab));
    }
    const full = steps.length >= 2 ? trimEndChars(line, '. ') + ' : ' + steps.join(', ') + '.' : line;
    if (!out.includes(full)) out.push(full);
  }
  return out;
}

/**
 * The consigne of a slide: it is either in the banner at the top or on the page. Both are searched and ONE is
 * chosen (the banner first, then the page); the two are never written together.
 */
function pickConsigne(sl, body, allowModeOnly = false) {
  const ok = (c) => allowModeOnly || !isModeOnly(c);
  const anyOf = (t) => actionizeAny(t) || fromClause(t);
  // buttons (« Justifier ») are not consignes; « Tous ensemble / Travaillez en binômes » only says how to work
  const bodyC = body.filter((x) => !isLabel(x)).map(stripMode);
  for (const bp of bodyC) { const r = anyOf(bp); if (r && ok(r)) return r; }
  if (!isBlank(sl.title) && !isNoise(sl.title) && !isLabel(sl.title) && !body.includes(sl.title)) { const r = anyOf(stripMode(sl.title)); if (r && ok(r)) return r; }
  const header = [sl.title || ''].concat(sl.paras.slice(0, 1)).filter((x) => !isBlank(x) && !isNoise(x) && !isLabel(x)).map(stripMode);
  for (const h of header.concat(bodyC)) { const r = fromFirstPerson(h); if (r && ok(r)) return r; }
  return null;
}

/** « Travaillez seuls », « Travaillez en binôme »: it says how to work, not what to do, so it is not a consigne. */
function isModeOnly(t) {
  const n = norm(clean(t))
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(?:sur|dans)?\s*(?:l'|la\s+)?activite\s*\d+\w?/g, ' ')
    .replace(/\bpage\s*\d+/g, ' ')
    .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const how = 'seul|seuls|seule|seules|en autonomie|individuellement|en binome|par deux|en duo|a deux|ensemble|en groupe|en classe entiere|collectivement';
  return new RegExp('^(?:demander (?:aux eleves )?de )?(?:travailler|travaillez|travaille)(?: (?:' + how + '))$').test(n) ||
    /^(?:en )?(?:autonomie|binome|collectif|collective|individuel|individuellement)$/.test(n);
}

/** The verbs of the steps shown as numbered tabs on a slide (« 1 Repérer », « 2 Classer »...), in order. */
function stepVerbsOf(slides) {
  const verb = /^\p{L}+(?:er|ir|re|oir)$/iu;
  const tab = /(?:^|\s)(\d{1,2})[\s\u00a0]*[.)\-–:]?[\s\u00a0]*(\p{L}[\p{L}’'\-]*)/gu;
  const bare = /^\d{1,2}$/;
  const word = /^\p{L}[\p{L}’'\-]*$/u;
  let best = [];
  for (const s of slides) {
    const ps = s.paras.map(clean);
    const byNo = new Map();
    ps.forEach((p, i) => {
      for (const m of p.matchAll(tab)) {
        const no = parseInt(m[1], 10);
        const w = m[2];
        if (verb.test(w) && !byNo.has(no)) byNo.set(no, w);
      }
      // the number and the word in two paragraphs
      if (bare.test(p) && i + 1 < ps.length && word.test(ps[i + 1]) && verb.test(ps[i + 1])) {
        const no = parseInt(p, 10);
        if (!byNo.has(no)) byNo.set(no, ps[i + 1]);
      }
    });
    const found = [];
    let k = 1;
    while (byNo.has(k)) { found.push(lowerFirst(byNo.get(k))); k++; }
    if (found.length >= 3 && found.length > best.length) best = found;
  }
  return best;
}

const STEP_LABEL = /^(?:[ée]tape\s*(\d+)|(?:premi[eè]re|deuxi[eè]me|troisi[eè]me|quatri[eè]me|cinqui[eè]me|derni[eè]re)\s+[ée]tape)\s*[:.\-–]?\s*(.*)$/i;

function stepText(t) {
  const c = fromFirstPerson(t) || t;
  return trimEndChars(lowerFirst(shorten(c, 45)), '. :');
}

/** The steps (« Étape 1 : … ») shown on a slide, in a few words each. Empty when the slide shows fewer than two. */
function stepsOf(s) {
  const ps = s.paras.map(clean);
  const found = [];
  let i = 0;
  while (i < ps.length) {
    const m = STEP_LABEL.exec(ps[i]);
    if (m) {
      let t = (m[2] || '').trim();
      if (t.length < 3) { // the text of the step is in the next paragraph
        const nx = ps[i + 1];
        if (nx !== undefined && !STEP_LABEL.test(nx) && !isNoise(nx)) { t = nx; i++; }
      }
      if (t.length >= 3) found.push([m[1] && /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : found.length + 1, stepText(t)]);
    }
    i++;
  }
  if (found.length < 2) return [];
  return found.map((x, idx) => [x[0], idx, x[1]]).sort((a, b) => (a[0] - b[0]) || (a[1] - b[1])).map((x) => x[2]);
}

const CORRECTION_RE = /(?:^|[,;:.]\s+)(?:voici|verifions|corrigeons|correction)\b.*(?:complete|reponse|hypothese|corrige|solution|critere|resultat)|^(?:verifions|corrigeons|correction)\b|etape de verification/;

/** A slide that only shows the answers (« Voici les phrases complétées… », « Voici quelques hypothèses… »): it has no consigne of its own. */
function isCorrection(sl) {
  const heads = [sl.title || ''].concat(sl.paras.slice(0, 3)).map((x) => norm(clean(x))).filter((x) => x);
  return heads.some((h) => CORRECTION_RE.test(h));
}

/** The first instruction written in the notes of the slide (« Lors de la mutualisation, demander aux élèves de justifier… »). */
function noteConsigne(sl) {
  for (const raw of sl.notes || []) {
    for (const sent of clean(raw).split(SPLIT_SENT)) {
      const t = sent.replace(rx('^(?:lors|pendant|au cours|apr[eè]s|[àa] la fin)\\b[^,]{0,50},\\s*', 'i'), '');
      const a = actionize(t);
      if (a) return a;
    }
  }
  return null;
}

/** Lines the teacher does not want on the fiche (« Like vocabulaire. », « Attirer l’attention des élèves… »). */
function unwanted(line) {
  const n = norm(clean(line));
  return n.startsWith('like vocabulaire') || n.startsWith("attirer l'attention des eleves") ||
    n.startsWith("expliquer brievement les termes de l'objectif");
}

/** Teaching lines taken from the notes (or the instructions written on the slides). */
function linesOf(slides, cap, skip = null, descriptive = false) {
  const seen = new Set();
  if (skip !== null) seen.add(norm(skip));
  const out = [];
  for (const s of slides) {
    if (out.length >= cap) break;
    const before = out.length;
    const fromNotes = (s.notes || []).length > 0;
    // the slide that announces the objective is already used for "Déclaration de l’objectif"
    if (!fromNotes && isObjectiveSlide(s)) continue;
    const source = fromNotes ? s.notes : s.paras.filter((x) => x !== s.title);
    for (const rawSrc of source) {
      const raw = stripModelage(rawSrc);
      if (out.length >= cap) break;
      if (isNoise(raw) || norm(clean(raw)).startsWith('objectif')) continue;
      let text = actionize(raw) || (fromNotes ? capFirst(sentencesToInfinitive(raw)) : null);
      if (!text) continue;
      if (fromNotes) {
        // the notes often keep the page of an older lesson (« texte P.10 ») while the slide gives the right one (« P. 14 »)
        const sp = PAGE.exec(s.paras.join(' '));
        const np = new RegExp(PAGE.source, 'i').exec(text);
        if (sp && np && sp[1].replace(/ /g, '') !== np[1].replace(/ /g, '')) {
          const start = np.index + np[0].lastIndexOf(np[1]);
          text = text.slice(0, start) + sp[1] + text.slice(start + np[1].length);
        }
      }
      const line = withEnd(shorten(text));
      if (unwanted(line)) continue;
      if (!seen.has(norm(line))) { seen.add(norm(line)); out.push('-' + line); }
    }
    if (descriptive && out.length === before) {
      const shortParas = s.paras.map(clean).filter((x) => !isNoise(x) && !norm(x).startsWith('image'));
      if (shortParas.length) {
        const txt = shortParas.length <= 3 && shortParas.every((x) => x.split(' ').length <= 3) ? shortParas.join(' ') : shortParas[0];
        const line = withEnd(shorten(capFirst(txt)));
        if (!seen.has(norm(line))) { seen.add(norm(line)); out.push('-' + line); }
      }
    }
  }
  return out;
}

// ---------- Compréhension détaillée: ONE general form for every course (1AC, 3AC, every unit) ----------
// Nothing here depends on the words of one lesson: it reads the structure that every course has
// (numbered steps with a question, « penser à voix haute » notes, « Activité N, p. X. Étape N : … » banners).

const CD_CAP = 'A-ZÉÈÀÂÊÎÔÛÇ';
const CD_NOT_INF = new Set(['premier', 'dernier', 'hier', 'soir', 'notre', 'votre', 'autre', 'leur', 'pour', 'mere', 'pere', 'frere']);
const CD_ACTIVITE = /activit[ée]s?\s*(?:n\s*[°º]\s*)?(\d+)/i;
const CD_STEP = /[ée]tapes?\s*(\d+)(?:\s*(?:et|,|-|–|à)\s*(\d+))?/i;
const CD_HEADER = /(?:activit[ée]s?\s*(?:n\s*[°º]\s*)?\d+|[ée]tapes?\s*\d+\s*:)/i;
const CD_IMPERATIVE_ITEM = new RegExp(
  '^(?:r[ée]sume|compl[eè]te|relie|rel[eè]ve|classe|justifie|[ée]cris|trouve|explique|donne|cite|r[ée]ponds|indique|' +
  'souligne|choisis|coche|associe|d[ée]duis|identifie|reformule|rep[eè]re|regroupe|propose|rédige|r[ée]dige)(?![\\p{L}\\p{N}_])', 'iu');

const isUpper = (ch) => !!ch && ch === ch.toUpperCase() && ch !== ch.toLowerCase();

/** All the notes of a slide, as one text. */
const noteOf = (s) => clean((s.notes || []).join(' '));

/** The sentences of a note of the teacher; a sentence is never cut inside « … ». */
function noteSentences(raw) {
  const t = clean(raw).replace(/([.!?])\s+»/g, '$1»');
  const out = [];
  let depth = 0; let start = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '«') depth++;
    if (ch === '»' && depth > 0) depth--;
    if (depth === 0 && (ch === '.' || ch === '!' || ch === '?' || ch === '»') && i + 2 < t.length && t[i + 1] === ' ' && isUpper(t[i + 2])) {
      out.push(t.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  if (start < t.length) out.push(t.slice(start).trim());
  return out.filter((x) => x);
}

/** A sentence of the notes that tells the teacher what to do (« Rappeler la démarche… », « Ne pas relever… »). */
function noteInstruction(s0) {
  const s = trimStartChars(clean(s0), '»« ');
  if (s.length < 6) return null;
  const a = actionize(s);
  if (a) return a;
  if (norm(s).startsWith('ne ')) return capFirst(s);
  const fm = /^[\p{L}’']+/u.exec(s);
  if (!fm) return null;
  const n = norm(fm[0]);
  if (n.length >= 5 && /^[a-z]+(?:er|ir|re)$/.test(n) && !CD_NOT_INF.has(n)) return capFirst(s);
  return null;
}

/** True when at least half of the long words of a are already in b. */
function wordOverlap(a, b) {
  const w = norm(a).split(/[^a-z0-9]+/).filter((x) => x.length > 3);
  if (!w.length) return false;
  const nb = norm(b);
  return w.filter((x) => nb.includes(x)).length * 2 >= w.length;
}

/** The name of a step written as a sentence (« Je repère les mots-clés : les mots qui portent le sens. » -> « repérer les mots-clés »). */
function cdStepName(phrase) {
  let p = trimEndChars(clean(phrase), '. :');
  const lm = /^[^,:]{3,40},\s*((?:je\s|j['’]).*)$/i.exec(p);
  if (lm) p = lm[1];
  const ci = p.indexOf(':');
  const before = (ci < 0 ? p : p.slice(0, ci)).trim();
  const after = (ci < 0 ? '' : p.slice(ci + 1)).trim();
  const pick = /^(?:je\s|j['’])/i.test(after) ? after : before;
  const name = trimEndChars(lowerFirst(fromFirstPerson(pick) || pick), '. :');
  if (name.length < 4) return null;
  return name.length > 60 ? trimEndChars(name.slice(0, 60), ' ,') : name;
}

const fitLine = (s, max = 170) => (s.length <= max ? s : shorten(s, max));

// ----- the modelage -----

/** What the teacher says aloud for one step (« Penser à voix haute : « … » Ne pas… »), and what he must not do. */
function cdSpeech(note) {
  const c = clean(note);
  const nc = norm(c);
  if (!(nc.startsWith('penser a voix haute') || (nc.startsWith('modelage') && nc.includes('voix haute')))) return null;
  const a = c.indexOf('«');
  let b = -1;
  if (a >= 0) {
    // the » that closes the first « (quotes can be nested: « … « Hier… » … »)
    let depth = 0;
    for (let k = a; k < c.length; k++) {
      if (c[k] === '«') depth++;
      if (c[k] === '»') { depth--; if (depth === 0) { b = k; break; } }
    }
  }
  let inner; let tail = '';
  if (a >= 0 && b > a) { inner = c.slice(a + 1, b).trim(); tail = c.slice(b + 1).trim(); }
  else { const ci = c.indexOf(':'); inner = (ci < 0 ? c : c.slice(ci + 1)).trim(); }
  if (inner.length < 8) return null;
  const sents = inner.split(new RegExp('(?<=[.!?])\\s+(?=[' + CD_CAP + '«])'));
  let said = sents[0].trim();
  if (sents.length > 1 && said.length + sents[1].length < 150) said += ' ' + sents[1].trim();
  said = fitLine(said, 155).replace(/«\s*/g, '‹').replace(/\s*»/g, '›');
  // what follows the speech: the limits given to the teacher (« Ne pas relever les autres lieux. »)
  const limRaw = noteSentences(trimStartChars(tail, '» ')).filter((x) => noteInstruction(x) !== null).slice(0, 2).join(' ');
  const lim = limRaw.length >= 4 ? withEnd(capFirst(limRaw)) : null;
  return { said, limit: lim };
}

/** « Modelage : faire réécouter le passage, puis penser à voix haute (« j’entends… ») » -> « Faire réécouter le passage, puis penser à voix haute. » */
function cdSpeechLead(note) {
  const c = clean(note);
  if (!norm(c).startsWith('modelage')) return null;
  const ci = c.indexOf(':');
  let lead = (ci < 0 ? '' : c.slice(ci + 1)).trim();
  const cut = [...lead].findIndex((ch) => ch === '(' || ch === '«');
  if (cut >= 0) lead = lead.slice(0, lead.indexOf([...lead][cut]));
  lead = trimEndChars(lead.trim(), ',;: .');
  if (lead.split(' ').length < 5) return null;
  const ins = noteInstruction(lead);
  if (!ins) return null;
  return '-' + withEnd(ins);
}

/**
 * The steps of the method. Three ways to write them are understood: tabs « 1 Repérer », a slide with the number, the
 * sentence of the step and its question, or a recap with the tab and the question under it. The best one wins.
 */
function cdSteps(slides) {
  const verbs = stepVerbsOf(slides);
  const bare = /^\d{1,2}$/;
  const tab = /^(\d{1,2})[\s\u00a0]+(\p{L}[\p{L}’'\-]*)$/u;
  let qA = new Map(); let phA = new Map(); let qB = new Map();
  for (const s of slides) {
    const ps = s.paras.map(clean);
    const a = new Map(); const phs = new Map();
    for (let i = 0; i < ps.length - 2; i++) {
      if (!bare.test(ps[i])) continue;
      const ph = ps[i + 1]; const q = ps[i + 2];
      if (q.endsWith('?') && q.length >= 8 && q.length <= 160 && !ph.endsWith('?') && ph.length >= 6 && ph.length <= 180 && !bare.test(ph)) {
        a.set(parseInt(ps[i], 10), q);
        phs.set(parseInt(ps[i], 10), ph);
      }
    }
    if (a.size < 3) {
      // the numbers and the questions in two groups: as many questions as numbers
      const nums = ps.filter((x) => bare.test(x)).map((x) => parseInt(x, 10)).sort((x, y) => x - y);
      const qs = ps.filter((x) => x.endsWith('?') && x.length >= 8 && x.length <= 160);
      if (nums.length >= 3 && qs.length === nums.length) {
        a.clear();
        nums.forEach((no, k) => a.set(no, qs[k]));
      }
    }
    if (a.size > qA.size) { qA = a; phA = phs; }
    const b = new Map();
    for (let i = 0; i < ps.length - 1; i++) {
      const m = tab.exec(ps[i]);
      if (!m) continue;
      const q = ps[i + 1];
      if (q.endsWith('?') && q.length >= 8 && q.length <= 160) b.set(parseInt(m[1], 10), [lowerFirst(m[2]), q]);
    }
    if (b.size > qB.size) qB = b;
  }
  const n = Math.max(verbs.length, qA.size, qB.size);
  if (n < 3) return [];
  const out = [];
  for (let k = 1; k <= n; k++) {
    const bk = qB.get(k);
    const verb = verbs[k - 1] ?? (bk ? bk[0] : (phA.has(k) ? cdStepName(phA.get(k)) : null)) ?? null;
    out.push({ no: k, verb, question: qA.get(k) ?? (bk ? bk[1] : null) });
  }
  return out;
}

/** The steps of the method, only named (no question, no example): « Présenter les 6 étapes à suivre pour … : repérer, classer… ». */
function cdStepBlock(steps, obj) {
  const names = steps.map((x) => lowerFirst(x.verb || `étape ${x.no}`));
  return ['-Présenter les ' + steps.length + ' étapes à suivre' + (obj !== null ? ' pour ' + obj : '') + ' : ' + names.join(', ') + '.'];
}

/** The key words of the lesson explained with an example (« Un thème », « L’idée générale »…), when the slide has them. */
function cdNotions(s) {
  const ps = s.paras.map(clean);
  const names = [];
  for (let i = 0; i < ps.length - 2; i++) {
    const t = ps[i];
    const n = norm(t);
    if (t.length < 3 || t.length > 45 || t.endsWith('.') || t.endsWith(':') || t.endsWith('?')) continue;
    if (n.startsWith('la situation') || n.startsWith('notre tache') || n.startsWith('exemple')) continue;
    const def = ps[i + 1];
    if (def.length < 15 || norm(def).startsWith('exemple')) continue;
    if (!norm(ps[i + 2]).startsWith('exemple')) continue;
    names.push(lowerFirst(t));
  }
  if (names.length < 2) return null;
  return '-Expliquer les notions clés avec un exemple : ' + names.slice(0, 5).join(' ; ') + '.';
}

/**
 * The modelage of a Compréhension détaillée, in the order of the slides: what the notes ask the teacher (silent reading,
 * recall, usefulness…), the situation and the task, the key notions, the steps with their question and what is said aloud.
 */
function cdModelage(modSlides, declared, steps) {
  const out = []; const seen = new Set();
  const add = (t) => { const k = norm(t); if (!seen.has(k)) { seen.add(k); out.push({ text: t, mode: false }); } };
  const obj = declared ? lowerFirst(trimEndChars(clean(declared), '. :')) : null;
  const firstSpeech = modSlides.findIndex((s) => cdSpeech(noteOf(s)) !== null);
  const stepIdx = steps.length >= 3 ? modSlides.findIndex((s) => cdSteps([s]).length >= 3) : -1;
  const cands = [firstSpeech, stepIdx].filter((x) => x >= 0);
  const anchor = cands.length ? Math.min(...cands) : -1;
  let stepsDone = false;
  const emitSteps = () => {
    if (stepsDone) return;
    stepsDone = true;
    if (steps.length >= 3) cdStepBlock(steps, obj).forEach(add);
  };
  const sitSlide = modSlides.find((s) => s.paras.some((p) => norm(clean(p)).startsWith('la situation'))) || null;
  if (sitSlide === null) add('-Expliquer la situation et la tâche.');
  let noteLines = 0; let sitDone = false;
  const emitSituation = (s) => {
    if (sitDone) return;
    sitDone = true;
    let l = '-Expliquer la situation et la tâche';
    const sp = s.paras.map(clean).find((x) => norm(x).startsWith('la situation'));
    const sit = sp && sp.includes(':') ? sp.slice(sp.indexOf(':') + 1).trim() : '';
    if (sit.length > 8) l += ' : ' + shorten(sit, 150);
    add(withEnd(l));
    const nt = cdNotions(s);
    if (nt) add(nt);
  };
  modSlides.forEach((s, i) => {
    if (i === anchor) emitSteps();
    // « Mais avant de lancer l’enregistrement, rappelons d’abord les règles d’une bonne écoute. »
    let rule = null;
    for (const p of s.paras.map(clean)) { const m = /r[eè]gles\s+d['’][^.,:;]{3,40}/i.exec(p); if (m) { rule = m[0]; break; } }
    if (rule !== null) add('-Rappeler les ' + lowerFirst(rule) + '.');
    const note = noteOf(s);
    if (note && cdSpeech(note) !== null) { const l = cdSpeechLead(note); if (l) add(l); }
    if (note && cdSpeech(note) === null && !norm(note).startsWith('planification')) {
      let perSlide = 0;
      for (const sent of noteSentences(note)) {
        if (noteLines >= 8 || perSlide >= 3) break;
        const ins0 = noteInstruction(sent);
        if (!ins0) continue;
        if (norm(ins0).startsWith('ne ')) continue;
        // no example between brackets: « … en pensant à voix haute (« maisons : qui ? ») » -> « … en pensant à voix haute. »
        const ins = ins0.replace(/\s*\([^)]*[«»][^)]*\)/g, '');
        if (unwanted(ins)) continue;
        const n = norm(ins);
        if (n.includes('situation') && n.includes('tache')) {
          // « Présenter la situation et la tâche… »: the situation of the slide is written right here
          if (s === sitSlide) emitSituation(s);
          continue;
        }
        add('-' + withEnd(fitLine(ins)));
        noteLines++; perSlide++;
      }
    }
    if (s === sitSlide) emitSituation(s);
  });
  if (!stepsDone) emitSteps();
  return out;
}

// ----- the pratiques guidées -----

function newAct(mode, act, page, label) { return { mode, act, page, label, parts: [], asks: [], questions: [], tips: [], corrections: 0 }; }

/** The banner of a practice slide: « Activité 3, p. 12. Étape 5 : répondez avec les mots du tableau. » */
function cdHeader(sl) {
  for (const c0 of [sl.title || ''].concat(sl.paras)) {
    const c = clean(c0);
    if (c.length >= 20 && CD_HEADER.test(c)) return c;
  }
  return null;
}

function cdModeOf(header) {
  if (header === null) return null;
  const n = norm(header);
  if (/binome|par deux|en duo/.test(n)) return 'B';
  if (/\bseuls?\b|\bseules?\b|autonom|individuel/.test(n)) return 'A';
  return null;
}

/** (label of the steps, what is asked) from the banner: « Étapes 1 et 2 » / « relevez les mots… ». */
function cdTask(header) {
  const m = CD_STEP.exec(header);
  let label = null; let rest;
  if (m) {
    const a = m[1]; const b = m[2] || '';
    label = b ? `Étapes ${a}-${b}` : `Étape ${a}`;
    rest = header.slice(m.index + m[0].length);
  } else {
    rest = header.replace(/^.*?activit[ée]s?\s*\d+\s*[,.:]?\s*(?:p(?:ages?)?\.?\s*\d+(?:\s*[-–]\s*\d+)?)?\s*[.,:]?/i, '');
  }
  rest = trimStartChars(rest, ' :.,-–');
  rest = rest.replace(/^(?:travaillez|travaille)\s+\p{L}+(?:\s+\p{L}+)?\s*[.:]\s*/iu, '');
  return [label, rest.trim()];
}

/** The instruction of the banner in the infinitive, and the questions it contains (kept only when the slide shows none). */
function cdInstruction(rest, hasQuestions) {
  const parts = []; const asks = [];
  for (const s0 of rest.split(SPLIT_SENT)) {
    const s = clean(s0);
    if (s.length < 4) continue;
    if (s.endsWith('?')) { if (!hasQuestions) asks.push(capFirst(s)); continue; }
    const a = actionize(s) || fromFirstPerson(s) || actionizeAny(s);
    if (!a) continue;
    parts.push(trimEndChars(lowerFirst(polishConsigne(a, true)), '. :'));
  }
  return [parts, asks];
}

/** The questions or tasks written on a practice slide (« 1- Pourquoi… ? », « 3- Résume le texte… », « …, quelle est l’idée générale ? »). */
function cdQuestions(sl, header) {
  const out = [];
  const num = /^(\d{1,2})\s*[-–.)]\s*(.+)$/;
  for (const p0 of sl.paras) {
    const p = clean(p0);
    if (!p || p === header) continue;
    const m = num.exec(p);
    const body = m ? m[2].trim() : p;
    if (body.length < 12 || body.length > 200) continue;
    const isQ = body.endsWith('?');
    const isImp = !!m && (CD_IMPERATIVE_ITEM.test(body) || rx('^\\p{L}+ez\\b').test(body));
    if (!isQ && !isImp) continue;
    if (norm(body).startsWith('quand avons')) continue;
    out.push(isQ ? capFirst(body) : (actionize(body) || capFirst(body)));
  }
  return out;
}

function cdActLine(a) {
  const ref = refText(a.act, a.page);
  const head = [a.label, ref ? '(' + lowerFirst(ref) + ')' : null].filter((x) => x).join(' ');
  let sb = '-';
  if (head) sb += head + ' : ';
  if (a.parts.length) {
    sb += 'Demander ';
    a.parts.forEach((p, i) => { if (i > 0) sb += ', puis '; sb += (startsWithVowel(p) ? 'd’' : 'de ') + p; });
  } else if (a.act !== null && a.act !== undefined) {
    sb += `Demander de réaliser l’activité ${a.act}` + (a.page ? `, page ${a.page}` : '');
  } else sb += 'Consigne à compléter';
  let s = trimEndChars(sb, '. :');
  const qs = a.questions.length ? a.questions : a.asks;
  if (qs.length === 1) s += ` ; question : « ${qs[0]} »`;
  else if (qs.length > 1) s += ' ; questions : ' + qs.slice(0, 5).map((q, i) => `${i + 1}) ${q}`).join(' ');
  s = withEnd(s);
  const tips = a.tips.slice(0, 2).map((t) => withEnd(fitLine(t, 150)));
  let out = s + (tips.length ? ' ' + tips.join(' ') : '');
  if (a.corrections > 0 && !tips.some((t) => norm(t).includes('corrig') || norm(t).includes('verifi'))) out += ' Vérifier ensemble les réponses et corriger.';
  return out;
}

/**
 * The pratiques guidées of a Compréhension détaillée: one line per activity, with the steps it practises, what the pupils
 * do, the questions, what the teacher asks and the correction. Null when the slides do not show such activities
 * (the general way of reading practice slides is used then).
 */
function cdPractices(list, warn) {
  const acts = new Map();
  let last = null;
  for (const p of list) {
    const sl = p.slide;
    const header = cdHeader(sl);
    if (!p.pratique && (header === null || !CD_ACTIVITE.test(header))) continue;
    if (isCorrection(sl)) {
      const am = header !== null ? CD_ACTIVITE.exec(header) : null;
      const no = am ? am[1] : null;
      let target = null;
      if (no !== null) { const hits = [...acts.values()].filter((x) => x.act === no); target = hits.length ? hits[hits.length - 1] : null; }
      target = target || last;
      if (target) {
        target.corrections++;
        for (const q of cdQuestions(sl, header)) if (!target.questions.some((x) => norm(x) === norm(q))) target.questions.push(q);
        for (const sent of noteSentences(noteOf(sl))) {
          const t = noteInstruction(sent);
          if (!t) continue;
          if (!unwanted(t) && !target.tips.some((x) => norm(x) === norm(t))) target.tips.push(t);
        }
      }
      continue;
    }
    if (header === null && reference(sl)[0] === null) {
      warn.push(`Diapositive ${sl.number} (pratique guidée) : aucune activité lue, consigne à compléter.`);
      continue;
    }
    let act; let page;
    if (header !== null) {
      const am = CD_ACTIVITE.exec(header); act = am ? am[1] : null;
      const pm = PAGE.exec(header); page = pm ? pm[1].replace(/\s+/g, '') : null;
    } else { const r = reference(sl); act = r[0]; page = r[1]; }
    const task = header !== null ? cdTask(header) : [null, ''];
    const mode = p.mode || cdModeOf(header) || 'C';
    const key = `${mode}|${act ?? ''}|${page ?? ''}|${task[0] ?? ''}` + (act === null ? '|' + norm(header ?? '').slice(0, 60) : '');
    let a = acts.get(key);
    const created = !a;
    if (created) { a = newAct(mode, act, page, task[0]); acts.set(key, a); }
    last = a;
    const qs = cdQuestions(sl, header);
    if (created && task[1]) {
      const ins = cdInstruction(task[1], qs.length > 0);
      a.parts = ins[0];
      a.asks = ins[1];
    }
    for (const q of qs) if (!a.questions.some((x) => norm(x) === norm(q))) a.questions.push(q);
    for (const sent of noteSentences(noteOf(sl))) {
      const t = noteInstruction(sent);
      if (!t) continue;
      if (unwanted(t)) continue;
      if (a.tips.length < 3 && !a.tips.some((x) => norm(x) === norm(t))) a.tips.push(t);
    }
  }
  if (!acts.size) return null;
  const out = [];
  for (const m of ['C', 'B', 'A']) {
    const group = [...acts.values()].filter((x) => x.mode === m);
    if (!group.length) continue;
    out.push({ text: modeLabel(m), mode: true });
    for (const a of group) {
      if (!a.parts.length && !a.questions.length && !a.asks.length) warn.push(`Consigne de l’activité ${a.act ?? '?'} non trouvée dans la diapositive : à compléter.`);
      out.push({ text: cdActLine(a), mode: false });
    }
  }
  return out;
}

// ---------- the whole fiche ----------

/**
 * deck: the slides read from the PowerPoint; f: the fields (detect, possibly corrected by the teacher);
 * modeOf(slide): the work mode of a slide from its icon ("C", "B", "A", "L", "T", "R" or null);
 * bookConsigne(act, pages) -> the consigne printed in the book, or null (not available on the PC: the book is not read here).
 */
function build(deck, f, modeOf, bookConsigne = null) {
  const notes = [];
  const list = usable(deck);

  // components, in the order of the slides
  const comps = []; const openSlides = []; const closeSlides = [];
  const newComp = (name) => ({ name, slides: [] });
  const sections = sectionsOf(list);
  if (sections.some((x) => x.kind === 'comp')) {
    for (const sec of sections) {
      if (sec.kind === 'open') sec.slides.filter((x) => x[1] === Role.CONTENT).forEach((x) => openSlides.push(x[0]));
      else if (sec.kind === 'close') sec.slides.filter((x) => x[1] === Role.CONTENT).forEach((x) => closeSlides.push(x[0]));
      else {
        let c = comps.find((x) => x.name === sec.name);
        if (!c) { c = newComp(sec.name); comps.push(c); }
        c.slides.push(sec.marker);
        sec.slides.filter((x) => x[1] === Role.CONTENT).forEach((x) => c.slides.push(x[0]));
      }
    }
  } else {
    // no section title slides: components follow the titles of the slides
    let cur = null;
    for (const [s, role] of list) {
      if (role !== Role.CONTENT) continue;
      const found = componentOf(s);
      if (found !== null && (cur === null || cur.name !== found)) { cur = newComp(found); comps.push(cur); }
      if (cur) cur.slides.push(s);
    }
  }
  const isOutils = comps.some((x) => baseName(x.name) === 'Outils de langue');
  if (!comps.length) notes.push('Aucune composante reconnue dans les titres des diapositives (Vocabulaire, Compréhension globale, Lecture fluence...).');

  // durations from "Structure de la séance"
  // the real « Structure de la séance » wins; « Pratique pédagogique efficace » is only used when it is missing (no double count)
  const allStructure = list.filter((x) => x[1] === Role.STRUCTURE).map((x) => x[0]);
  const realStructure = allStructure.filter(isRealStructure);
  const structure = realStructure.length ? realStructure : allStructure;
  const durs = parseDurations(structure);
  if (!structure.length) notes.push('Pas de diapositive « Structure de la séance » : les durées sont à remplir.');
  const minutes = (kind) => {
    const hits = durs.filter((d) => d.kind === kind);
    return !hits.length ? '' : hits.reduce((a, d) => a + d.minutes, 0) + ' min';
  };
  const others = durs.filter((d) => d.kind === 'other');
  const missing = [];
  const compDur = new Map();
  comps.forEach((c, i) => {
    let d = minutes('comp:' + c.name);
    if (!d && comps.length === 1 && others.length) d = others.reduce((a, x) => a + x.minutes, 0) + ' min';
    if (!d && comps.length > 1 && others.length === comps.length) d = others[i].minutes + ' min';
    if (!d && structure.length) missing.push(c.name);
    compDur.set(i, d);
  });
  const dOpen = minutes('open');
  const dClose = minutes('close') || '5 min'; // not in the slides: the closing lasts 5 min
  if (structure.length && !dOpen) missing.push('Ouverture');
  if (missing.length) notes.push('Durée non trouvée dans « Structure de la séance » pour : ' + missing.join(', ') + '.');

  // objectives
  const usedObj = new Set();
  const seanceNo = /^\d+$/.test(f.seance) ? parseInt(f.seance, 10) : -1;
  const repMine = reperage(list).get(seanceNo) || [];
  const usedRep = new Set();
  const objectiveFor0 = (comp, index) => {
    // Compréhension détaillée: the objective announced on the slide of the lesson wins over the weekly overview
    if (baseName(comp.name) === 'Compréhension détaillée') {
      for (const s of comp.slides) { const b = objectiveBanner(s); if (b !== null) return withEnd(capFirst(b)); }
    }
    for (let i = 0; i < repMine.length; i++) {
      const e = repMine[i];
      if (usedRep.has(i) || e.comp === null || baseName(e.comp) !== baseName(comp.name)) continue;
      if (clean(e.text).length > 3) { usedRep.add(i); return withEnd(capFirst(clean(e.text))); }
    }
    for (const s of comp.slides) { const b = objectiveBanner(s); if (b !== null) return withEnd(capFirst(b)); }
    const hint = hintFor(comp.name);
    if (hint) {
      for (let i = 0; i < f.objectifs.length; i++) {
        if (!usedObj.has(i) && hint.test(norm(f.objectifs[i]))) { usedObj.add(i); return f.objectifs[i]; }
      }
    }
    if (f.objectifs.length === comps.length && !usedObj.has(index)) { usedObj.add(index); return f.objectifs[index]; }
    return null;
  };
  // a cut sentence is completed with the objective of the séance; CG and CD can share one objective
  const objectiveFor = (comp, index) => {
    const d = objectiveFor0(comp, index);
    if (d !== null) {
      const nd = trimEndChars(norm(clean(d)), '. :');
      for (const o of f.objectifs) {
        const no = trimEndChars(norm(clean(o)), '. :');
        if (no.length > nd.length + 8 && no.startsWith(nd)) return o;
      }
      return d;
    }
    const bn = baseName(comp.name);
    const both = comps.some((x) => baseName(x.name) === 'Compréhension globale') && comps.some((x) => baseName(x.name) === 'Compréhension détaillée');
    if (both && f.objectifs.length === 1 && (bn === 'Compréhension globale' || bn === 'Compréhension détaillée')) return f.objectifs[0];
    return null;
  };

  // The consignes of the pratiques guidées do not all begin with « Demander » : the form changes from one line to the next.
  let styleCounter = 0;
  const askLine = (infDe, infPlain) => {
    const de = startsWithVowel(infDe) ? 'd’' : 'de ';
    const style = styleCounter++ % 4;
    if (style === 1 || style === 3) return capFirst(infPlain);        // « Lire les phrases »
    if (style === 2) return 'Demander aux élèves ' + de + infDe;      // « Demander aux élèves de lire les phrases »
    return 'Demander ' + de + infDe;                                  // « Demander de lire les phrases »
  };
  const DEMANDER = /^demander\s+(?:aux\s+(?:élèves|eleves|apprenants)\s+)?d(?:e\s+|[’'])\s*(.*)/i;

  const blocs = [];
  comps.forEach((comp, ci) => {
    // Production de l’écrit: once the first « Pratiques guidées » slide is found, the slides with the ear icon
    // that follow belong to the Pratiques guidées too. The modelage stops where the pratiques start.
    const isWriting = baseName(comp.name) === 'Production de l’écrit';
    let practiceStarted = false;
    const isCd = baseName(comp.name) === 'Compréhension détaillée';
    // Compréhension détaillée and Compréhension de l’oral share one general form (steps with a question, banners…)
    const isCompr = isCd || baseName(comp.name) === 'Compréhension de l’oral';
    const mkItem = (slide, pratique, mode, viaEar = false, special = null) => ({ slide, pratique, mode, viaEar, special });
    let items = comp.slides.filter((s) => !isStart(s) && (isCompr || !isHookSlide(s))).map((sl) => {
      const raw = modeOf(sl) ?? null;
      // « T » = girl at the blackboard, « R » = girl with the slate: not a pratique guidée, one fixed sentence only
      if (raw === 'T' || raw === 'R') return mkItem(sl, false, null, false, raw);
      const listening = raw === 'L';
      let m = raw === 'C' || raw === 'B' || raw === 'A' ? raw : null;
      if (m === null && raw === null) m = modeFromText(sl); // icon not recognised: use the words of the slide
      let pr = m !== null || (!listening && norm(headOf(sl)).includes('pratique'));
      let viaEar = false;
      if (pr) practiceStarted = true;
      else if (isWriting && practiceStarted && listening) {
        pr = true; viaEar = true;
        m = modeFromText(sl) ?? 'C'; // the class listens and answers with the teacher: collective unless the slide says otherwise
      }
      return mkItem(sl, pr, m, viaEar);
    });
    // Compréhension détaillée: a slide with a work-mode icon but no « Activité N / Étape N : » banner (and no correction)
    // is a slide of the modelage (« Faisons le bilan… », the pupils raise their hand to read the steps)
    const bannered = items.some((x) => x.pratique && x.special === null && cdHeader(x.slide) !== null);
    if (isCompr && bannered) {
      items = items.map((x) => (x.pratique && x.special === null && cdHeader(x.slide) === null && !isCorrection(x.slide) ? mkItem(x.slide, false, null, x.viaEar, null) : x));
    }
    const declared = objectiveFor(comp, ci);
    if (declared === null) notes.push(`Objectif non trouvé pour « ${comp.name} ».`);

    const rows = [];

    // Modelage: everything before the first pratique guidée (in Production de l’écrit, the ear slides after it are pratiques)
    const modLines = [];
    const P = (text, mode = false) => ({ text, mode });
    if (declared !== null) modLines.push(P('-Déclaration de l’objectif : ' + declared.trimEnd()));
    // « Avant de commencer, je me pose une question » comes right after the objective
    if (!isCompr) {
      const hs = comp.slides.find(isHookSlide);
      if (hs) { const q = hookQuestion(hs); if (q) modLines.push(P('-Question d’accroche : ' + q)); }
    }
    const modSlides = items.filter((x) => !x.pratique && x.special === null).map((x) => x.slide);
    switch (baseName(comp.name)) {
      // Vocabulaire: always the same lines, only the objective changes
      case 'Vocabulaire':
        ['-Observer plusieurs images.', '-Expliquer les expressions.', '-Choisir 2 ou 3 élèves pour lire les phrases.'].forEach((t) => modLines.push(P(t)));
        break;
      // Actes de parole: always the same lines (after the objective and the hook question), the speech acts come from the slides
      case 'Actes de parole': {
        const acts = speechActs(comp.slides);
        // no vignette in the lesson: no « Observer la vignette » line, and the next line loses « Lire chaque vignette et »
        const hasVignette = comp.slides.some((sl) => sl.paras.concat(sl.notes || []).some((t) => norm(clean(t)).includes('vignette')));
        if (hasVignette) modLines.push(P('-Observer la vignette et lire la situation.'));
        const verb = hasVignette ? 'Lire chaque vignette et dégager' : 'Dégager';
        if (!acts.length) {
          modLines.push(P(`-${verb} les actes de parole.`));
          notes.push(`Actes de parole non trouvés dans les diapositives de « ${comp.name} ».`);
        } else modLines.push(P(`-${verb} les actes de parole : ` + acts.join(' ; ') + (acts[acts.length - 1].endsWith('…') ? '' : '.')));
        modLines.push(P('-Expliquer la structure de chaque expression.'));
        modLines.push(P('-Choisir 2 ou 3 élèves pour lire les phrases.'));
        break;
      }
      // Production de l’oral: the objective, the hook question (both added above), then always the same sentence
      case 'Production de l’oral':
        modLines.push(P('-Présenter la tâche que l’élève doit réaliser à la fin de cette séance.'));
        break;
      // Lecture fluence: the objective and the sentence of the rappel, nothing else
      case 'Lecture fluence': {
        const r = rappelOf(modSlides) || rappelOf(comp.slides);
        if (r) modLines.push(P('-' + r));
        break;
      }
      // Compréhension détaillée: the objective, the situation and the task, then the steps (tabs with a verb, or a numbered
      // list of « Je… » sentences), what the notes ask (silent reading…) and the « Rappel » slides
      case 'Compréhension détaillée':
      case 'Compréhension de l’oral': {
        // one general form for every course: see cdModelage
        const stepList = cdSteps(modSlides);
        cdModelage(modSlides, declared, stepList).forEach((x) => modLines.push(x));
        if (stepList.length < 3) {
          const verbs = stepVerbsOf(comp.slides);
          const obj = declared !== null ? lowerFirst(trimEndChars(clean(declared), '. :')) : null;
          const head = '-Présenter les étapes à suivre' + (obj !== null ? ' pour ' + obj : '');
          if (verbs.length) modLines.push(P(head + ' : ' + verbs.join(', ') + '.'));
          else {
            let numbered = null;
            for (const s of modSlides) { const l = numberedStepsLine(s); if (l !== null) { numbered = l; break; } }
            if (numbered !== null) modLines.push(P(numbered));
            else notes.push(`Étapes (Repérer, Classer… ou liste numérotée) non trouvées dans les diapositives de « ${comp.name} ».`);
          }
        }
        if (modLines.length <= 2) linesOf(modSlides.filter((x) => !hasRappel(x)), 4, declared).forEach((t) => modLines.push(P(t)));
        rappelLines(modSlides).forEach((t) => modLines.push(P('-' + t)));
        break;
      }
      default:
        linesOf(modSlides.filter((x) => !hasRappel(x)), 6, declared).forEach((t) => modLines.push(P(t)));
        rappelLines(modSlides).forEach((t) => modLines.push(P('-' + t)));
    }
    // a slide that presents steps: they are added to the modelage, in a few words
    const steps = [...new Set(comp.slides.flatMap(stepsOf))];
    const fixedLines = ['Vocabulaire', 'Actes de parole', 'Production de l’oral', 'Lecture fluence'].includes(baseName(comp.name));
    if (steps.length && !isCompr) {
      modLines.push(P('-Présenter les étapes : ' + steps.slice(0, 6).map((x, i) => `${i + 1}) ${x}`).join(' ; ') + '.'));
    } else if (!isCompr && !fixedLines) {
      const b = bestNumberedSteps(modSlides);
      if (b) modLines.push(P(b));
    }
    // blackboard / slate icons: only these sentences, nothing else from those slides
    const specialLines = new Set();
    for (const item of items) {
      if (item.special === 'T') specialLines.add('-Faire passer quelques élèves au tableau.');
      if (item.special === 'R') specialLines.add('-Les élèves utilisent leurs ardoises.');
    }
    specialLines.forEach((t) => modLines.push(P(t)));
    rows.push({ label: `Modelage ${ci + 1} : ${comp.name}`, paras: modLines });

    // Pratiques guidées: collective / pair / autonomous
    // Compréhension détaillée: one line per activity (steps practised, what the pupils do, questions, correction)
    const cdPara = isCompr && items.some((x) => x.pratique) && items.filter((x) => x.pratique && !isCorrection(x.slide)).every((x) => cdHeader(x.slide) !== null)
      ? cdPractices(items.map((x) => ({ slide: x.slide, pratique: x.pratique, mode: x.mode })), notes) : null;
    const notesMark = notes.length;
    const order = [];
    // one entry per activity (a slide of consigne and the slides that correct it); choices tell two activities with the same consigne apart
    const byMode = new Map();
    const unfound = new Map();
    let lastKey = null;
    let broke = false;
    // En binôme / Autonome: the same activity is written once (the slides of one activity do not repeat the consigne)
    const seenAct = new Map();
    for (const item of items) {
      if (!item.pratique) { broke = true; continue; }
      const m = item.mode || 'C';
      if (item.mode === null) notes.push(`Mode de travail non reconnu (diapositive ${item.slide.number}) : « Collective » par défaut.`);
      const sl = item.slide;
      const [act, page] = reference(sl);
      const ref = refText(act, page);
      const body = sl.paras.filter((x) => x !== sl.title && !isNoise(x) && !norm(clean(x)).startsWith('objectif'));
      const detail = stepHeading(sl); // what the slide itself says, beyond the banner
      const correction = isCorrection(sl);
      const brokeBefore = broke;
      if (correction) broke = true;
      // 1) the consigne printed in the book comes first (automatic, nothing to add by hand)
      let cand0 = null; let fromBook = false;
      if (!correction && bookConsigne && (act !== null || page !== null)) {
        const raw = bookConsigne(act, page ?? (isBlank(f.pages) ? null : f.pages));
        if (raw) {
          const c0 = trimEndChars(repairOcr(clean(raw)), ': ');
          const inf = actionize(c0) || fromFirstPerson(c0);
          if (inf) {
            cand0 = inf; fromBook = true;
            notes.push(`Consigne lue dans le livre (${refText(act, page) || 'pages ' + f.pages}) : « ${shorten(inf, 90)} » — à vérifier.`);
          }
        }
      }
      // 2) not found in the book: the consigne of the slide (a correction slide has none: its instruction, if any, is in its notes)
      if (cand0 === null) cand0 = correction ? (pickConsigne(sl, []) || noteConsigne(sl)) : pickConsigne(sl, body);
      const cand = cand0;
      let silent = false;
      const actKey = act !== null && (m === 'B' || m === 'A') ? `${m}|${act}|${page ?? ''}` : null;
      const rich = detail !== null || (cand !== null && (!correction || fromBook));
      let replaceAt = -1;
      if (actKey !== null) {
        const prev = seenAct.get(actKey);
        if (prev) { if (rich && !prev.rich) replaceAt = prev.index; else continue; }
      }
      let line;
      if (cand !== null) {
        const cand2 = polishConsigne(cand, true);
        const r1 = DEMANDER.exec(cand2);
        const inf = lowerFirst(shorten(r1 ? r1[1] : cand2, 170));
        const plain = polishConsigne(cand, false);
        const r2 = DEMANDER.exec(plain);
        const infPlain = lowerFirst(shorten(r2 ? r2[1] : plain, 170));
        let l = askLine(inf, infPlain);
        l = trimEndChars(l, '. :');
        // a « Justifier » button on the slide: the pupils also justify their answer
        const askJustify = body.some((x) => { const nb = norm(clean(x)); return nb === 'justifier' || nb.startsWith('justification'); });
        if (askJustify && !norm(l).includes('justifi')) l += norm(l).startsWith('demander') ? ' et de justifier' : ' et justifier';
        if (detail !== null && !norm(l).includes(norm(detail)) && !(norm(detail).startsWith('je ') && wordOverlap(detail, l))) l += ' : ' + detail;
        if (ref !== null && !norm(l).includes('activite') && !norm(l).includes('page') && !PAGE.test(l)) l += ` (${ref}).`;
        line = withEnd(l);
      } else if (act !== null) {
        const what = `réaliser l’activité ${act}` + (page !== null ? `, page ${page}` : '');
        line = withEnd(askLine(what, what) + (detail !== null ? ' : ' + detail : ''));
      } else if (item.viaEar && body.length) {
        line = withEnd('Présenter l’étape : ' + lowerFirst(trimEndChars(shorten(clean(body[0])), '. ')));
      } else {
        // the slide only says how to work (« Travaillez seuls »): better than nothing when no activity is named
        const howOnly = pickConsigne(sl, body, true);
        if (howOnly) line = withEnd(capFirst(trimEndChars(shorten(polishConsigne(howOnly, false)), '. :')));
        else { silent = correction; line = null; } // a correction slide with nothing to say is simply left out, no warning
      }
      if (line !== null) {
        if (!order.includes(m)) order.push(m);
        if (!byMode.has(m)) byMode.set(m, []);
        const ml = byMode.get(m);
        const choices = correction ? [] : choicesOf(sl);
        const key = m + '|' + norm(line);
        if (replaceAt >= 0) {
          ml[replaceAt] = { line: '-' + line, choices };
          if (actKey !== null) seenAct.set(actKey, { index: replaceAt, rich: true });
        } else if (actKey === null && key === lastKey && !brokeBefore) {
          // the same slide shown again (animation): still the same activity
        } else {
          if (actKey !== null) seenAct.set(actKey, { index: ml.length, rich });
          ml.push({ line: '-' + line, choices });
        }
        lastKey = key;
        if (!correction) broke = false;
      } else if (!silent) {
        notes.push(`Consigne non trouvée (diapositive ${sl.number}).`);
        if (!unfound.has(m)) unfound.set(m, sl.number);
      }
    }
    // Outils de langue: what the notes ask the teacher during each practice (reflection time, justification, « ne pas corriger tout de suite »...)
    if (isOutils) {
      const extra = new Map();
      for (const item of items) {
        if (!item.pratique || isCorrection(item.slide)) continue;
        const m = item.mode || 'C';
        if (!(byMode.get(m) || []).length) continue;
        for (const nl of practiceNoteLines(item.slide)) { if (!extra.has(m)) extra.set(m, new Set()); extra.get(m).add(nl); }
      }
      for (const [m, set] of extra) {
        const have = byMode.get(m).map((x) => norm(x.line)).join(' ');
        const kept = [...set].filter((x) => !(norm(x).includes('justifi') && !x.includes('«') && have.includes('justifi'))).slice(0, 2);
        for (const nl of kept) byMode.get(m).push({ line: '-' + nl, choices: [] });
      }
    }
    // two activities with the same consigne are kept apart (told by their answers) or counted; never merged silently
    const resolve = (acts) => {
      const groups = new Map();
      for (const a of acts) { const k = norm(a.line); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
      const res = [];
      for (const g of groups.values()) {
        if (g.length === 1) { res.push(g[0].line); continue; }
        const keys = g.map((a) => a.choices.map(norm).join('|'));
        const base = trimEndChars(g[0].line, '. ');
        if (g.every((a) => a.choices.length >= 2) && new Set(keys).size === g.length) {
          for (const a of g) res.push(trimEndChars(a.line, '. ') + ' (' + a.choices.slice(0, 5).map(lowerFirst).join(', ') + ').');
        } else {
          const what = norm(base).includes('question') ? 'questions successives' : 'activités successives';
          res.push(`${base} (${g.length} ${what}).`);
        }
      }
      return res;
    };
    // a work mode whose consigne could not be read stays on the fiche, to be completed
    for (const [m, no] of unfound) {
      if (!(byMode.get(m) || []).length) {
        if (!order.includes(m)) order.push(m);
        if (!byMode.has(m)) byMode.set(m, []);
        byMode.get(m).push({ line: `-Consigne à compléter (diapositive ${no}).`, choices: [] });
      }
    }
    order.sort((a, b) => 'CBA'.indexOf(a) - 'CBA'.indexOf(b));
    const pgParas = [];
    for (const m of order) {
      pgParas.push(P(modeLabel(m), true));
      dedupeLines(resolve(byMode.get(m)), (dropped, kept) => {
        notes.push(`Consignes semblables regroupées : « ${trimStartChars(dropped, '-')} » → « ${trimStartChars(kept, '-')} ».`);
      }).slice(0, 4).forEach((t) => pgParas.push(P(t)));
    }
    // the general reading of the slides above found nothing to complain about: drop the warnings of the old one
    if (cdPara !== null) while (notes.length > notesMark) notes.pop();
    rows.push({ label: 'Pratiques guidées', paras: cdPara !== null ? cdPara : pgParas });
    if (cdPara === null && !items.some((x) => x.pratique)) notes.push(`Aucune diapositive de pratiques guidées pour « ${comp.name} ».`);

    // the time always comes from "Structure de la séance"
    blocs.push({ rows, duree: compDur.get(ci) || '' });
  });

  // opening
  const ouverture = ['-Déclaration des objectifs.', '-Annoncer le contrat de la classe.'];
  const ctrlEntry = list.find((x) => x[1] === Role.CONTROLE);
  const ctrl = ctrlEntry ? ctrlEntry[0] : null;
  if (ctrl !== null) {
    // homework check: the consigne of the homework, its number and its page
    const hw = [ctrl].concat(openSlides);
    let act = null; let page = null;
    for (const sl of hw) { const [a, p] = reference(sl); if (act === null) act = a; if (page === null) page = p; }
    const ref = refText(act, page);
    const consigne = consigneOf(hw);
    let l = '-Contrôle des devoirs';
    if (consigne !== null) {
      l += ' : ' + consigne;
      if (ref !== null && !norm(consigne).includes('activite')) l += ` (${ref})`;
    } else if (ref !== null) l += ' : ' + ref;
    ouverture.push(trimEndChars(l, '. ') + '.');
  } else if (isOutils) {
    // no homework: a preparatory activity or an informal discussion, only its consigne
    // Outils de langue: each slide of the activation has its own task (« le nom et l’adjectif », then « l’adjectif et sa place »)
    const seenPrep = new Set();
    for (const sl of openSlides) {
      const c = consigneOf([sl], true);
      if (c === null) continue;
      if (!seenPrep.has(norm(c))) { seenPrep.add(norm(c)); ouverture.push('-' + trimEndChars(c, '. ') + '.'); }
    }
    const seenNote = new Set();
    for (const sl of openSlides) for (const nl of practiceNoteLines(sl)) {
      if (seenNote.size < 2 && !seenNote.has(norm(nl))) { seenNote.add(norm(nl)); ouverture.push('-' + nl); }
    }
  } else {
    const prep = consigneOf(openSlides, true);
    if (prep !== null) ouverture.push('-' + trimEndChars(prep, '. ') + '.');
  }

  // closing
  const cloture = ['-Demander aux élèves de rappeler ce qu’ils ont appris.', '-Faire la synthèse de la séance.'];
  // then the homework / exercise sentence, if the PPT has one
  const closeEntry = sections.filter((x) => x.kind === 'close').flatMap((x) => x.slides).find((x) => x[1] === Role.DEVOIR);
  const anyEntry = list.find((x) => x[1] === Role.DEVOIR);
  const devoir = closeEntry ? closeEntry[0] : (anyEntry ? anyEntry[0] : null);
  if (devoir === null) {
    notes.push('Pas de devoir (« Travail à la maison ») dans le PPT : aucun devoir ajouté.');
  } else {
    const [act, page] = reference(devoir);
    if (act === null && page !== null) {
      // no activity number (normal for some homework): the page is enough
      cloture.push(`-Demander aux apprenants d’effectuer à la maison le travail de la page ${page} du livret. Il sera corrigé au début de la prochaine séance.`);
    } else if (act !== null) {
      cloture.push('-Demander aux apprenants d’effectuer à la maison l’activité ' + act + (page !== null ? ', p. ' + page : '') + ' du livret. Elle sera corrigée au début de la prochaine séance.');
    } else {
      const body = devoir.paras.filter((x) => x !== devoir.title && !isNoise(x));
      const ask = body[0];
      if (ask !== undefined) {
        const inf = trimEndChars(lowerFirst(clean(actionize(ask) || ask)), '. ');
        cloture.push('-Demander aux apprenants ' + (startsWithVowel(inf) ? 'd’' : 'de ') + inf + ' à la maison.');
      } else notes.push(`La diapositive du devoir (${devoir.number}) est vide : aucun devoir ajouté.`);
    }
  }

  // Compréhension détaillée: when the slide of the lesson and the weekly overview do not give the same objective,
  // the header shows the one of the lesson (the one the pupils hear)
  let headerObjectifs = f.objectifs;
  for (const comp of comps) {
    if (baseName(comp.name) !== 'Compréhension détaillée') continue;
    let banner = null;
    for (const s of comp.slides) { const b = objectiveBanner(s); if (b !== null) { banner = withEnd(capFirst(b)); break; } }
    if (banner === null) continue;
    const rep = repMine.find((x) => x.comp !== null && baseName(x.comp) === 'Compréhension détaillée');
    if (!rep) continue;
    const repText = withEnd(capFirst(clean(rep.text)));
    if (trimEndChars(norm(repText), '. ') === trimEndChars(norm(banner), '. ')) continue;
    if (headerObjectifs.includes(repText)) {
      headerObjectifs = headerObjectifs.map((x) => (x === repText ? banner : x));
      notes.push(`Objectif de la Compréhension détaillée : la diapositive de la leçon (« ${shorten(banner, 90)} ») diffère du repérage de la semaine (« ${shorten(repText, 90)} ») ; celui de la leçon est retenu.`);
    }
  }
  const data = {
    niveau: f.niveau, semestre: f.semestre, seance: f.seance, unite: f.unite,
    uniteTitre: f.uniteTitre, tache: f.tache, titre: f.titre, objectifs: headerObjectifs,
    ouverture, dureeOuverture: dOpen, blocs, cloture, dureeCloture: dClose,
    pages: f.pages || '', periode: f.periode || ''
  };
  // the pages written on the slide « Matériel » (« Livret de l’élève, p. 15 et p.16 ») must be in the pages of the header
  if (!isBlank(f.pages)) {
    const inHeader = new Set();
    for (const r of f.pages.matchAll(/(\d+)\s*[-–]\s*(\d+)/g)) {
      const x = parseInt(r[1], 10); const y = parseInt(r[2], 10);
      if (y >= x && y <= x + 20) for (let p = x; p <= y; p++) inHeader.add(p);
    }
    for (const r of f.pages.matchAll(/\d+/g)) inHeader.add(parseInt(r[0], 10));
    const material = new Set();
    for (const [sl] of list) for (const p of sl.paras) {
      if (!norm(p).includes('livret')) continue;
      const ci = p.indexOf(',');
      const after = ci < 0 ? p : p.slice(ci + 1);
      for (const r of after.matchAll(/\bp(?:ages?)?\.?\s*(\d{1,3})(?:\s*(?:et|,|-|–)\s*p?\.?\s*(\d{1,3}))?/gi)) {
        [r[1], r[2]].filter((x) => x).forEach((x) => material.add(parseInt(x, 10)));
      }
    }
    if (material.size && ![...material].every((x) => inHeader.has(x))) {
      notes.push('Pages : la diapositive « Matériel » indique ' + [...material].join(', ') + `, l’en-tête indique « ${f.pages} » — à vérifier.`);
    }
  }
  if (!f.tache) notes.push('Tâche finale non trouvée dans les diapositives de repérage.');
  if (!f.objectifs.length) notes.push('Objectifs non trouvés dans « Orientations didactiques ».');
  return { data, notes: [...new Set(notes)] };
}

const Sommaire = require('./sommaire');

module.exports = {
  norm, detect, build, roleOf, Role,
  // helpers, exported for the tests
  actionize, actionizeAny, polishConsigne, fromFirstPerson, sentencesToInfinitive, shorten, dedupeLines, imperativeToInfinitive,
  repairOcr, noteSentences, noteInstruction, cdStepName, cdSpeech, componentIn, parseDurations
};
