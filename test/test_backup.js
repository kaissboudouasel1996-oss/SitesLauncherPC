'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const B = require('../src/backup');
const { NoteStore } = require('../src/notes');
const { ClassStore } = require('../src/classes');
const { TimetableStore } = require('../src/timetable');
const { CahierStore } = require('../src/cahier');
const { ZipReader } = require('../src/zip');
const { Vault } = require('../src/vault');
const { AccountStore } = require('../src/totp');
const { CredentialStore } = require('../src/sites');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
const make = (name) => {
  const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true });
  const vault = new Vault(null);
  const s = { notes: new NoteStore(dir), classes: new ClassStore(dir), tt: new TimetableStore(dir), cahier: new CahierStore(dir), vault, accounts: new AccountStore(dir, vault), creds: new CredentialStore(dir, vault) };
  return { dir, s, data: new B.Data(dir, s) };
};

// --- a PC with data
const a = make('a');
const cl = a.s.classes.add({ name: '3APIC-2', header: ['Nom'], rows: [['AMRANI Yassine'], ['BENALI Salma']], year: '2026/2027' });
cl.track[0] = ['++-', '+', 'Participe']; cl.seats[3] = 1; a.s.classes.update(cl);
a.s.notes.put({ title: 'Rappel passé', remindAt: 1000 }, 5000);
a.s.notes.put({ title: 'Rappel futur', remindAt: Date.now() + 1e9 });
const t = a.s.tt.load(); t.cells[0][0] = '3APIC-2'; a.s.tt.save(t);
const c = a.s.cahier.load(); c.days['2026-11-02'] = 'off'; c.skipped.add('2026-11-03|1'); c.manual['1AC|1|voc1'] = 'x'; a.s.cahier.save(c);
fs.mkdirSync(a.data.filesDir); fs.writeFileSync(path.join(a.data.filesDir, 'cours.pdf'), Buffer.from('%PDF-fake'));
fs.writeFileSync(path.join(a.data.filesDir, 'old.mdb'), 'skip me');
fs.writeFileSync(path.join(a.data.filesDir, 'half.pdf.part'), 'unfinished');

const file = a.data.create('secret1');
fs.writeFileSync(path.join(root, 'x.mdb'), file);
assert.ok(file.subarray(0, 6).toString() === 'MADBK2');
assert.ok(!file.includes(Buffer.from('AMRANI')), 'content is encrypted');

// --- wrong password / not a backup / cut short / one bit changed
assert.throws(() => B.decrypt(file, 'secret2'), { message: 'Mot de passe incorrect, ou fichier abîmé.' });
assert.throws(() => B.decrypt(Buffer.from('hello world, this is not a backup at all'), 'x'), { message: 'Ce n’est pas un fichier de sauvegarde Madrassa.' });
assert.throws(() => B.decrypt(file.subarray(0, file.length - 10), 'secret1'), B.BackupError);
const flipped = Buffer.from(file); flipped[flipped.length - 30] ^= 1;
assert.throws(() => B.decrypt(flipped, 'secret1'), B.BackupError);

// --- restoring on an empty PC
const b = make('b');
const sum = b.data.restore(file, 'secret1', Date.now());
assert.deepStrictEqual(sum, { logins: 0, accounts: 0, notes: 2, classes: 1, files: 1 });
const cb = b.s.classes.load()[0];
assert.deepStrictEqual([cb.name, cb.track[0], cb.seats[3], cb.rows.length], ['3APIC-2', ['++-', '+', 'Participe'], 1, 2]);
assert.strictEqual(b.s.tt.load().cells[0][0], '3APIC-2');
const cab = b.s.cahier.load();
assert.deepStrictEqual([cab.days['2026-11-02'], cab.skipped.has('2026-11-03|1'), cab.manual['1AC|1|voc1']], ['off', true, 'x']);
assert.ok(fs.existsSync(path.join(b.data.filesDir, 'cours.pdf')));
assert.ok(!fs.existsSync(path.join(b.data.filesDir, 'old.mdb')), '.mdb files are not put inside');
assert.ok(!fs.existsSync(path.join(b.data.filesDir, 'half.pdf.part')), 'unfinished downloads are not saved');
const nb = b.s.notes.load();
assert.strictEqual(nb.find((n) => n.title === 'Rappel passé').fired, true, 'an old reminder does not ring after a restore');
assert.strictEqual(nb.find((n) => n.title === 'Rappel futur').fired, false);

// --- nothing is added twice, and nothing is overwritten
const again = b.data.restore(file, 'secret1');
assert.deepStrictEqual(again, { logins: 0, accounts: 0, notes: 0, classes: 0, files: 0 });
cb.track[0] = ['+', '', 'modifié ici']; b.s.classes.update(cb);
b.data.restore(file, 'secret1');
assert.strictEqual(b.s.classes.load()[0].track[0][2], 'modifié ici');
const t2 = b.s.tt.load(); t2.cells[0][0] = 'autre'; b.s.tt.save(t2);
b.data.restore(file, 'secret1');
assert.strictEqual(b.s.tt.load().cells[0][0], 'autre', 'a timetable already filled is kept');

// --- what the PC does not use yet is kept and sent back (phone -> PC -> phone loses nothing)
const phoneZip = require('../src/zip').writeZip([
  ['data.json', JSON.stringify({ v: 1, creds: { u_Massar: 'u', p_Massar: 'p', u_Haraka: 'h', p_Haraka: 'hp' }, accounts: [{ name: 'Massar', secret: 'JBSWY3DPEHPK3PXP', digits: 6, period: 30, algorithm: 'SHA1' }],
    notes: [{ id: 'p1', title: 'Du téléphone', text: '', remindAt: 0, done: false }], classes: [], timetable: {}, cahier: {}, contacts: [{ id: 'k', name: 'Ali', phone: '0600' }], settings: { theme: 'dark' } })],
  ['files/Mon cours.docx', Buffer.from('docx')]
]);
const phone = B.encrypt(phoneZip, 'code');
const c2 = make('c');
assert.deepStrictEqual(c2.data.restore(phone, 'code'), { logins: 2, accounts: 1, notes: 1, classes: 0, files: 1 });
const out = c2.data.json();
assert.deepStrictEqual([out.creds.u_Massar, out.accounts[0].secret, out.contacts[0].name, out.settings.theme], ['u', 'JBSWY3DPEHPK3PXP', 'Ali', 'dark']);
const back = B.decrypt(c2.data.create('autre-code'), 'autre-code');
fs.writeFileSync(path.join(root, 'back.zip'), back);
const z = new ZipReader(path.join(root, 'back.zip'));
assert.ok(z.has('files/Mon cours.docx') && JSON.parse(z.readText('data.json')).creds.p_Massar === 'p'); z.close();
c2.data.restore(phone, 'code');
assert.strictEqual(c2.data.json().accounts.length, 1, 'same authenticator account is not added twice');

// --- big content spans several 64 KB blocks
const bigZip = Buffer.alloc(300000, 7);
assert.ok(B.decrypt(B.encrypt(bigZip, 'p'), 'p').equals(bigZip));
assert.ok(B.decrypt(B.encrypt(Buffer.alloc(0), 'p'), 'p').length === 0);
assert.ok(B.decrypt(B.encrypt(Buffer.alloc(65536, 1), 'p'), 'p').length === 65536, 'exact block size');

const sf = B.safeFile('../../evil:name?.pdf');
assert.ok(!/[\\/:?]/.test(sf) && !sf.startsWith('.'), 'file names from a backup cannot leave the folder: ' + sf);
console.log('ROOT=' + root);
console.log('BACKUP TESTS PASSED');
