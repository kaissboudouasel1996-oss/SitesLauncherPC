'use strict';
const assert = require('assert');
const H = require('../src/holidays');
const C = require('../src/cahier');

assert.strictEqual(H.HOLIDAYS.length, 15);
// the calendar and the lesson log must agree on every holiday that has a date
C.SchoolDays.OFF.forEach((o) => {
  const x = H.HOLIDAYS.find((k) => k.name === o.name);
  assert.ok(x, 'missing in calendar: ' + o.name);
  if (x.start) assert.deepStrictEqual([x.start, x.end], [o.from, o.to], o.name);
});

const v = H.view('2026-11-04');
assert.strictEqual(v.items.length, 15);
assert.strictEqual(v.next.id, 'march'); // Unity Day (31 Oct) is past, Green March is next
assert.deepStrictEqual(v.next.status, { text: 'Dans 2 jours', kind: 'soon' });
assert.strictEqual(v.items[0].past, true);
assert.deepStrictEqual(H.view('2026-11-05').next.status, { text: 'Demain', kind: 'soon' });
assert.deepStrictEqual(H.view('2026-11-06').next.status, { text: 'En cours', kind: 'now' });
assert.strictEqual(H.view('2026-12-08').next.id, 'b2');
assert.strictEqual(H.view('2026-12-08').next.status.text, 'En cours');
assert.strictEqual(H.view('2027-12-01').next, null);
const adha = v.items.find((i) => i.id === 'adha');
assert.deepStrictEqual([adha.addable, adha.status, adha.dateText, adha.daysLabel], [false, null, 'Du 9 au 11 dhou al-hijja 1448', '3 jours']);
assert.strictEqual(v.items.find((i) => i.id === 'fitr').daysLabel, '3 ou 4 jours');
assert.strictEqual(v.items[0].dateText, 'Du dimanche 18 octobre 2026\nau dimanche 25 octobre 2026');
assert.strictEqual(v.items[1].dateText, 'samedi 31 octobre 2026');

// .ics
const one = H.ics(['b1'], new Date('2026-11-04T10:00:00Z'));
assert.ok(one.startsWith('BEGIN:VCALENDAR\r\n') && one.endsWith('END:VCALENDAR\r\n'));
assert.ok(one.includes('DTSTART;VALUE=DATE:20261018\r\n') && one.includes('DTEND;VALUE=DATE:20261026\r\n'), 'end day is exclusive');
assert.ok(one.includes('DTSTAMP:20261104T100000Z') && one.includes('SUMMARY:Première période de vacances intermédiaires'));
assert.strictEqual(H.ics(['adha']), null, 'no fixed date, nothing to add');
const all = H.ics(null);
assert.strictEqual((all.match(/BEGIN:VEVENT/g) || []).length, 12);
assert.ok(all.includes('SUMMARY:Anniversaire de la présentation du Manifeste de l’Indépendance'));
assert.ok(H.ics(['march']).includes('DTEND;VALUE=DATE:20261107'));
console.log('HOLIDAYS TESTS PASSED');
