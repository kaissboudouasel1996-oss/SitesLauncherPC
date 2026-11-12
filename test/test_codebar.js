'use strict';
// The strip of codes under the site windows.
const assert = require('assert');
const vm = require('vm');
const cb = require('../src/codebar');

const list = [{ name: 'Haraka (a)' }, { name: 'TGR' }, { name: 'Massar prof' }, { name: 'NotifRH' }];
assert.deepStrictEqual(cb.order(list, 'Massar').map((a) => a.name), ['Massar prof', 'Haraka (a)', 'TGR', 'NotifRH'], 'the account of the site comes first, the others keep their order');
assert.deepStrictEqual(cb.order(list, 'Tabligh').map((a) => a.name)[0], 'NotifRH', 'NotifRH is the Tabligh account');
assert.deepStrictEqual(cb.order(list, '').map((a) => a.name), list.map((a) => a.name));
assert.strictEqual(cb.pretty('123456'), '123 456'); assert.strictEqual(cb.pretty('12345678'), '1234 5678'); assert.strictEqual(cb.pretty(null), '------'); assert.strictEqual(cb.pretty('abc'), '------');

// the script run in the page: tells when a code is sent, and says when the page asks for one
function page(inputs) {
  const listeners = {}; const logs = [];
  const mk = (o) => Object.assign({ type: 'text', value: '', id: '', name: '', placeholder: '', autocomplete: '', maxLength: -1, offsetParent: {}, getAttribute: () => '' }, o);
  const ins = inputs.map(mk);
  const document = { querySelectorAll: () => ins, addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); } };
  const ctx = { document, window: {}, console: { log: (m) => logs.push(m) } };
  const asking = vm.runInNewContext(cb.WATCH_JS, ctx);
  return { asking, logs, fire: (ev, e) => (listeners[ev] || []).forEach((f) => f(e)), ins };
}
let p = page([{ name: 'verification_code', value: '' }]);
assert.strictEqual(p.asking, true, 'a code field is visible');
p.fire('keydown', { key: 'Enter' }); assert.deepStrictEqual(p.logs, [], 'nothing typed yet: the strip stays');
p.ins[0].value = '123456';
p.fire('keydown', { key: 'Enter' }); assert.deepStrictEqual(p.logs, ['__madrassa_code_submitted__'], 'code typed and sent: the strip goes away');
p = page([{ name: 'username' }, { name: 'q', value: 'abc' }]);
assert.strictEqual(p.asking, false, 'an ordinary page does not ask for a code');
p = page([{ name: 'otp', value: '654321' }]);
p.fire('click', { target: { closest: () => ({ type: 'submit', innerText: 'Valider' }) } });
assert.strictEqual(p.logs.length, 1, 'the « Valider » button sends it too');
p = page([1, 2, 3, 4, 5, 6].map((n) => ({ maxLength: 1, value: String(n) })));
assert.strictEqual(p.asking, true, 'six boxes of one digit'); p.fire('keydown', { key: 'Enter' }); assert.strictEqual(p.logs.length, 1);
console.log('CODEBAR TESTS PASSED');
