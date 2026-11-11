'use strict';
// Class lists kept on the PC. Same JSON layout as the Android app (classes.json), so a backup can be shared later.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SEAT_COUNT = 40;
const MAX_MARKS = 50;

function normalize(o) {
  const rows = (o.rows || []).map((r) => r.map((c) => String(c == null ? '' : c)));
  const track = rows.map((_, i) => {
    const t = (o.track || [])[i] || [];
    return [String(t[0] || '').replace(/[^+\-]/g, '').slice(0, MAX_MARKS), String(t[1] || '').replace(/[^+\-]/g, '').slice(0, MAX_MARKS), String(t[2] || '')];
  });
  const seats = Array.from({ length: SEAT_COUNT }, (_, i) => ((o.seats || [])[i] | 0) || ((o.seats || [])[i] === 0 ? 0 : -1));
  return {
    id: o.id || crypto.randomUUID(), name: String(o.name || ''), header: (o.header || []).map(String), rows,
    subject: o.subject || '', school: o.school || '', direction: o.direction || '', year: o.year || '', track, seats
  };
}

function defaultYear(d = new Date()) {
  const y = d.getFullYear();
  const start = d.getMonth() >= 7 ? y : y - 1;
  return `${start}/${start + 1}`;
}

class ClassStore {
  constructor(dir) { this.file = path.join(dir, 'classes.json'); }
  load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')).map(normalize); } catch (e) { return []; }
  }
  save(list) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list), 'utf8');
    fs.renameSync(tmp, this.file);
  }
  find(id) { return this.load().find((c) => c.id === id) || null; }
  add(cl) { const l = this.load(); const c = normalize(cl); l.push(c); this.save(l); return c; }
  update(cl) {
    const l = this.load(); const i = l.findIndex((c) => c.id === cl.id);
    if (i < 0) return null;
    l[i] = normalize(cl); this.save(l); return l[i];
  }
  remove(id) { this.save(this.load().filter((c) => c.id !== id)); }
}

module.exports = { ClassStore, normalize, defaultYear, SEAT_COUNT, MAX_MARKS };
