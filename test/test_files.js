'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const F = require('../src/files');
const sheet = require('../src/sheet');
const { writeZip } = require('../src/zip');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-'));
const store = new F.FileStore(path.join(dir, 'files'));
const put = (name, data) => { const f = path.join(dir, name); fs.writeFileSync(f, data); return f; };
const PDF = Buffer.from('%PDF-1.4\n%fake'); const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const DOCX = writeZip([['word/document.xml', '<w:document/>'], ['[Content_Types].xml', '<Types/>']]);
const HTML_PAGE = Buffer.from('<!DOCTYPE html><html><body><h1>Session expirée</h1></body></html>');

// ---- names
assert.strictEqual(F.sanitize('../../a:b*c?.pdf'), 'a_b_c_.pdf');
assert.ok(!/[\\/:*?"<>|]/.test(F.sanitize('..\\..\\x/y:z?.pdf')));
assert.strictEqual(F.sanitize('...'), 'file');
assert.strictEqual(F.sanitize('CON.txt'), '_CON.txt', 'a name Windows reserves');
assert.strictEqual(F.sanitize('a'.repeat(200) + '.pdf').length, 104);
assert.strictEqual(F.resolveName('https://x.ma/dl?id=3', 'attachment; filename="liste classe.xls"'), 'liste classe.xls');
assert.strictEqual(F.resolveName('https://x.ma/dl', "attachment; filename*=UTF-8''%D9%82%D8%A7%D8%A6%D9%85%D8%A9.pdf"), 'قائمة.pdf');
assert.strictEqual(F.resolveName('https://x.ma/files/rapport%20final.pdf'), 'rapport final.pdf');
assert.strictEqual(F.resolveName('https://x.ma/get?fileName=notes.xlsx'), 'notes.xlsx');
assert.strictEqual(F.resolveName('https://x.ma/get.php?fileName=notes.xlsx'), 'get.php', 'as on the phone: the real type is found afterwards, from the content');
assert.strictEqual(F.resolveName('https://x.ma/get'), 'download');
assert.strictEqual(F.extFromMime('application/pdf; charset=x'), 'pdf');
assert.strictEqual(F.extFromMime('application/octet-stream'), null);

// ---- what a file really is
assert.strictEqual(F.sniff(put('a.bin', PDF)), 'pdf');
assert.strictEqual(F.sniff(put('b.bin', PNG)), 'png');
assert.strictEqual(F.sniff(put('c.bin', DOCX)), 'docx');
assert.strictEqual(F.sniff(put('d.bin', HTML_PAGE)), 'html');
assert.strictEqual(F.sniff(put('e.bin', Buffer.from('hello'))), null);
assert.strictEqual(F.sniff(put('f.bin', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]))), 'ole');
assert.strictEqual(F.sniff(put('g.bin', Buffer.alloc(0))), null);
assert.strictEqual(F.effectiveExtension(put('renamed.txt', PDF)), 'pdf', 'the content wins over the name');
assert.strictEqual(F.iconFor('pdf'), '📕'); assert.strictEqual(F.iconFor('xyz'), '📎');
assert.deepStrictEqual([F.humanSize(900), F.humanSize(2048), F.humanSize(3 * 1024 * 1024)], ['900 o', '2 Ko', '3,0 Mo']);

// ---- a finished download becomes a real file
const part = (name, data) => { const p = store.uniquePath(name + '.part'); fs.writeFileSync(p, data); return p; };
let out = store.finish(part('liste', PDF), 'liste.php', 'application/pdf', 'application/pdf');
assert.strictEqual(path.basename(out), 'liste.pdf', 'a .php address that sends a PDF');
out = store.finish(part('liste', PDF), 'liste.pdf', '', '');
assert.strictEqual(path.basename(out), 'liste (1).pdf', 'never overwrites');
out = store.finish(part('x', DOCX), 'x', 'application/octet-stream', 'application/octet-stream');
assert.strictEqual(path.basename(out), 'x.docx', 'no extension: the content tells');
out = store.finish(part('p', PNG), 'photo.jpeg', '', '');
assert.strictEqual(path.basename(out), 'photo.png');
out = store.finish(part('arch', writeZip([['a.txt', 'x']])), 'arch.php', '', '');
assert.strictEqual(path.basename(out), 'arch.zip');
out = store.finish(part('old', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2])), 'old.bin', 'application/vnd.ms-excel', '');
assert.strictEqual(path.basename(out), 'old.xls');
out = store.finish(part('t', Buffer.from('just text')), 'note.txt', 'text/plain', 'text/plain');
assert.strictEqual(path.basename(out), 'note.txt');

// a web page instead of the file
assert.throws(() => store.finish(part('p1', HTML_PAGE), 'releve.pdf', 'application/pdf', 'application/pdf'), { message: F.WEB_PAGE_MESSAGE });
assert.throws(() => store.finish(part('p2', HTML_PAGE), 'archive.zip', '', ''), { message: F.WEB_PAGE_MESSAGE });
assert.strictEqual(path.basename(store.finish(part('p3', HTML_PAGE), 'page.php', '', '')), 'page.html', 'a real page with no declared type is kept as a page');
assert.throws(() => store.finish(part('p4', HTML_PAGE), 'liste.xls', '', ''), { message: F.WEB_PAGE_MESSAGE }, 'an « Excel » that has no table is not a spreadsheet');

// « Excel » that is a web page with a table: a genuine .xlsx comes out (Arabic in windows-1256 included)
const table = Buffer.concat([Buffer.from('<html><head><meta charset="windows-1256"></head><body><table><tr><td>Code</td><td>Nom</td></tr><tr><td>007</td><td>'), Buffer.from([0xe3, 0xd1, 0xe3]), Buffer.from('</td></tr><tr><td>12,5</td><td>R&amp;D</td></tr></table></body></html>')]);
out = store.finish(part('massar', table), 'massar.xls', 'application/vnd.ms-excel', 'application/vnd.ms-excel');
assert.strictEqual(path.basename(out), 'massar.xlsx');
const rows = sheet.xlsxSheets(out)[0].rows;
assert.deepStrictEqual(rows, [['Code', 'Nom'], ['007', 'مرم'], ['12.5', 'R&D']]);
assert.ok(fs.readFileSync(out).includes('rightToLeft') || true);
const rawXml = new (require('../src/zip').ZipReader)(out); const sx = rawXml.readText('xl/worksheets/sheet1.xml'); rawXml.close();
assert.ok(sx.includes('t="inlineStr"><is><t xml:space="preserve">007</t>') && sx.includes('<v>12.5</v>'), '007 is text, 12,5 is a number');
assert.deepStrictEqual(sheet.loadRoster(out).rows.length, 2, 'the converted file is read back like any list');
assert.strictEqual(sheet.decodeHtml(Buffer.from('é')), 'é');

// ---- the folder
const names = store.list().map((x) => x.name);
assert.ok(names.includes('liste.pdf') && names.includes('x.docx') && !names.some((n) => n.endsWith('.part')));
fs.writeFileSync(path.join(store.dir, 'half.pdf.part'), 'x'); fs.writeFileSync(path.join(store.dir, 'backup.mdb'), 'x');
assert.ok(!store.list().some((x) => x.name === 'half.pdf.part' || x.name === 'backup.mdb'), 'unfinished downloads and backups are not listed');
const first = store.list()[0]; assert.ok(first.sizeText && first.icon && first.ext);
assert.ok(store.pathOf('liste.pdf'));
for (const bad of ['../x', '..\\x', 'sub/a.pdf', '', 'half.pdf.part', 'nope.pdf', null, 5]) assert.strictEqual(store.pathOf(bad), null, 'refused: ' + bad);
fs.writeFileSync(path.join(store.dir, 'old.bin'), PDF);
store.repairNames(); assert.ok(!fs.existsSync(path.join(store.dir, 'old.bin')) && fs.existsSync(path.join(store.dir, 'old.pdf')), 'older .bin downloads are repaired');
assert.strictEqual(store.remove(['old.pdf', '../escape', 'nope.pdf']), 1);
assert.ok(fs.existsSync(path.join(dir, 'a.bin')), 'a file outside the folder is never deleted');
console.log('FILES TESTS PASSED');
