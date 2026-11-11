'use strict';
// Notes & reminders. Same JSON layout as the Android app (id, title, text, remindAt in ms, done); "fired" is a PC-only extra.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function normalize(o) {
  return {
    id: o.id || crypto.randomUUID(), title: String(o.title || ''), text: String(o.text || ''),
    remindAt: Number(o.remindAt) > 0 ? Number(o.remindAt) : 0, done: !!o.done, fired: !!o.fired
  };
}

class NoteStore {
  constructor(dir) { this.file = path.join(dir, 'notes.json'); }
  load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')).map(normalize); } catch (e) { return []; } }
  save(list) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list), 'utf8');
    fs.renameSync(tmp, this.file);
  }
  /** Creates or replaces a note. A new reminder in the future is armed again and the note is open again. */
  put(data, now = Date.now()) {
    const list = this.load();
    let title = String(data.title || '').trim();
    const text = String(data.text || '').trim();
    if (!title) title = (text.split(/\r?\n/)[0] || '').slice(0, 40);
    if (!title) return null;
    const remindAt = Number(data.remindAt) > 0 ? Number(data.remindAt) : 0;
    let n = data.id ? list.find((x) => x.id === data.id) : null;
    if (!n) { n = normalize({ title }); list.push(n); }
    if (n.remindAt !== remindAt) n.fired = false;
    n.title = title; n.text = text; n.remindAt = remindAt;
    if (remindAt > now) { n.done = false; n.fired = false; }
    this.save(list);
    return n;
  }
  setDone(id, done) {
    const list = this.load(); const n = list.find((x) => x.id === id);
    if (!n) return null;
    n.done = !!done; this.save(list); return n;
  }
  remove(id) { this.save(this.load().filter((n) => n.id !== id)); }
  /** Reminders whose time has come and that were not shown yet; they are marked as shown. */
  takeDue(now = Date.now()) {
    const list = this.load();
    const due = list.filter((n) => !n.done && !n.fired && n.remindAt > 0 && n.remindAt <= now);
    if (due.length) { due.forEach((n) => { n.fired = true; }); this.save(list); }
    return due;
  }
}

/** Open notes first, then by reminder time (notes without reminder last), like the phone. */
function sorted(list) {
  return list.slice().sort((a, b) => (a.done - b.done) || ((a.remindAt || Infinity) - (b.remindAt || Infinity)) || 0);
}

module.exports = { NoteStore, sorted, normalize };
