'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { writeZip } = require('../src/zip');
const sheet = require('../src/sheet');
const { ClassStore, defaultYear } = require('../src/classes');
const suivi = require('../src/suivi');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classes-'));

// --- an Excel file like the Massar export: title lines, then the header, then the students, with marks columns to ignore
const names = [['AMRANI', 'Yassine'], ['BENALI', 'Salma'], ['CHAKIR', 'Omar'], ['الإدريسي', 'ليلى'], ['EL FASSI', 'Nour']];
const strings = [];
const sid = (s) => { let i = strings.indexOf(s); if (i < 0) { strings.push(s); i = strings.length - 1; } return i; };
const cellS = (ref, s) => `<c r="${ref}" t="s"><v>${sid(s)}</v></c>`;
let rowsXml = `<row r="1">${cellS('A1', 'Liste de la classe 3APIC-2')}</row>`;
rowsXml += `<row r="3">${cellS('A3', 'Code Massar')}${cellS('B3', 'Nom')}${cellS('C3', 'Prénom')}${cellS('E3', 'Note contrôle 1')}</row>`;
names.forEach((n, i) => {
  const r = 4 + i;
  // column D is left empty on purpose: cells must land in the right columns
  rowsXml += `<row r="${r}">${cellS('A' + r, 'G13000' + (100 + i))}${cellS('B' + r, n[0])}${cellS('C' + r, n[1])}<c r="E${r}"><v>12</v></c></row>`;
});
const xlsx = writeZip([
  ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
  ['xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Liste" sheetId="1"/></sheets></workbook>'],
  ['xl/sharedStrings.xml', `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`],
  ['xl/worksheets/sheet1.xml', `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`]
]);
// sharedStrings is built while rows are generated, so it is written after (see order above)
const fx = path.join(dir, 'massar.xlsx');
fs.writeFileSync(fx, xlsx);

const r1 = sheet.loadRoster(fx);
console.log('xlsx header:', r1.header, 'students:', r1.rows.length);
assert.deepStrictEqual(r1.header, ['Code Massar', 'Nom', 'Prénom']);
assert.strictEqual(r1.rows.length, 5);
assert.deepStrictEqual(r1.rows[0], ['G13000100', 'AMRANI', 'Yassine']);
const cl = { header: r1.header, rows: r1.rows };
assert.strictEqual(sheet.studentName(cl, 1), 'BENALI Salma');

// --- CSV with ; and quotes
const csv = path.join(dir, 'liste.csv');
fs.writeFileSync(csv, '\uFEFFN°;Nom;Prénom\n1;"DUPONT, Jr";Paul\n2;MARTIN;Anne\n');
const r2 = sheet.loadRoster(csv);
assert.strictEqual(r2.rows.length, 2);
assert.strictEqual(r2.rows[0][1], 'DUPONT, Jr');

// --- "Excel" that is really a web page
const htm = path.join(dir, 'export.xls');
fs.writeFileSync(htm, '<html><body><table><tr><td>Code</td><td>Nom</td></tr><tr><td>A1</td><td>Ali &amp; Co</td></tr><tr><td>A2</td><td>Sara</td></tr></table></body></html>');
const r3 = sheet.loadRoster(htm);
assert.strictEqual(r3.rows[0][1], 'Ali & Co');

// --- store
const store = new ClassStore(path.join(dir, 'data'));
assert.deepStrictEqual(store.load(), []);
const c = store.add({ name: '3APIC-2', header: r1.header, rows: r1.rows, year: defaultYear() });
c.track[0] = ['++-+', '+-', 'Participe bien'];
c.subject = 'French language';
store.update(c);
const back = store.find(c.id);
assert.deepStrictEqual(back.track[0], ['++-+', '+-', 'Participe bien']);
assert.strictEqual(back.seats.length, 40);
assert.strictEqual(back.seats[0], -1);
assert.strictEqual(defaultYear(new Date(2026, 10, 4)), '2026/2027');
assert.strictEqual(defaultYear(new Date(2027, 2, 4)), '2026/2027');

// --- the Android file format is accepted as is
const droid = [{ id: 'x1', name: '1APIC3', header: ['Nom'], rows: [['A'], ['B']], subject: '', school: '', direction: '', year: '2026/2027', track: [['+', '-', '']], seats: Array(40).fill(-1) }];
fs.writeFileSync(path.join(dir, 'data', 'classes.json'), JSON.stringify(droid));
assert.strictEqual(store.load()[0].track.length, 2);
store.remove('x1');
assert.strictEqual(store.load().length, 0);

// --- marks sheet: readable again, formulas in place, Arabic detected
const grades = require('../src/grades');
const gx = path.join(dir, 'notes.xlsx');
fs.writeFileSync(gx, grades.build(r1.header, r1.rows, 3));
const gs = sheet.xlsxSheets(gx)[0].rows;
assert.deepStrictEqual(gs[0], ['Code Massar', 'Nom', 'Prénom', 'CC1', 'CC2', 'CC3', 'Moyenne']);
assert.strictEqual(gs.length, 7); // header + 5 students + class average
assert.strictEqual(gs[1][1], 'AMRANI');
assert.strictEqual(gs[6][0], 'Moyenne de la classe');
const gz = new (require('../src/zip').ZipReader)(gx);
const sx = gz.readText('xl/worksheets/sheet1.xml');
assert.ok(sx.includes('<f>IF(COUNT(D2:F2)=0,"",ROUND(AVERAGE(D2:F2),2))</f>') && sx.includes('sqref="D2:F6"') && sx.includes('rightToLeft') === false);
gz.close();
assert.strictEqual(grades.colName(26), 'AA');

// --- the PDF page
const big = { name: '3APIC-2', year: '2026/2027', subject: 'French language', subjectLabel: 'Langue française', school: 'Collège Pionnier Rif', direction: 'Nador',
  header: ['Nom'], rows: Array.from({ length: 58 }, (_, i) => ['Élève numéro ' + (i + 1)]),
  track: Array.from({ length: 58 }, (_, i) => [i % 3 === 0 ? '+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-' : '++-', '+-+', i === 5 ? 'Très bavard, à revoir avec les parents en fin de mois' : '']) };
const html = suivi.buildHtml(big, '');
const pageCount = (html.match(/class="page"/g) || []).length;
console.log('fiche de suivi pages:', pageCount);
assert.ok(pageCount >= 2 && pageCount <= 3);
assert.ok(html.includes('Fiche de suivi') && html.includes('Langue française') && html.includes('Élève numéro 58'));
assert.ok(html.includes('Élève numéro 60') === false && html.includes('>60<'), 'two empty numbered lines at the end');
assert.ok(!/<script/i.test(suivi.buildHtml({ ...big, school: '<script>x</script>' }, '')), 'text is escaped');
fs.writeFileSync(path.join(dir, 'suivi.html'), html);
console.log('OUT_DIR=' + dir);
console.log('CLASSES TESTS PASSED');
