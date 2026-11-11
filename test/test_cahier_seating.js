'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { CahierStore, SchoolDays, Cahier, fmtDate, addDays, bookUnit } = require('../src/cahier');
const T = require('../src/timetable');
const seating = require('../src/seating');
const { normalize } = require('../src/classes');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
const store = new CahierStore(dir);
const fresh = () => ({ days: {}, skipped: new Set(), manual: {} });
const tt = (cells) => { const t = T.normalize({}); Object.entries(cells).forEach(([k, v]) => { const [d, p] = k.split(',').map(Number); t.cells[d][p] = v; }); return t; };

// --- data converted from the Kotlin files
assert.strictEqual(bookUnit('1AC', 1).courses.length, 12);
assert.strictEqual(bookUnit('3AC', 10).courses.length, 12);
assert.strictEqual(bookUnit('1AC', 1).title, 'Ambiances du quotidien');
assert.strictEqual(fmtDate('2026-11-01'), 'dimanche 1er novembre 2026');
assert.strictEqual(fmtDate('2026-11-04'), 'mercredi 4 novembre 2026');

// --- reading a box of the timetable
assert.deepStrictEqual(Cahier.parse('3APIC-2\nSalle 10'), { key: '3APIC2', name: '3APIC-2' });
assert.strictEqual(Cahier.parse('1 APIC 3').key, '1APIC3');
assert.strictEqual(Cahier.parse('1APICb').key, '1APICB');
assert.strictEqual(Cahier.parse('Réunion'), null);

// --- holidays
assert.strictEqual(SchoolDays.holiday('2026-11-06').name, 'Anniversaire de la Marche verte');
assert.strictEqual(SchoolDays.holiday('2026-11-05'), null);
assert.strictEqual(SchoolDays.resumeAfter('2026-10-26'), '2026-12-14');
let st = fresh();
assert.ok(Cahier.isOff(st, '2026-11-06'));
st.days['2026-11-06'] = 'on';
assert.ok(!Cahier.isOff(st, '2026-11-06'));
st.days['2026-11-05'] = 'off';
assert.strictEqual(Cahier.offReason(st, '2026-11-05').name, 'Jour sans cours');

// --- position of a class: Mondays at the first hour
st = fresh();
const mon = tt({ '0,0': '1APIC3' });
const at = (d) => Cahier.sessions(mon, d)[0];
assert.strictEqual(Cahier.position(st, mon, at('2026-10-26')).n, 0);
assert.strictEqual(Cahier.position(st, mon, at('2026-11-02')).n, 1);
assert.strictEqual(Cahier.position(st, mon, at('2026-11-09')).n, 2);
assert.strictEqual(Cahier.position(st, mon, at('2026-12-07')), null, 'Monday of the break');
assert.strictEqual(Cahier.position(st, mon, at('2026-12-14')).n, 6, 'the break does not use a séance');
st.skipped.add('2026-10-26|0');
assert.strictEqual(Cahier.position(st, mon, at('2026-11-02')).n, 0, 'a session not held is taken over by the next');

// --- the lesson of a séance
st = fresh();
const i0 = Cahier.info(st, '1AC', 0);
assert.strictEqual(i0.unit, 1); assert.strictEqual(i0.seance, 1); assert.strictEqual(i0.periode, 1);
assert.strictEqual(i0.titles, 'Vocabulaire / Compréhension de l’oral');
assert.strictEqual(i0.pages, '6-7');
assert.ok(i0.tache && !i0.tache.missing);
assert.strictEqual(i0.objectifs.length, 2);
assert.strictEqual(Cahier.info(st, '1AC', 4).pages, '13-14-15');
assert.strictEqual(Cahier.info(st, '1AC', 2).pages, '10-11');
assert.strictEqual(Cahier.info(st, '1AC', 9).objectifs[0].text.startsWith('Consolider'), true);
assert.strictEqual(Cahier.info(st, '1AC', 100), null, 'program finished');
const txt = Cahier.asText(i0);
assert.ok(txt.startsWith('Période : 1\nUnité 1 : Ambiances du quotidien\nTâche finale :') && txt.includes('Séance 1 : Vocabulaire / Compréhension de l’oral\nObjectifs :\n• ') && txt.endsWith('Pages : 6-7'));
// séance 4 has no printed objective: it is to be completed, then learnt from a fiche, never overwritten
const s4 = Cahier.info(st, '3AC', 3);
assert.ok(s4.objectifs[0].missing || s4.objectifs[0].text);
if (s4.objectifs[0].missing) {
  assert.strictEqual(Cahier.learnFromFiche(st, '3APIC2', 'Unité 1', 'Séance 4', ['Comprendre en détail le texte']), 1);
  assert.strictEqual(Cahier.info(st, '3AC', 3).objectifs[0].text, 'Comprendre en détail le texte');
  assert.strictEqual(Cahier.learnFromFiche(st, '3AC', '1', '4', ['Autre']), 0);
}
Cahier.setManual(st, '1AC', 1, 'voc1', '  Mon objectif  ');
assert.strictEqual(Cahier.info(st, '1AC', 0).objectifs[0].text, 'Mon objectif');
Cahier.setManual(st, '1AC', 1, 'voc1', '');
assert.ok(Cahier.info(st, '1AC', 0).objectifs[0].text.startsWith('Employer'));

// --- revision days after two units (20 séances), up to the end of the next break
st = fresh();
const six = tt(Object.fromEntries([0, 1, 2, 3, 4, 5].map((d) => [`${d},0`, '1APIC3'])));
let day = SchoolDays.START; let firstRev = null; let lastRev = null;
for (let k = 0; k < 400; k++) {
  const s = Cahier.sessions(six, day)[0];
  const pos = s && Cahier.position(st, six, s);
  if (pos && pos.revision) { firstRev = firstRev || day; lastRev = day; assert.strictEqual(pos.n, 20); }
  if (firstRev && pos && !pos.revision) break; // only the first window (the second one comes after séance 40)
  day = addDays(day, 1);
}
assert.ok(firstRev && lastRev && lastRev <= '2026-12-13', 'revision stops when the break starts: ' + firstRev + ' ' + lastRev);
// séances 20..39 are taught between the two breaks; the 2nd window of revision then lasts until the mid-year break ends
const resumed = Cahier.sessions(six, '2026-12-14')[0];
assert.deepStrictEqual(Cahier.position(st, six, resumed), { n: 20, revision: false });
const afterBreak = Cahier.sessions(six, '2027-02-01')[0];
assert.deepStrictEqual(Cahier.position(st, six, afterBreak), { n: 40, revision: false });

// --- the board of the seating plan
st = fresh();
assert.ok(Cahier.boardText(st, mon, '1APIC3', '2026-10-26').startsWith('1APIC3  ·  08h - 09h\nPériode : 1'));
assert.ok(Cahier.boardText(st, mon, '1APIC3', '2026-10-27').endsWith('Pas de cours aujourd’hui.'));
assert.ok(Cahier.boardText(st, mon, '1APIC3', '2026-11-06').endsWith('Jour sans cours'));
assert.ok(Cahier.boardText(st, mon, 'Classe X', '2026-10-26').includes('1APIC3'));
st.skipped.add('2026-10-26|0');
assert.ok(Cahier.boardText(st, mon, '1APIC3', '2026-10-26').endsWith('Séance non assurée'));

// --- what the screen shows
st = fresh();
assert.strictEqual(Cahier.dayView(st, mon, '2026-09-01').status, 'before');
assert.strictEqual(Cahier.dayView(st, mon, '2026-11-06').status, 'off');
const dv = Cahier.dayView(st, mon, '2026-10-26');
assert.strictEqual(dv.slots.length, 1); assert.ok(dv.slots[0].sub.startsWith('Unité 1 · Séance 1')); assert.ok(dv.markable);
assert.ok(Cahier.dayView(st, T.normalize({}), '2026-10-26').ttEmpty);
const det = Cahier.detailView(st, mon, '2026-10-26', 0);
assert.strictEqual(det.unit, 1); assert.ok(det.tache.editable && !det.tache.manual); assert.strictEqual(det.objLabel, 'Objectifs :');
assert.strictEqual(Cahier.detailView(fresh(), tt({ '0,0': '2APIC1' }), '2026-10-26', 0), null, 'no program for level 2');

// --- file: the phone format is accepted
store.save({ days: { '2026-11-02': 'off' }, skipped: new Set(['2026-11-03|1']), manual: { '1AC|1|voc1': 'x' } });
const back = store.load();
assert.strictEqual(back.days['2026-11-02'], 'off'); assert.ok(back.skipped.has('2026-11-03|1')); assert.strictEqual(back.manual['1AC|1|voc1'], 'x');
assert.deepStrictEqual(new CahierStore(path.join(dir, 'none')).load().days, {});

// --- seating plan
const cl = normalize({ name: '1APIC3', header: ['Nom'], rows: [['A'], ['B'], [''], ['C']] });
assert.deepStrictEqual(seating.students(cl), [0, 1, 3]);
cl.seats[0] = 2; cl.seats[1] = 0; cl.seats[2] = 0; cl.seats[39] = 99;
assert.ok(seating.sanitize(cl));
assert.deepStrictEqual([cl.seats[0], cl.seats[1], cl.seats[2], cl.seats[39]], [-1, 0, -1, -1], 'empty row, doubles and unknown ids are forgotten');
seating.assign(cl, 5, 0); // student 0 moves from seat 1 to seat 5
assert.deepStrictEqual([cl.seats[1], cl.seats[5]], [-1, 0]);
seating.assign(cl, 6, 3);
seating.assign(cl, 6, 0); // swap: 0 goes to 6, 3 goes to 5
assert.deepStrictEqual([cl.seats[5], cl.seats[6]], [3, 0]);
assert.strictEqual(seating.assign(cl, 6, 0), false);
seating.assign(cl, 6, -1);
assert.strictEqual(cl.seats[6], -1);
seating.autoFill(cl);
assert.deepStrictEqual(cl.seats.slice(0, 4), [0, 1, 3, -1]);
const v = seating.view(cl);
assert.deepStrictEqual([v.placed, v.waiting, v.seats[2].label], [3, 0, 'C']);
assert.deepStrictEqual(seating.where(13), { row: 2, table: 2, side: 'droite' });
const big = normalize({ name: 'big', header: ['Nom'], rows: Array.from({ length: 45 }, (_, i) => ['E' + i]) });
seating.autoFill(big);
assert.strictEqual(seating.view(big).placed, 40); assert.strictEqual(seating.view(big).waiting, 5);
const html = seating.buildHtml(cl, '1APIC3\nSéance <1>');
assert.ok(html.includes('Rangée 4') && html.includes('Séance &lt;1&gt;') && html.includes('>C<'));
seating.clear(cl);
assert.strictEqual(seating.view(cl).placed, 0);
fs.writeFileSync(path.join(dir, 'plan.html'), seating.buildHtml(big, Cahier.boardText(fresh(), mon, '1APIC3', '2026-10-26')));
console.log('OUT_DIR=' + dir);
console.log('CAHIER+SEATING TESTS PASSED');
