'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const T = require('../src/totp');
const { Vault, SecureFile } = require('../src/vault');

// ---- RFC 6238 test vectors (the same ones every authenticator is checked with)
const k1 = Buffer.from('12345678901234567890');
const k256 = Buffer.from('12345678901234567890123456789012');
const k512 = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234');
assert.strictEqual(T.code(k1, 59000, 30, 8, 'SHA1'), '94287082');
assert.strictEqual(T.code(k256, 59000, 30, 8, 'SHA256'), '46119246');
assert.strictEqual(T.code(k512, 59000, 30, 8, 'SHA512'), '90693936');
assert.strictEqual(T.code(k1, 1111111109000, 30, 8, 'SHA1'), '07081804');
assert.strictEqual(T.code(k1, 1234567890000, 30, 8, 'SHA1'), '89005924');
assert.strictEqual(T.code(k1, 59000, 30, 6, 'SHA1'), '287082', 'six digits are the last six of the eight');
assert.strictEqual(T.code(k1, 20000000000000, 30, 8, 'SHA1').length, 8);

// ---- base32
assert.strictEqual(T.base32Encode(k1), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
assert.ok(T.base32Decode('gezd gnbv-gy3t qojq GEZDGNBVGY3TQOJQ==').equals(k1), 'spaces, dashes, case and = are ignored');
assert.throws(() => T.base32Decode('abc1'), /Invalid/);
assert.throws(() => T.base32Decode('  '), /Empty/);

// ---- typed key and otpauth:// link
const typed = T.parseInput('Massar', 'gezd gnbv gy3t qojq');
assert.deepStrictEqual(typed, { name: 'Massar', secret: 'GEZDGNBVGY3TQOJQ', digits: 6, period: 30, algorithm: 'SHA1' });
assert.strictEqual(T.parseInput('', 'GEZDGNBVGY3TQOJQ').name, 'Account');
const link = T.parseInput('', 'otpauth://totp/TGR%3Aali%40mail.ma?secret=GEZDGNBVGY3TQOJQ&issuer=TGR&digits=8&period=60&algorithm=sha256');
assert.deepStrictEqual(link, { name: 'TGR', secret: 'GEZDGNBVGY3TQOJQ', digits: 8, period: 60, algorithm: 'SHA256' });
assert.strictEqual(T.parseInput('', 'otpauth://totp/Massar:ali?secret=GEZDGNBVGY3TQOJQ').name, 'Massar:ali', 'no issuer: the label is the name');
assert.strictEqual(T.parseInput('Mon nom', 'otpauth://totp/x?secret=GEZDGNBVGY3TQOJQ&issuer=Y').name, 'Mon nom', 'the typed name wins');
for (const bad of ['', 'otpauth://totp/x', 'otpauth://totp/x?secret=GEZD&digits=5', 'otpauth://totp/x?secret=GEZD&period=0', 'otpauth://totp/x?secret=GEZD&algorithm=MD5', 'not a key!!', 'otpauth://hotp/x?secret=1']) {
  assert.strictEqual(T.parseInput('n', bad), null, 'rejected: ' + bad);
}

// ---- Google Authenticator export (protobuf in base64), built by hand
const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n >>= 7; } o.push(n); return Buffer.from(o); };
const lenField = (f, buf) => Buffer.concat([varint((f << 3) | 2), varint(buf.length), buf]);
const intField = (f, n) => Buffer.concat([varint(f << 3), varint(n)]);
const otp = (secret, name, issuer, algo, digits, type) => Buffer.concat([lenField(1, secret), lenField(2, Buffer.from(name)), lenField(3, Buffer.from(issuer)), intField(4, algo), intField(5, digits), intField(6, type)]);
const payload = Buffer.concat([
  lenField(1, otp(k1, 'Massar:ali@mail.ma', 'Massar', 1, 1, 2)),
  lenField(1, otp(k256, 'admin', '', 2, 2, 2)),
  lenField(1, otp(k1, 'counter', 'X', 1, 1, 1)),        // HOTP: skipped
  intField(2, 1), intField(3, 1)                         // version, batch: ignored
]);
const mig = 'otpauth-migration://offline?data=' + encodeURIComponent(payload.toString('base64'));
const m = T.parseMigration(mig);
assert.strictEqual(m.skipped, 1);
assert.deepStrictEqual(m.accounts.map((a) => [a.name, a.digits, a.algorithm]), [['Massar (ali@mail.ma)', 6, 'SHA1'], ['admin', 8, 'SHA256']]);
assert.strictEqual(m.accounts[0].secret, T.base32Encode(k1));
assert.ok(T.parseMigration(mig.replace(/%2B/g, '+')), 'a + that lost its % is still read');
assert.strictEqual(T.parseMigration('otpauth-migration://offline'), null);

// ---- the accounts, protected on the disk
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
const xor = (b) => Buffer.from(b).map((x) => x ^ 0x5a);
const fakeSafe = { isEncryptionAvailable: () => true, encryptString: (t) => xor(Buffer.from(t, 'utf8')), decryptString: (b) => xor(b).toString('utf8') };
const store = new T.AccountStore(dir, new Vault(fakeSafe));
assert.deepStrictEqual(store.load(), []);
assert.deepStrictEqual(store.importText('Massar', 'GEZDGNBVGY3TQOJQ'), { ok: true, message: 'Massar ajouté' });
assert.deepStrictEqual(store.importText('Autre nom', 'gezd gnbv gy3t qojq'), { ok: true, message: 'Ce compte est déjà ajouté.' });
assert.strictEqual(store.importText('', 'xx!!').ok, false);
assert.strictEqual(store.importText('', 'otpauth-migration://offline?data=AAAA').ok, false, 'an export without account is refused');
assert.deepStrictEqual(store.importText('', mig), { ok: true, message: '2 compte(s) importé(s), 1 ignoré(s) (pas basés sur le temps)' });
assert.deepStrictEqual(store.importText('', mig), { ok: true, message: '0 compte(s) importé(s), 2 déjà présent(s), 1 ignoré(s) (pas basés sur le temps)' });
assert.strictEqual(store.load().length, 3);
const raw = fs.readFileSync(path.join(dir, 'accounts.sec'));
assert.ok(raw[0] === 0x45 && !raw.includes('GEZDGN') && !raw.includes('Massar'), 'sealed: neither the keys nor the names can be read in the file');
const now = 1234567890000;
const codes = store.codes(now);
assert.strictEqual(codes.length, 3);
assert.deepStrictEqual([codes[0].period, codes[0].remaining, codes[0].code.length], [30, 30 - (1234567890 % 30), 6]);
assert.strictEqual(codes[1].code.length, 6); assert.strictEqual(codes[2].code.length, 8);
assert.strictEqual(codes[1].code, T.code(k1, now, 30, 6, 'SHA1'));
assert.ok(!JSON.stringify(codes).includes(T.base32Encode(k1)), 'the secret is not in what goes to the screen');
store.remove(codes[0].id);
assert.strictEqual(store.load().length, 2);
// another Windows session cannot read it; nothing crashes and nothing is lost on the disk
const other = new T.AccountStore(dir, new Vault({ isEncryptionAvailable: () => false }));
assert.deepStrictEqual(other.load(), []);

// ---- the secure file: an old plain file is still read, then sealed at the next write
const f = new SecureFile(path.join(dir, 'old.json'), new Vault(fakeSafe));
fs.writeFileSync(f.file, JSON.stringify({ a: 1 }));
assert.ok(f.isPlain()); assert.deepStrictEqual(f.read({}), { a: 1 });
f.write({ a: 2 }); assert.ok(!f.isPlain()); assert.deepStrictEqual(f.read({}), { a: 2 });
assert.strictEqual(new SecureFile(path.join(dir, 'none.json'), new Vault(null)).read('x'), 'x');
const plainVault = new SecureFile(path.join(dir, 'p.json'), new Vault(null)); plainVault.write({ b: 3 });
assert.deepStrictEqual(plainVault.read({}), { b: 3 });

console.log('TOTP TESTS PASSED');
