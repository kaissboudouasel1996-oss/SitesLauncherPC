'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { NoteStore, sorted } = require('../src/notes');
const T = require('../src/timetable');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-'));

// --- notes
const ns = new NoteStore(dir);
assert.deepStrictEqual(ns.load(), []);
const now = 1_800_000_000_000;
const a = ns.put({ title: 'Saisir les notes de CC', text: 'avant vendredi', remindAt: now + 3600_000 }, now);
const b = ns.put({ title: '', text: 'Appeler le parent de Salma\nplus tard', remindAt: 0 }, now);
assert.strictEqual(b.title, 'Appeler le parent de Salma'); // title taken from the first line, like the phone
assert.strictEqual(ns.put({ title: '', text: '' }, now), null);
const c = ns.put({ title: 'Réunion', remindAt: now - 1000 }, now); // already past
assert.deepStrictEqual(sorted(ns.load()).map((n) => n.title), ['Réunion', 'Saisir les notes de CC', 'Appeler le parent de Salma']);

assert.deepStrictEqual(ns.takeDue(now).map((n) => n.title), ['Réunion']);
assert.deepStrictEqual(ns.takeDue(now), [], 'a reminder rings once');
assert.deepStrictEqual(ns.takeDue(now + 3600_000).map((n) => n.title), ['Saisir les notes de CC']);
ns.put({ id: c.id, title: 'Réunion', remindAt: now + 7200_000 }, now); // new time: armed again
assert.deepStrictEqual(ns.takeDue(now + 7200_000).map((n) => n.title), ['Réunion']);
ns.setDone(a.id, true);
ns.put({ id: a.id, title: a.title, remindAt: now + 9e6 }, now);
assert.strictEqual(ns.load().find((n) => n.id === a.id).done, false, 'a new future reminder reopens the note');
ns.setDone(a.id, true);
assert.deepStrictEqual(ns.takeDue(now + 1e9).map((n) => n.title), [], 'done notes do not ring');
ns.remove(b.id);
assert.strictEqual(ns.load().length, 2);

// phone file is accepted as is
fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify([{ id: 'p1', title: 'Du téléphone', text: '', remindAt: 0, done: false }]));
assert.strictEqual(ns.load()[0].title, 'Du téléphone');

// --- timetable
const ts = new T.TimetableStore(dir);
const t0 = ts.load();
assert.strictEqual(t0.periods.length, 8);
assert.strictEqual(t0.cells.length, 6);
assert.ok(T.isEmpty(t0));
t0.cells[0][0] = '3APIC-2\nSalle 10';
t0.periods[7] = '17h - 18h30';
ts.save(t0);
const t1 = ts.load();
assert.strictEqual(t1.cells[0][0], '3APIC-2\nSalle 10');
assert.strictEqual(t1.periods[7], '17h - 18h30');
assert.ok(!T.isEmpty(t1));
// phone file with fewer cells is completed
fs.writeFileSync(path.join(dir, 'timetable.json'), JSON.stringify({ periods: ['08h - 09h'], cells: [['1APIC3']] }));
const t2 = ts.load();
assert.deepStrictEqual([t2.periods.length, t2.cells.length, t2.cells[0][0], t2.cells[5][0]], [1, 6, '1APIC3', '']);
const html = T.buildHtml(t1);
assert.ok(html.includes('Lundi') && html.includes('Samedi') && html.includes('3APIC-2<br>Salle 10'));
assert.ok(!T.buildHtml({ periods: ['<b>'], cells: [['<script>']] }).includes('<script>'));
fs.writeFileSync(path.join(dir, 'tt.html'), html);
console.log('OUT_DIR=' + dir);
console.log('NOTES+TIMETABLE TESTS PASSED');
