'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const ocr = require('../src/ocr');
const TT = require('../src/timetable_ocr');
const { BookConsigne, pageList, activities } = require('../src/book_consigne');
const { BookLibrary } = require('../src/books');

// ---- the answer of the Windows text recognition (JSON from PowerShell)
const win = ocr.parseWindowsResult('\uFEFF{"width":800,"height":600,"lang":"fr","words":[{"t":"Salle","x":10.5,"y":20,"w":40,"h":12,"l":0},{"t":"10","x":55,"y":20,"w":15,"h":12,"l":0}]}');
assert.deepStrictEqual(win.words, [{ text: 'Salle', left: 10.5, top: 20, right: 50.5, bottom: 32, line: 0 }, { text: '10', left: 55, top: 20, right: 70, bottom: 32, line: 0 }]);
assert.strictEqual(ocr.parseWindowsResult('{"width":1,"height":1,"lang":"fr","words":{"t":"seul","x":1,"y":2,"w":3,"h":4,"l":0}}').words.length, 1, 'PowerShell turns a one-item list into an object');
assert.strictEqual(ocr.parseWindowsResult('{"width":1,"height":1,"lang":"fr","words":[]}').words.length, 0);
assert.throws(() => ocr.parseWindowsResult('{"error":"no-language"}'), { code: 'OCR_NO_LANGUAGE' });
assert.throws(() => ocr.parseWindowsResult('{"error":"too-large"}'), { code: 'OCR_TOO_LARGE' });
assert.throws(() => ocr.parseWindowsResult('not json'), { code: 'OCR_FAILED' });
assert.ok(ocr.PS_SCRIPT.includes('Windows.Media.Ocr.OcrEngine') && ocr.PS_SCRIPT.includes('TryCreateFromUserProfileLanguages') && ocr.PS_SCRIPT.includes('MaxImageDimension'));
const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t10\t20\t40\t12\t90\tSalle\n5\t1\t1\t1\t1\t2\t55\t20\t15\t12\t90\t10\n4\t1\t1\t1\t1\t0\t10\t20\t60\t12\t-1\t\n5\t1\t1\t1\t2\t1\t10\t60\t30\t12\t-1\t\n';
assert.deepStrictEqual(ocr.parseTesseractTsv(tsv).words.map((w) => w.text), ['Salle', '10']);

// ---- words -> text boxes: cut at wide gaps, Arabic read from the right
const w = (text, left, top, line, wd = 50) => ({ text, left, top, right: left + wd, bottom: top + 20, line });
const lines = ocr.toLines([w('3APIC-2', 100, 100, 1), w('1APIC3', 600, 100, 1), w('Salle', 100, 130, 2, 40), w('10', 150, 130, 2, 20), w('عربي', 300, 300, 3), w('نص', 360, 300, 3)]);
assert.deepStrictEqual(lines.map((l) => l.text), ['3APIC-2', '1APIC3', 'Salle 10', 'نص عربي'], 'two cells side by side are two texts; Arabic is read from right to left');
assert.deepStrictEqual([lines[2].left, lines[2].right, lines[2].top, lines[2].bottom], [100, 170, 130, 150]);

// ---- the timetable from what was read (geometry like a real photo: 8 hour columns, rows of 150 px)
const L = (text, cxm, cym) => ({ text, left: cxm - 55, right: cxm + 55, top: cym - 14, bottom: cym + 14 });
const hours = ['08h - 09h', '09h - 10h', '10h - 11h', '11h - 12h', '14h - 15h', '15h - 16h', '16h - 17h', '17h - 18h'];
const colX = (i) => 340 + i * 215; const rowY = (r) => 260 + r * 150;
const head = hours.map((h, i) => L(h, colX(i), 100));
const day = (r, name) => L(name, 110, rowY(r));
const cell = (r, c, cls, room) => [L(cls, colX(c), rowY(r) - 18), L(room, colX(c), rowY(r) + 20)];
let photo = head.concat(['Lundi', 'Mardi', 'Mercredi'].map((n, r) => day(r, n)), cell(0, 0, '3APIC-2', '10 ةعاقلا'), cell(0, 3, 'lAPIC3', 'Salle 4'), cell(1, 1, '3APIC-1', 'Salle 12'), cell(2, 5, 'IAPIC1', 'cll| 7'));
let t = TT.build(photo, 2000, 1100, false);
assert.ok(t && t.periods.length === 8 && t.periods[4] === '14h - 15h');
assert.strictEqual(t.cells[0][0], '3APIC-2\nSalle 10', 'the Arabic word of a room is read as noise: only the number is kept');
assert.strictEqual(t.cells[0][3], '1APIC3\nSalle 4', 'lAPIC3 is 1APIC3');
assert.strictEqual(t.cells[1][1], '3APIC-1\nSalle 12');
assert.strictEqual(t.cells[2][5], '1APIC1\nSalle 7');
assert.strictEqual(t.cells.flat().filter(Boolean).length, 4);
assert.ok(TT.hasHeadings(photo));
// two readable headings are enough: all eight columns are placed from them
const partial = photo.filter((l) => !/^(09h|10h|11h|14h|16h|17h)/.test(l.text));
t = TT.build(partial, 2000, 1100, false); assert.strictEqual(t.cells[2][5], '1APIC1\nSalle 7'); assert.strictEqual(t.cells[0][3], '1APIC3\nSalle 4');
// a day without a class between two others keeps its place
// (the gaps are measured against the closest two rows, like on the phone: a free day is found when two days follow each other somewhere)
photo = head.concat(cell(0, 0, '3APIC-2', 'Salle 10'), cell(1, 1, '3APIC-1', 'Salle 12'), cell(3, 0, '3APIC-2', 'Salle 10'), cell(5, 6, '1APIC3', 'Salle 4'));
t = TT.build(photo, 2000, 1100, false); assert.deepStrictEqual(t.cells.map((r) => r.some(Boolean)), [true, true, false, true, false, true], 'free days keep their place');
// no heading could be read: the picture is the table, and the side of the days matters
const noHead = [L('3APIC-2', 2000 - 150 - 215 * 0.5 - 215 * 0 - 130, 330)];
assert.ok(!TT.hasHeadings(noHead));
const ltr = TT.build([L('3APIC-2', 300, 330), L('Salle 10', 300, 366)], 2000, 1100, false); const rtl = TT.build([L('3APIC-2', 2000 - 300, 330), L('Salle 10', 2000 - 300, 366)], 2000, 1100, true);
assert.ok(ltr && rtl && ltr.cells.flat().some((c) => c.startsWith('3APIC-2')) && rtl.cells.flat().some((c) => c.startsWith('3APIC-2')));
assert.deepStrictEqual(ltr.cells.map((r) => r.findIndex(Boolean)), rtl.cells.map((r) => r.findIndex(Boolean)), 'the same table, seen from the other side');
assert.strictEqual(TT.build([], 100, 100, false), null);
assert.strictEqual(TT.build(head, 2000, 1100, false), null, 'headings only: no class');
assert.strictEqual(TT.build(head.concat([L('Salle 10', colX(0), 300)]), 2000, 1100, false, 'قاعة').cells.flat().find(Boolean), 'قاعة 10', 'the word for a room follows the language');

// ---- the pictures of a real photo read by Tesseract (development machines only: it is not needed to use the application)
let haveTesseract = true; try { execFileSync('tesseract', ['--version'], { stdio: 'ignore' }); } catch (e) { haveTesseract = false; }
if (haveTesseract) {
  (async () => {
    const r = await ocr.recognize(path.join(__dirname, 'fixtures', 'timetable_photo.png'));
    const table = TT.build(ocr.toLines(r.words), 2000, 1100, false);
    const at = (row, col) => (table.cells[row][col] || '').replace('\n', '/');
    assert.ok(/3APIC-2\/Salle 10/.test(at(0, 0)) && /APIC3\/Salle 4/.test(at(0, 3)) && /3APIC-1\/Salle 12/.test(at(1, 1)) && /2APIC1\/Salle 7/.test(at(2, 5)) && /3APIC-2\/Salle 10/.test(at(3, 0)) && /APIC3\/Salle 4/.test(at(4, 6)) && /3APIC-1\/Salle 12/.test(at(5, 2)), 'read by Tesseract: ' + JSON.stringify(table.cells));
    console.log('(photo read by Tesseract: 7 courses in the right boxes)');
  })().catch((e) => { console.error(e); process.exit(1); });
}

// ---- the consigne of an activity, read in the page of the book
assert.deepStrictEqual(pageList('8'), [8]); assert.deepStrictEqual(pageList('10-11'), [10, 11]); assert.deepStrictEqual(pageList('10-11, 13'), [10, 11, 13]);
assert.deepStrictEqual(pageList('4 et 6'), [4, 6]); assert.deepStrictEqual(pageList(''), []); assert.deepStrictEqual(pageList(null), []); assert.deepStrictEqual(pageList('1-20'), [1]);
const B = (text, left, top, w = 400) => ({ text, left, top, right: left + w, bottom: top + 24 });
const page = [B('Activité 1', 60, 100, 160), B('Observe les images et relie chaque phrase', 240, 100, 700), B('à la bonne image.', 240, 130, 300),   // two rows
  B('Activité 2 Souligne les verbes conjugués.', 60, 400, 800), B('Activité 3', 60, 700, 160), B('Oui', 240, 700, 40), B('Page 12', 500, 1000, 100), B('Activités 4 Écris', 60, 800, 300)];
const acts = activities(page);
assert.strictEqual(acts.get('1'), 'Observe les images et relie chaque phrase à la bonne image.', 'label on its own, the consigne to its right, a second row below');
assert.strictEqual(acts.get('2'), 'Souligne les verbes conjugués.', 'label and consigne in one line');
assert.ok(!acts.has('3'), 'too short to be a consigne');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-'));
const lib = new BookLibrary(path.join(dir, 'user'), path.join(dir, 'bundled'));
fs.mkdirSync(path.join(dir, 'bundled', '3ac'), { recursive: true });
for (let i = 1; i <= 20; i++) fs.writeFileSync(path.join(dir, 'bundled', '3ac', `p${String(i).padStart(3, '0')}.webp`), 'img' + i);
let reads = []; const reader = async (file) => { reads.push(path.basename(file)); return /p007|p008/.test(file) ? page : []; };
const bc = new BookConsigne({ library: lib, dir, recognize: reader });
(async () => {
  assert.strictEqual(bc.bookId('3AC'), '3ac'); assert.strictEqual(bc.bookId('1AC'), null, 'book without pages'); assert.strictEqual(bc.bookId('xx'), null);
  assert.strictEqual(bc.find('3AC', '1', '7'), null, 'nothing is read until prefetch');
  const r1 = await bc.prefetch('3AC', [7, 8, 7, 99, 0]);
  assert.deepStrictEqual([r1.read, r1.failed, reads], [2, false, ['p007.webp', 'p008.webp']], 'each existing page once');
  await bc.prefetch('3AC', [7, 8]); assert.strictEqual(reads.length, 2, 'a page read once is kept');
  assert.ok(fs.existsSync(path.join(dir, 'book_ocr_v1', '3ac', 'p007.tsv')));
  assert.strictEqual(new BookConsigne({ library: lib, dir, recognize: reader }).find('3AC', '1', '7'), 'Observe les images et relie chaque phrase à la bonne image.', 'kept between launches');
  assert.strictEqual(bc.find('3AC', '2', '7-8'), null, 'the same activity on both pages: not sure, so nothing is invented');
  assert.strictEqual(bc.find('3AC', '2', '7'), 'Souligne les verbes conjugués.');
  assert.strictEqual(bc.find('3AC', '9', '7'), null);
  assert.strictEqual(bc.find('3AC', null, '8'), null, 'without an activity number: only when the page has a single consigne');
  const r2 = await bc.prefetch('3AC', [9]); assert.strictEqual(r2.read, 1); assert.strictEqual(bc.cached('3ac', 9).length, 0, 'a page without text is kept as read');
  // the text recognition fails: say so, do not loop
  const bad = new BookConsigne({ library: lib, dir: path.join(dir, 'other'), recognize: async () => { throw new ocr.OcrError('x', 'OCR_NO_LANGUAGE'); } });
  const r3 = await bad.prefetch('3AC', [3, 4, 5]); assert.deepStrictEqual([r3.failed, r3.read, bad.readerFailed], [true, 0, true]);
  console.log('OCR TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
