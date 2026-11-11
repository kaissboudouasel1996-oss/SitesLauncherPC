'use strict';
// Tiny streaming XML tokenizer. Calls h.open(localName, attrs, selfClosing), h.close(localName), h.text(str).
// Names and attribute names are returned without their namespace prefix.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === '#') {
      const cp = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch (e) { return m; }
    }
    return ENT[g] !== undefined ? ENT[g] : m;
  });
}

const local = (n) => { const i = n.indexOf(':'); return i < 0 ? n : n.slice(i + 1); };

function parse(xml, h) {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { if (h.text) h.text(decode(xml.slice(i))); break; }
    if (lt > i && h.text) h.text(decode(xml.slice(i, lt)));
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      if (h.text) h.text(xml.slice(lt + 9, e < 0 ? n : e));
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') { const e = xml.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    if (xml[lt + 1] === '/') {
      const e = xml.indexOf('>', lt);
      if (h.close) h.close(local(xml.slice(lt + 2, e).trim()));
      i = e + 1;
      continue;
    }
    // start tag: find the closing '>' that is not inside quotes
    let j = lt + 1;
    let q = null;
    while (j < n) {
      const c = xml[j];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
      j++;
    }
    let body = xml.slice(lt + 1, j);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1);
    const sp = body.search(/\s/);
    const name = sp < 0 ? body : body.slice(0, sp);
    const attrs = {};
    if (sp >= 0) {
      const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let m;
      const rest = body.slice(sp);
      while ((m = re.exec(rest))) attrs[local(m[1])] = decode(m[3] !== undefined ? m[3] : m[4]);
    }
    if (h.open) h.open(local(name), attrs, selfClosing);
    if (selfClosing && h.close) h.close(local(name));
    i = j + 1;
  }
}

module.exports = { parse, decode };
