'use strict';
// The QR code reader, on matrices produced by an independent encoder (OpenCV) and rendered here as pictures:
// every size from version 1 to 40, every correction level, rotation, perspective, blur-like noise, inverted colours, a damaged code.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Q = require('../src/qr');

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'qr.json'), 'utf8'));
const matrixOf = (f) => {
  const bytes = Buffer.from(f.bits, 'base64'); const m = [];
  for (let y = 0; y < f.size; y++) { const row = []; for (let x = 0; x < f.size; x++) { const i = y * f.size + x; row.push(((bytes[i >> 3] >> (7 - (i & 7))) & 1) === 1); } m.push(row); }
  return m;
};

// ---- the matrices alone (tables, masks, Reed-Solomon, text modes)
for (const f of fixtures) assert.strictEqual(Q.decodeMatrix(matrixOf(f)), f.text, `version ${f.version}-${f.ecc}`);

// ---- Reed-Solomon corrects what it can and says so when it cannot
const f20 = fixtures.find((f) => f.version === 20 && f.ecc === 'M');
const damaged = matrixOf(f20); const keep = JSON.stringify(damaged.map((r) => r.slice()));
const fn = Q.functionMask(20); let flipped = 0;
for (let y = 30; y < 90 && flipped < 60; y++) for (let x = 30; x < 90 && flipped < 60; x++) if (!fn[y][x] && (x * 7 + y * 3) % 5 === 0) { damaged[y][x] = !damaged[y][x]; flipped++; }
assert.ok(flipped >= 40);
assert.strictEqual(Q.decodeMatrix(damaged), f20.text, `${flipped} wrong modules are repaired`);
for (let y = 10; y < 60; y++) for (let x = 10; x < 60; x++) if (!fn[y][x]) damaged[y][x] = !damaged[y][x];
assert.strictEqual(Q.decodeMatrix(damaged), null, 'too damaged: no wrong answer');
assert.ok(keep.length > 0);

// ---- pictures of the codes
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
/** Draws the matrix with a 4-module quiet zone, scaled by [scale], then maps it through [warp] (output pixel -> source pixel). */
function picture(m, scale, { warp = null, outW = 0, outH = 0, invert = false, noise = 0, bg = 235, fg = 25 } = {}) {
  const n = m.length; const side = (n + 8) * scale; const W = outW || side; const H = outH || side;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let sx = x; let sy = y; if (warp) [sx, sy] = warp(x, y);
    let v = bg;
    if (sx >= 0 && sy >= 0 && sx < side && sy < side) { const mx = Math.floor(sx / scale) - 4; const my = Math.floor(sy / scale) - 4; if (mx >= 0 && my >= 0 && mx < n && my < n && m[my][mx]) v = fg; }
    if (invert) v = 255 - v;
    v = Math.max(0, Math.min(255, v + (noise ? (rnd() - 0.5) * 2 * noise : 0)));
    const p = (y * W + x) * 4; data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255;
  }
  return { data, width: W, height: H };
}
const rotation = (deg, W, H, side) => { const a = deg * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a); return (x, y) => { const dx = x - W / 2; const dy = y - H / 2; return [c * dx + s * dy + side / 2, -s * dx + c * dy + side / 2]; }; };

for (const f of fixtures) {
  const m = matrixOf(f); const scale = f.size > 100 ? 5 : f.size > 50 ? 6 : 8;
  assert.strictEqual(Q.readQR(picture(m, scale)), f.text, `picture of version ${f.version}-${f.ecc}`);
}
const some = fixtures.filter((f) => [2, 7, 10, 20].includes(f.version) && f.ecc === 'M');
for (const f of some) {
  const m = matrixOf(f); const scale = f.size > 50 ? 6 : 8; const side = (f.size + 8) * scale; const big = Math.round(side * 1.5);
  assert.strictEqual(Q.readQR(picture(m, scale, { invert: true })), f.text, 'light on dark');
  assert.strictEqual(Q.readQR(picture(m, scale, { noise: 28 })), f.text, 'noisy');
  assert.strictEqual(Q.readQR(picture(m, scale, { warp: rotation(23, big, big, side), outW: big, outH: big })), f.text, 'rotated 23 degrees v' + f.version);
  assert.strictEqual(Q.readQR(picture(m, scale, { warp: rotation(90, side, side, side), outW: side, outH: side })), f.text, 'rotated 90 degrees');
  assert.strictEqual(Q.readQR(picture(m, scale, { warp: rotation(180, side, side, side), outW: side, outH: side })), f.text, 'upside down');
  // a mild perspective, like a photo taken at an angle
  const persp = (x, y) => { const u = x / big; const v = y / big; const d = 1 + 0.12 * u - 0.08 * v; return [((x - big * 0.05) / d) / 1.2, ((y - big * 0.03) / d) / 1.2]; };
  assert.strictEqual(Q.readQR(picture(m, scale, { warp: persp, outW: big, outH: big, noise: 10 })), f.text, 'perspective v' + f.version);
}
// a small code in the corner of a big picture, and a picture with no code at all
const f2 = fixtures.find((f) => f.version === 5 && f.ecc === 'Q'); const small = picture(matrixOf(f2), 4);
const canvas = { data: new Uint8ClampedArray(1600 * 1200 * 4).fill(210), width: 1600, height: 1200 };
for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) { const s = (y * small.width + x) * 4; const d = ((y + 700) * 1600 + x + 1100) * 4; for (let c = 0; c < 4; c++) canvas.data[d + c] = small.data[s + c]; }
assert.strictEqual(Q.readQR(canvas), f2.text, 'a small code inside a big picture');
const noCode = { data: new Uint8ClampedArray(500 * 500 * 4), width: 500, height: 500 }; for (let i = 0; i < noCode.data.length; i += 4) { const v = rnd() * 255; noCode.data[i] = noCode.data[i + 1] = noCode.data[i + 2] = v; noCode.data[i + 3] = 255; }
assert.strictEqual(Q.readQR(noCode), null, 'noise is not a code');
assert.strictEqual(Q.readQR({ data: new Uint8ClampedArray(100 * 100 * 4).fill(255), width: 100, height: 100 }), null, 'a blank picture');

// ---- what the Authenticator does with the text
const T = require('../src/totp');
assert.ok(T.parseInput('', fixtures[0].text.startsWith('otpauth') ? fixtures[0].text.replace(/secret=[^&]*/, 'secret=GEZDGNBV') : 'x'));
console.log('QR TESTS PASSED (' + fixtures.length + ' codes)');
