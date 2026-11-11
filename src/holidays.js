'use strict';
// School holidays 2026-2027 (official table). Port of CalendarActivity.kt; adding to a calendar is done with an .ics file.
const { fmtDate, addDays } = require('./cahier');

const h = (id, name, icon, start, end, days, extra = {}) => Object.assign({ id, name, icon, start, end: end || start, days }, extra);
const HOLIDAYS = [
  h('b1', 'Première période de vacances intermédiaires', '🏖️', '2026-10-18', '2026-10-25', 8),
  h('unity', 'Fête de l’Unité', '🇲🇦', '2026-10-31', null, 1),
  h('march', 'Anniversaire de la Marche verte', '🇲🇦', '2026-11-06', null, 1),
  h('indep', 'Fête de l’Indépendance', '🇲🇦', '2026-11-18', null, 1),
  h('b2', 'Deuxième période de vacances intermédiaires', '🏖️', '2026-12-06', '2026-12-13', 8),
  h('ny', 'Nouvel An (1er janvier)', '🎆', '2027-01-01', null, 1),
  h('manifesto', 'Anniversaire de la présentation du Manifeste de l’Indépendance', '🇲🇦', '2027-01-11', null, 1),
  h('amazigh', 'Nouvel An amazigh', '🌾', '2027-01-14', null, 1),
  h('mid', 'Vacances de mi-année scolaire', '🏖️', '2027-01-24', '2027-01-31', 8),
  h('fitr', 'Aïd al-Fitr', '🌙', null, null, 0, { hijri: 'Du 29 ramadan au 2 chawwal 1448', daysText: '3 ou 4 jours' }),
  h('b3', 'Troisième période de vacances intermédiaires', '🏖️', '2027-03-21', '2027-03-28', 8),
  h('labour', 'Fête du Travail', '🛠️', '2027-05-01', null, 1),
  h('b4', 'Quatrième période de vacances intermédiaires', '🏖️', '2027-05-09', '2027-05-16', 8),
  h('adha', 'Aïd al-Adha', '🐑', null, null, 3, { hijri: 'Du 9 au 11 dhou al-hijja 1448' }),
  h('hijri', 'Nouvel An de l’Hégire (1er mouharram)', '🌙', null, null, 1, { hijri: '1er mouharram 1449' })
];
const NOTE = 'Les dates des fêtes religieuses dépendent de l’observation de la lune : elles sont confirmées peu avant.';

const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

function statusOf(x, today) {
  if (!x.start) return null;
  if (today > x.end) return { text: 'Terminée', kind: 'past' };
  if (today >= x.start) return { text: 'En cours', kind: 'now' };
  const n = diffDays(today, x.start);
  return { text: n === 1 ? 'Demain' : `Dans ${n} jours`, kind: 'soon' };
}

function dateText(x) {
  if (x.hijri) return x.hijri;
  return x.start === x.end ? fmtDate(x.start) : `Du ${fmtDate(x.start)}\nau ${fmtDate(x.end)}`;
}
const daysLabel = (x) => x.daysText || (x.days === 1 ? '1 jour' : `${x.days} jours`);

function view(today) {
  const items = HOLIDAYS.map((x) => ({
    id: x.id, name: x.name, icon: x.icon, dateText: dateText(x), daysLabel: daysLabel(x), status: statusOf(x, today),
    past: !!x.end && today > x.end, addable: !!x.start
  }));
  const next = HOLIDAYS.find((x) => x.end && today <= x.end);
  return { items, next: next ? items.find((i) => i.id === next.id) : null, note: NOTE };
}

const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const compact = (d) => d.replace(/-/g, '');

/** An .ics calendar file (all-day events) for the holidays with a fixed date. [ids] = null means all of them. */
function ics(ids, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const list = HOLIDAYS.filter((x) => x.start && (!ids || ids.includes(x.id)));
  if (!list.length) return null;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Madrassa//Vacances scolaires//FR', 'CALSCALE:GREGORIAN'];
  list.forEach((x) => {
    lines.push('BEGIN:VEVENT', `UID:${x.id}-2026-2027@siteslauncher`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(x.start)}`, `DTEND;VALUE=DATE:${compact(addDays(x.end, 1))}`,
      `SUMMARY:${icsEscape(x.name)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

module.exports = { HOLIDAYS, view, ics, statusOf };
