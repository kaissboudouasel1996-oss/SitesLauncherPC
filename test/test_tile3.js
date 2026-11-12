'use strict';
// Espace 3 fenêtres: the zones, the arguments given to PowerShell, and the answer read back.
const assert = require('assert');
const EventEmitter = require('events');
const tile3 = require('../src/tile3');

const area = { x: 0, y: 0, width: 1921, height: 1041 };
const L = tile3.layout(area);
// Word fills the left half, PowerPoint the top right, the desktop the bottom right, under the toolbar
assert.deepStrictEqual(L.toolbar, { x: 0, y: 0, width: 1921, height: tile3.TOOLBAR_HEIGHT });
assert.strictEqual(L.word.x, 0); assert.strictEqual(L.word.y, tile3.TOOLBAR_HEIGHT); assert.strictEqual(L.word.height, 1041 - tile3.TOOLBAR_HEIGHT);
assert.strictEqual(L.ppt.x, L.word.width); assert.strictEqual(L.desk.x, L.word.width);
assert.strictEqual(L.ppt.y, L.word.y); assert.strictEqual(L.desk.y, L.ppt.y + L.ppt.height);
assert.strictEqual(L.word.width + L.ppt.width, 1921, 'no gap on the width, odd widths included');
assert.strictEqual(L.ppt.height + L.desk.height, L.word.height, 'no gap on the height');
// the zones keep their place on a second screen
const L2 = tile3.layout({ x: -1920, y: 0, width: 1920, height: 1040 });
assert.strictEqual(L2.word.x, -1920); assert.strictEqual(L2.ppt.x, -960);

// arguments: numbers only, a file only when its type fits
const a = tile3.argsFor('start', L, { script: 'x.ps1', statePath: 'C:\\s.json' });
assert.ok(a.includes('-File') && a.includes('x.ps1') && a.includes('-Word'));
assert.strictEqual(a[a.indexOf('-Word') + 1], '0,46,960,995');
assert.throws(() => tile3.argsFor('open', L, { script: 'x', kind: 'word', file: 'C:\\a\\virus.exe' }));
assert.throws(() => tile3.argsFor('open', L, { script: 'x', kind: 'word', file: 'C:\\a\\x".docx' }));
assert.throws(() => tile3.argsFor('open', L, { script: 'x', kind: 'ppt', file: 'C:\\a\\x.docx' }));
const o = tile3.argsFor('open', L, { script: 'x', kind: 'ppt', file: 'C:\\a\\Cours 1.pptx' });
assert.ok(o.includes('-Kind') && o[o.indexOf('-Open') + 1] === 'C:\\a\\Cours 1.pptx');
assert.strictEqual(tile3.argsFor('nonsense', L, { script: 'x' })[tile3.argsFor('nonsense', L, { script: 'x' }).indexOf('-Mode') + 1], 'tile');
assert.ok(/SetWindowPos/.test(tile3.SCRIPT) && /WINWORD/.test(tile3.SCRIPT) && /POWERPNT/.test(tile3.SCRIPT) && /shell:Desktop/.test(tile3.SCRIPT));

// the answer of the script
const fakeSpawn = (out, code) => () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.kill = () => {}; setImmediate(() => { c.stdout.emit('data', out); c.emit('close', code || 0); }); return c; };
(async () => {
  let r = await tile3.run('start', L, { script: 'x', spawn: fakeSpawn('noise\r\n{"word":true,"ppt":true,"desk":false}\r\n') });
  assert.deepStrictEqual(r, { ok: true, word: true, ppt: true, desk: false });
  r = await tile3.run('tile', L, { script: 'x', spawn: fakeSpawn('Error: boom') });
  assert.strictEqual(r.ok, false);
  r = await tile3.run('open', L, { script: 'x', kind: 'word', file: 'C:\\x.exe', spawn: fakeSpawn('{}') });
  assert.strictEqual(r.ok, false);
  r = await tile3.run('tile', L, { script: 'x', spawn: () => { throw new Error('no powershell'); } });
  assert.strictEqual(r.ok, false);
  console.log('TILE3 TESTS PASSED');
})();
