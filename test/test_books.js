'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { BookLibrary } = require('../src/books');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
const user = path.join(root, 'user'); const bundled = path.join(root, 'bundled');
const lib = new BookLibrary(user, bundled);
const img = (dir, name, data = 'x') => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), data); return path.join(dir, name); };

// ---- the shelf with nothing installed
let list = lib.list();
assert.deepStrictEqual(list.map((b) => [b.id, b.subtitle, b.pages, b.custom]), [['1ac', '1ère AC', 0, false], ['3ac', '3ème AC', 0, false]]);
assert.strictEqual(lib.open('1ac'), null, 'a book without pages cannot be opened');
assert.strictEqual(lib.open('nope'), null);

// ---- pages shipped with the application, read in natural order
for (const n of ['p001.webp', 'p002.webp', 'p010.webp', 'p003.webp', 'notes.txt']) img(path.join(bundled, '1ac'), n, 'bundled ' + n);
assert.strictEqual(lib.pageCount('1ac'), 4);
assert.deepStrictEqual(lib.files('1ac').names, ['p001.webp', 'p002.webp', 'p003.webp', 'p010.webp']);
assert.ok(fs.readFileSync(lib.fileFor('1ac', 3)).toString().endsWith('p010.webp'));
assert.strictEqual(lib.fileFor('1ac', 4), null); assert.strictEqual(lib.fileFor('1ac', -1), null); assert.strictEqual(lib.fileFor('1ac', 1.5), null); assert.strictEqual(lib.fileFor('../x', 0), null);

// ---- reading state: position, bookmarks, tone
assert.strictEqual(lib.open('1ac').last, 0);
assert.ok(lib.setLast('1ac', 2)); assert.strictEqual(lib.open('1ac').last, 2);
assert.ok(lib.setLast('1ac', 99)); assert.strictEqual(lib.open('1ac').last, 3, 'the position never goes past the last page');
assert.strictEqual(lib.setLast('nope', 1), false);
assert.strictEqual(lib.toggleMark('1ac', 2), true); assert.strictEqual(lib.toggleMark('1ac', 0), true);
assert.deepStrictEqual(lib.open('1ac').marks, [0, 2]);
assert.strictEqual(lib.toggleMark('1ac', 2), false); assert.deepStrictEqual(lib.open('1ac').marks, [0]);
assert.strictEqual(lib.setTone(2), 2); assert.strictEqual(lib.open('1ac').tone, 2); assert.strictEqual(lib.setTone(9), 0);
assert.strictEqual(new BookLibrary(user, bundled).open('1ac').marks.length, 1, 'kept between launches');
assert.strictEqual(lib.list()[0].marks, 1);

// ---- importing pages: renamed in order, replaces the shipped ones, any of webp/png/jpg
const src = path.join(root, 'src');
const files = ['page 10.png', 'page 2.png', 'page 1.JPG', 'readme.txt'].map((n) => img(src, n, 'imp ' + n));
assert.strictEqual(lib.importFiles('3ac', files), 3);
assert.deepStrictEqual(fs.readdirSync(path.join(user, 'books', '3ac')), ['p001.jpg', 'p002.png', 'p003.png']);
assert.ok(fs.readFileSync(lib.fileFor('3ac', 0)).toString() === 'imp page 1.JPG' && fs.readFileSync(lib.fileFor('3ac', 2)).toString() === 'imp page 10.png', 'natural order: 1, 2, 10');
assert.strictEqual(lib.importFiles('1ac', [path.join(src, 'readme.txt')]), 0, 'no picture: nothing changes');
assert.strictEqual(lib.pageCount('1ac'), 4);
assert.strictEqual(lib.importFolder('1ac', src), 3);
assert.strictEqual(lib.pageCount('1ac'), 3, 'imported pages win over the shipped ones');
assert.ok(!fs.existsSync(path.join(user, 'books', '1ac.new')));
assert.throws(() => lib.importFiles('nope', files));

// ---- a book of the teacher's own
const id = lib.addBook('Cahier d’activités', '2ème AC');
assert.strictEqual(id, '2eme-ac-cahier-d-activites');
assert.strictEqual(lib.addBook('Cahier d’activités', '2ème AC'), id + '-2', 'two books with the same name stay apart');
assert.throws(() => lib.addBook('  ', 'x'));
assert.strictEqual(lib.importFiles(id, files), 3);
list = lib.list(); assert.ok(list.find((b) => b.id === id).custom && list.length === 4);
assert.ok(lib.remove(id)); assert.ok(!lib.find(id) && !fs.existsSync(path.join(user, 'books', id)));
assert.ok(lib.remove('1ac')); assert.strictEqual(lib.pageCount('1ac'), 4, 'removing the imported pages brings back the shipped ones'); assert.ok(lib.find('1ac'));
assert.strictEqual(lib.remove('../..'), false);

// ---- the book:// address
assert.deepStrictEqual(lib.resolve('book://1ac/0').mime, 'image/webp');
assert.strictEqual(lib.resolve('book://3ac/0').mime, 'image/jpeg');
assert.strictEqual(lib.resolve('book://3ac/1').mime, 'image/png');
for (const bad of ['book://1ac/9', 'book://1ac/-1', 'book://1ac/0/../../x', 'book://nope/0', 'book://1ac/', 'book://1ac/abc', 'file:///etc/passwd', 'http://x/0', 'not a url', 'book://..%2f..%2fetc/0']) assert.strictEqual(lib.resolve(bad), null, bad);
console.log('BOOKS TESTS PASSED');
