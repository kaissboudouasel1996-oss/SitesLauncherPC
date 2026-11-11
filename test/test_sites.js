'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const S = require('../src/sites');
const { Vault } = require('../src/vault');

// the login is typed only on the pages of the site
assert.ok(S.allowedHost('massar', 'https://idprovider.men.gov.ma/auth'));
assert.ok(S.allowedHost('massar', 'https://men.gov.ma/'));
assert.ok(S.allowedHost('tgr', 'https://eservices.tgr.gov.ma/my/auth/login'));
assert.ok(S.allowedHost('nouveaux', 'https://accounts.google.com/signin'));
for (const bad of ['https://men.gov.ma.evil.com/', 'https://evilmen.gov.ma/', 'http://massar.men.gov.ma/', 'https://tgr.gov.ma.fr/', 'javascript:alert(1)', 'not a url', '']) assert.strictEqual(S.allowedHost('massar', bad), false, bad);
assert.strictEqual(S.allowedHost('tgr', 'https://idprovider.men.gov.ma/'), false, 'each site has its own domains');
assert.strictEqual(S.allowedHost('nope', 'https://men.gov.ma/'), false);
Object.values(S.SITES).forEach((s) => assert.ok(s.url.startsWith('https://') && S.allowedHost(Object.keys(S.SITES).find((k) => S.SITES[k] === s), s.url), 'the home address of ' + s.title + ' is on its own domain'));

// the scripts are built safely
const sc = S.autofillScript('a"b\\c', 'x</script>\u2028y', true);
assert.ok(sc.includes('"a\\"b\\\\c"') && sc.includes('\\u003c/script>') && sc.includes('\\u2028') && sc.trim().endsWith(', true);'));
assert.ok(S.autofillScript('', '', false).trim().endsWith('"", "", false);'));
assert.strictEqual(S.fillCodeScript('12; alert(1)'), null);
assert.ok(S.fillCodeScript('123456').includes("'123456'"));

// the store: phone layout, legacy name, only the missing sites are added from a backup
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'));
const c = new S.CredentialStore(dir, new Vault(null));
assert.strictEqual(c.get('Massar'), null);
c.save('Massar', 'u', 'p');
assert.deepStrictEqual(c.get('Massar'), { user: 'u', pass: 'p' });
assert.deepStrictEqual(c.exportAll(), { u_Massar: 'u', p_Massar: 'p' });
c.f.write(Object.assign(c.all(), { u_NotifRH: 'old', p_NotifRH: 'oldp', auto_x: true }));
assert.deepStrictEqual(c.get('Tabligh'), { user: 'old', pass: 'oldp' }, 'logins saved under the old name');
assert.ok(!('auto_x' in c.exportAll()), 'only u_ and p_ keys go in a backup');
assert.strictEqual(c.importMissing({ u_Massar: 'other', p_Massar: 'other', u_Haraka: 'h', p_Haraka: 'hp', junk: 'x' }), 1);
assert.deepStrictEqual([c.get('Massar').user, c.get('Haraka').pass], ['u', 'hp']);
c.delete('Tabligh'); assert.strictEqual(c.get('Tabligh'), null);
c.delete('Massar'); assert.strictEqual(c.get('Massar'), null);
console.log('SITES TESTS PASSED');
