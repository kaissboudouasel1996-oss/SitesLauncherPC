'use strict';
// The school books: one picture per page (p001.webp, p002.webp...) in a folder per book, like in the Android app.
// The pages come with the application (folder « books ») or are imported by the teacher; the reading position, the bookmarks and the tone are kept.
const fs = require('fs');
const path = require('path');

const DEFAULTS = [
  { id: '1ac', title: 'Je réussis pas à pas en Français', subtitle: '1ère AC' },
  { id: '3ac', title: 'Je réussis pas à pas en Français', subtitle: '3ème AC' }
];
const IMG = /\.(webp|png|jpe?g)$/i;
const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
const slug = (s) => String(s).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

class BookLibrary {
  /** userDir: where imported pages and the reading state are kept; bundledDir: the « books » folder shipped with the application (may be missing). */
  constructor(userDir, bundledDir) {
    this.userDir = userDir; this.bundledDir = bundledDir;
    this.stateFile = path.join(userDir, 'books-state.json');
  }

  state() {
    let o = {};
    try { o = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch (e) { /* new */ }
    return { tone: [0, 1, 2].includes(o.tone) ? o.tone : 0, last: o.last || {}, marks: o.marks || {}, extra: Array.isArray(o.extra) ? o.extra : [] };
  }
  save(st) {
    fs.mkdirSync(this.userDir, { recursive: true });
    const tmp = this.stateFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(st), 'utf8');
    fs.renameSync(tmp, this.stateFile);
  }

  known() { return DEFAULTS.concat(this.state().extra.filter((b) => b && b.id && !DEFAULTS.some((d) => d.id === b.id))); }
  find(id) { return this.known().find((b) => b.id === id) || null; }

  /** The page files of a book, in reading order. Imported pages win over those shipped with the application. */
  files(id) {
    if (!/^[a-z0-9_-]+$/.test(String(id))) return { dir: null, names: [] };
    for (const dir of [path.join(this.userDir, 'books', id), this.bundledDir && path.join(this.bundledDir, id)]) {
      if (!dir) continue;
      let names = [];
      try { names = fs.readdirSync(dir).filter((n) => IMG.test(n)).sort(natural); } catch (e) { /* not there */ }
      if (names.length) return { dir, names };
    }
    return { dir: null, names: [] };
  }
  pageCount(id) { return this.files(id).names.length; }
  fileFor(id, index) {
    const { dir, names } = this.files(id);
    if (!dir || !Number.isInteger(index) || index < 0 || index >= names.length) return null;
    return path.join(dir, names[index]);
  }

  /** The shelf. */
  list() {
    const st = this.state();
    return this.known().map((b) => {
      const pages = this.pageCount(b.id);
      return { id: b.id, title: b.title, subtitle: b.subtitle, pages, last: Math.min(Math.max(0, st.last[b.id] | 0), Math.max(0, pages - 1)), marks: (st.marks[b.id] || []).length, custom: !DEFAULTS.some((d) => d.id === b.id) };
    });
  }
  /** What the reader needs. */
  open(id) {
    const b = this.find(id);
    if (!b) return null;
    const st = this.state(); const pages = this.pageCount(id);
    if (!pages) return null;
    return { id, title: b.title, subtitle: b.subtitle, pages, last: Math.min(Math.max(0, st.last[id] | 0), pages - 1), marks: (st.marks[id] || []).slice().sort((a, c) => a - c), tone: st.tone };
  }

  setLast(id, index) {
    if (!this.find(id)) return false;
    const st = this.state(); st.last[id] = Math.max(0, index | 0); this.save(st); return true;
  }
  /** Adds or removes a bookmark. Returns true when the page is now bookmarked. */
  toggleMark(id, index) {
    const st = this.state(); const set = new Set(st.marks[id] || []);
    const now = !set.has(index);
    if (now) set.add(index); else set.delete(index);
    st.marks[id] = [...set].sort((a, b) => a - b); this.save(st); return now;
  }
  setTone(t) { const st = this.state(); st.tone = [0, 1, 2].includes(t) ? t : 0; this.save(st); return st.tone; }

  /** Copies page pictures (in the order of their names) as p001.ext, p002.ext... Replaces the pages already imported for this book. */
  importFiles(id, files) {
    if (!this.find(id)) throw new Error('Unknown book');
    const imgs = files.filter((f) => IMG.test(f)).sort((a, b) => natural(path.basename(a), path.basename(b)));
    if (!imgs.length) return 0;
    const dest = path.join(this.userDir, 'books', id);
    const tmp = dest + '.new';
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    imgs.forEach((f, i) => fs.copyFileSync(f, path.join(tmp, 'p' + String(i + 1).padStart(3, '0') + path.extname(f).toLowerCase().replace('.jpeg', '.jpg'))));
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    return imgs.length;
  }
  importFolder(id, dir) {
    const files = fs.readdirSync(dir).filter((n) => IMG.test(n)).map((n) => path.join(dir, n));
    return this.importFiles(id, files);
  }

  /** A book of the teacher's own (another level, an exercise book...). */
  addBook(title, subtitle) {
    const t = String(title || '').trim(); const s = String(subtitle || '').trim();
    if (!t) throw new Error('Title required');
    const st = this.state();
    let base = slug(s ? `${s}-${t}` : t) || 'livre'; let id = base;
    for (let i = 2; this.known().some((b) => b.id === id); i++) id = `${base}-${i}`;
    st.extra.push({ id, title: t, subtitle: s });
    this.save(st);
    return id;
  }
  /** Removes the imported pages. The books of the application stay on the shelf (they come back from the bundled pages, if any). */
  remove(id) {
    if (!/^[a-z0-9_-]+$/.test(id) || !this.find(id)) return false;
    fs.rmSync(path.join(this.userDir, 'books', id), { recursive: true, force: true });
    const st = this.state();
    delete st.last[id]; delete st.marks[id];
    if (!DEFAULTS.some((d) => d.id === id)) st.extra = st.extra.filter((b) => b.id !== id);
    this.save(st);
    return true;
  }

  /** What the book:// address of a page points to: { file, mime } or null. Nothing outside the books can be reached. */
  resolve(url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    if (u.protocol !== 'book:') return null;
    const id = u.hostname.toLowerCase();
    const m = /^\/(\d{1,5})$/.exec(u.pathname);
    if (!m || !this.find(id)) return null;
    const file = this.fileFor(id, parseInt(m[1], 10));
    return file ? { file, mime: MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream' } : null;
  }
}

module.exports = { BookLibrary, DEFAULTS, IMG };
