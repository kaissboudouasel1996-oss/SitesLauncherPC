'use strict';
// French -> Arabic translation of the texts of the screens, the menus and the PDFs. Works in Node and in the browser.
// The French sentence is the key; texts that are not in the table (names, book content, the French lesson documents) stay as they are.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.I18N_LIB = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const nk = (s) => s.replace(/’/g, "'").replace(/\s+/g, ' ').trim();
  const NOUNS = { 'élèves': { one: 'تلميذ واحد', two: 'تلميذان', few: 'تلاميذ', many: 'تلميذاً' } };

  function make(data) {
    const dict = data.dict;
    const rules = data.rules.map(([src, flags, tpl]) => [new RegExp(src, flags + (src.startsWith('^') ? '' : 'g')), tpl, src.startsWith('^')]);
    const days = data.days;
    const dateRe = new RegExp('\\b(' + Object.keys(days).join('|') + ')\\s+(\\d{1,2}|1er)\\s+(' + data.monthsFr.join('|') + ')\\s+(\\d{4})', 'gi');
    const monthRe = new RegExp('\\b(\\d{1,2}|1er)\\s+(' + data.monthsFr.join('|') + ')\\b', 'gi');

    function count(noun, n) {
      const f = NOUNS[noun];
      n = parseInt(n, 10);
      if (n === 1) return f.one; if (n === 2) return f.two;
      return n >= 3 && n <= 10 ? `${n} ${f.few}` : `${n} ${f.many}`;
    }

    function dates(s) {
      let out = s.replace(dateRe, (_m, d, day, mon, y) => `${days[d.toLowerCase()]} ${day === '1er' ? '1' : day} ${data.months[data.monthsFr.indexOf(mon.toLowerCase())]} ${y}`);
      out = out.replace(monthRe, (_m, day, mon) => `${day === '1er' ? '1' : day} ${data.months[data.monthsFr.indexOf(mon.toLowerCase())]}`);
      return out;
    }

    function lookup(core, depth) {
      const hit = dict[nk(core)];
      if (hit !== undefined) return hit;
      if (depth > 3) return null;
      for (const [re, tpl, anchored] of rules) {
        if (!anchored) { re.lastIndex = 0; if (re.test(core)) { re.lastIndex = 0; return core.replace(re, (...a) => fill(tpl, a.slice(1, -2), depth)); } continue; }
        const m = re.exec(core);
        if (!m) continue;
        if (tpl.startsWith('COUNT:')) { const [, noun, g] = tpl.split(':'); return count(noun, m[+g]); }
        return fill(tpl, m.slice(1), depth);
      }
      if (core.includes(' / ')) { // « Vocabulaire / Compréhension de l’oral »
        const parts = core.split(' / ').map((p) => lookup(p, depth + 1));
        if (parts.every((p) => p !== null)) return parts.join(' / ');
      }
      const d = dates(core);
      return d !== core ? d : null;
    }
    const fill = (tpl, groups, depth) => tpl.replace(/\$(\d)/g, (_m, i) => { const g = groups[+i - 1] || ''; const t = lookup(g, depth + 1); return t === null ? g : t; });

    /** The Arabic text, or the text itself when there is no translation. Spaces around it are kept. */
    function tr(s) {
      if (typeof s !== 'string' || !s) return s;
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
      if (!m[2]) return s;
      const t = lookup(m[2], 0);
      return t === null ? s : m[1] + t + m[3];
    }
    return { tr, dates };
  }
  return { make, nk };
}));
