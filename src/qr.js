'use strict';
// QR code reader (pure JavaScript, no library): finds the code in a picture and returns its text, or null.
// Used by the Authenticator to read the QR code of a site or of the Google Authenticator export from a picture or a screenshot.
// Layout tables and masks follow ISO/IEC 18004 (model 2).

// ---------------------------------------------------------------- tables
const ECC_PER_BLOCK = [ // [level][version]: L, M, Q, H
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
];
const ECC_BITS = [1, 0, 3, 2]; // L, M, Q, H as written in the format information

const rawModules = (ver) => {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
  return r;
};
const alignPositions = (ver) => {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2; const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7, i = 0; i < n - 1; i++, pos -= step) out.splice(1, 0, pos);
  return out;
};

const bitsOf = (n) => { let c = 0; while (n) { c += n & 1; n >>>= 1; } return c; };
const formatBits = (data) => { let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537); return ((data << 10) | rem) ^ 0x5412; };
const versionBits = (ver) => { let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25); return (ver << 12) | rem; };
const FORMATS = []; for (let d = 0; d < 32; d++) FORMATS.push([formatBits(d), d]);

const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

/** Modules that are not data: finder patterns, timing, alignment, format and version areas. */
function functionMask(ver) {
  const size = ver * 4 + 17;
  const f = Array.from({ length: size }, () => new Uint8Array(size));
  const fill = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < size && y < size) f[y][x] = 1; };
  fill(0, 6, size, 1); fill(6, 0, 1, size);
  fill(0, 0, 9, 9); fill(size - 8, 0, 8, 9); fill(0, size - 8, 9, 8);
  const ap = alignPositions(ver);
  for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
    fill(ap[i] - 2, ap[j] - 2, 5, 5);
  }
  if (ver >= 7) { fill(size - 11, 0, 3, 6); fill(0, size - 11, 6, 3); }
  return f;
}

// ---------------------------------------------------------------- Reed-Solomon over GF(256), polynomial 0x11D
const EXP = new Uint8Array(512); const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const ginv = (a) => EXP[255 - LOG[a]];

/** Corrects [block] (data + ecc codewords) in place. Returns false when there are too many errors. */
function rsCorrect(block, ecc) {
  const n = block.length;
  const synd = new Array(ecc).fill(0); let clean = true;
  for (let i = 0; i < ecc; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s = gmul(s, EXP[i]) ^ block[j];
    synd[i] = s; if (s) clean = false;
  }
  if (clean) return true;
  // Berlekamp-Massey: the error locator polynomial
  let C = [1]; let B = [1]; let L = 0; let m = 1; let b = 1;
  for (let i = 0; i < ecc; i++) {
    let d = synd[i];
    for (let j = 1; j <= L; j++) d ^= gmul(C[j] || 0, synd[i - j]);
    if (d === 0) { m++; continue; }
    const T = C.slice(); const coef = gmul(d, ginv(b));
    while (C.length < B.length + m) C.push(0);
    for (let j = 0; j < B.length; j++) C[j + m] ^= gmul(coef, B[j]);
    if (2 * L <= i) { L = i + 1 - L; B = T; b = d; m = 1; } else m++;
  }
  if (L * 2 > ecc) return false;
  // Chien search: positions of the errors
  const pos = [];
  for (let k = 0; k < n; k++) {
    let v = 0;
    for (let j = 0; j <= L; j++) v ^= gmul(C[j] || 0, EXP[((255 - ((n - 1 - k) % 255)) * j) % 255]);
    if (v === 0) pos.push(k);
  }
  if (pos.length !== L) return false;
  // Forney: the size of the errors
  const omega = new Array(ecc).fill(0);
  for (let i = 0; i < ecc; i++) { let v = 0; for (let j = 0; j <= i; j++) v ^= gmul(C[j] || 0, synd[i - j]); omega[i] = v; }
  for (const k of pos) {
    const xi = EXP[(n - 1 - k) % 255]; const xinv = ginv(xi);
    let num = 0; for (let j = 0; j < ecc; j++) num ^= gmul(omega[j], powGf(xinv, j));
    let den = 0; for (let j = 1; j <= L; j += 2) den ^= gmul(C[j] || 0, powGf(xinv, j - 1));
    if (den === 0) return false;
    block[k] ^= gmul(xi, gmul(num, ginv(den)));
  }
  // check
  for (let i = 0; i < ecc; i++) { let s = 0; for (let j = 0; j < n; j++) s = gmul(s, EXP[i]) ^ block[j]; if (s) return false; }
  return true;
}
const powGf = (a, p) => (p === 0 ? 1 : a === 0 ? 0 : EXP[(LOG[a] * p) % 255]);

// ---------------------------------------------------------------- reading the matrix
function readFormat(m) {
  const size = m.length;
  const bit = (x, y) => (m[y][x] ? 1 : 0);
  let a = 0; // first copy (same layout as the writer)
  for (let i = 0; i <= 5; i++) a |= bit(8, i) << i;
  a |= bit(8, 7) << 6; a |= bit(8, 8) << 7; a |= bit(7, 8) << 8;
  for (let i = 9; i < 15; i++) a |= bit(14 - i, 8) << i;
  let b = 0; // second copy
  for (let i = 0; i < 8; i++) b |= bit(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) b |= bit(8, size - 15 + i) << i;
  let best = null; let bestD = 4;
  for (const raw of [a, b]) for (const [bits, d] of FORMATS) { const dist = bitsOf(bits ^ raw); if (dist < bestD) { bestD = dist; best = d; } }
  return best === null ? null : { ecl: best >>> 3, mask: best & 7 };
}

function readVersion(m) {
  const size = m.length;
  if (size < 45) return (size - 17) / 4;
  let a = 0; let b = 0;
  for (let i = 0; i < 18; i++) { const x = size - 11 + (i % 3); const y = Math.floor(i / 3); a |= (m[y][x] ? 1 : 0) << i; b |= (m[x][y] ? 1 : 0) << i; }
  let best = -1; let bestD = 4;
  for (let v = 7; v <= 40; v++) for (const raw of [a, b]) { const d = bitsOf(versionBits(v) ^ raw); if (d < bestD) { bestD = d; best = v; } }
  return best;
}

function decodeMatrix(m) {
  const size = m.length;
  if ((size - 17) % 4 !== 0 || size < 21 || size > 177) return null;
  const fmt = readFormat(m); if (!fmt) return null;
  const ver = readVersion(m); if (ver < 1 || ver > 40 || ver * 4 + 17 !== size) return null;
  const eccIdx = [1, 0, 3, 2].indexOf(fmt.ecl); // L=1, M=0, Q=3, H=2 -> index in the tables
  const fn = functionMask(ver); const mask = MASKS[fmt.mask];
  const total = Math.floor(rawModules(ver) / 8);
  const bytes = new Uint8Array(total); let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j; const upward = ((right + 1) & 2) === 0; const y = upward ? size - 1 - vert : vert;
      if (fn[y][x] || bitIdx >= total * 8) continue;
      const dark = (m[y][x] ? 1 : 0) ^ (mask(x, y) ? 1 : 0);
      bytes[bitIdx >> 3] |= dark << (7 - (bitIdx & 7)); bitIdx++;
    }
  }
  // de-interleave the blocks and correct each one
  const nb = NUM_BLOCKS[eccIdx][ver]; const epb = ECC_PER_BLOCK[eccIdx][ver];
  const shortLen = Math.floor(total / nb) - epb; const numShort = nb - (total % nb);
  const blocks = Array.from({ length: nb }, (_, i) => new Array(shortLen + (i < numShort ? 0 : 1) + epb));
  let k = 0;
  // simple interleaving: data bytes column by column, then ecc bytes column by column
  const dataLen = (j) => shortLen + (j < numShort ? 0 : 1);
  for (let i = 0; i < shortLen + 1; i++) for (let j = 0; j < nb; j++) if (i < dataLen(j)) blocks[j][i] = bytes[k++];
  for (let i = 0; i < epb; i++) for (let j = 0; j < nb; j++) blocks[j][dataLen(j) + i] = bytes[k++];
  const data = [];
  for (let j = 0; j < nb; j++) {
    if (!rsCorrect(blocks[j], epb)) return null;
    for (let i = 0; i < dataLen(j); i++) data.push(blocks[j][i]);
  }
  return parseSegments(Uint8Array.from(data), ver);
}

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function parseSegments(data, ver) {
  let pos = 0; const total = data.length * 8; let out = '';
  const read = (n) => { let v = 0; for (let i = 0; i < n; i++) { if (pos >= total) throw new Error('end'); v = (v << 1) | ((data[pos >> 3] >> (7 - (pos & 7))) & 1); pos++; } return v; };
  const cc = (a, b, c) => (ver <= 9 ? a : ver <= 26 ? b : c);
  try {
    for (;;) {
      if (total - pos < 4) break;
      const mode = read(4);
      if (mode === 0) break;
      if (mode === 1) { // numeric
        let n = read(cc(10, 12, 14));
        while (n >= 3) { out += String(read(10)).padStart(3, '0'); n -= 3; }
        if (n === 2) out += String(read(7)).padStart(2, '0'); else if (n === 1) out += String(read(4));
      } else if (mode === 2) { // alphanumeric
        let n = read(cc(9, 11, 13));
        while (n >= 2) { const v = read(11); out += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; n -= 2; }
        if (n === 1) out += ALNUM[read(6)];
      } else if (mode === 4) { // bytes: UTF-8 (what every modern generator writes), else Latin-1
        const n = read(cc(8, 16, 16)); const b = new Uint8Array(n);
        for (let i = 0; i < n; i++) b[i] = read(8);
        try { out += new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { out += Buffer.from(b).toString('latin1'); }
      } else if (mode === 7) { // ECI: the number is skipped (text stays UTF-8)
        const first = read(8); if (first & 0x80) read((first & 0x40) ? 16 : 8);
      } else if (mode === 3) read(16); // structured append
      else if (mode === 5) { /* FNC1 */ } else if (mode === 9) read(8);
      else if (mode === 8) { const n = read(cc(8, 10, 12)); for (let i = 0; i < n; i++) read(13); out += '?'; } // kanji: not needed here
      else return null;
    }
  } catch (e) { /* ran out of bits at the end: normal */ }
  return out;
}

// ---------------------------------------------------------------- finding the code in a picture
function toGray(img) {
  const { data, width, height } = img; const g = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  return g;
}

/** 1 = dark. Local threshold (mean of the neighbourhood), robust to shadows and to screens. */
function binarizeLocal(gray, w, h, invert) {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += gray[y * w + x]; integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row; } }
  const r = Math.max(6, Math.floor(Math.min(w, h) / 20)); const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r); const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r); const x1 = Math.min(w, x + r + 1);
      const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const dark = gray[y * w + x] < mean * 0.92 - 2;
      out[y * w + x] = (invert ? !dark : dark) ? 1 : 0;
    }
  }
  return out;
}

function binarizeGlobal(gray, w, h, invert) {
  const hist = new Array(256).fill(0); for (const v of gray) hist[v]++;
  const total = gray.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sb = 0; let wb = 0; let best = 0; let bt = 128;
  for (let t = 0; t < 256; t++) { wb += hist[t]; if (!wb) continue; const wf = total - wb; if (!wf) break; sb += t * hist[t]; const v = wb * wf * (sb / wb - (sum - sb) / wf) ** 2; if (v > best) { best = v; bt = t; } }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (gray[i] <= bt) !== invert ? 1 : 0;
  return out;
}

/** Runs of equal pixels along a line: [{v, len}]. */
function runsOf(get, n) {
  const runs = []; let v = get(0); let len = 1;
  for (let i = 1; i < n; i++) { const c = get(i); if (c === v) len++; else { runs.push([v, len]); v = c; len = 1; } }
  runs.push([v, len]);
  return runs;
}
function ratioOk(a, b, c, d, e) { // 1:1:3:1:1
  const total = a + b + c + d + e; if (total < 7) return false;
  const m = total / 7; const tol = m * 0.7;
  return Math.abs(a - m) < tol && Math.abs(b - m) < tol && Math.abs(c - 3 * m) < 3 * tol && Math.abs(d - m) < tol && Math.abs(e - m) < tol;
}

/** Does the picture around (cx, cy) look like a finder pattern (black centre, white ring, black ring), whatever its rotation? */
function looksLikeFinder(bin, w, h, cx, cy, m) {
  const at = (x, y) => { const xi = Math.round(x); const yi = Math.round(y); return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : bin[yi * w + xi]; };
  let best = 0; const N = 24;
  for (let a = 0; a < 16; a++) {
    const phi = (a / 16) * (Math.PI / 2); let good = 0; let total = 0;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * 2 * Math.PI; const f = 1 / Math.max(Math.abs(Math.cos(th - phi)), Math.abs(Math.sin(th - phi)));
      for (const [k, want] of [[3, 1], [2, 0], [0.6, 1]]) {
        const v = at(cx + Math.cos(th) * k * m * f, cy + Math.sin(th) * k * m * f);
        if (v < 0) { total++; continue; }
        total++; if (v === want) good++;
      }
    }
    best = Math.max(best, good / total);
  }
  return best >= 0.9;
}

function findFinders(bin, w, h) {
  const cands = [];
  for (let y = 0; y < h; y++) {
    const runs = runsOf((x) => bin[y * w + x], w); let x = 0; const starts = [];
    for (const [, len] of runs) { starts.push(x); x += len; }
    for (let i = 0; i + 4 < runs.length; i++) {
      if (runs[i][0] !== 1) continue;
      const [a, b, c, d, e] = [0, 1, 2, 3, 4].map((k) => runs[i + k][1]);
      if (!ratioOk(a, b, c, d, e)) continue;
      const cx = starts[i + 2] + c / 2; const mod = (a + b + c + d + e) / 7;
      // check the same pattern going down the middle column
      const col = Math.floor(cx);
      let up = y; while (up > 0 && bin[(up - 1) * w + col]) up--;                                   // top of the central black part
      let down = y; while (down < h - 1 && bin[(down + 1) * w + col]) down++;
      const centre = down - up + 1;
      let u1 = up - 1; let u1n = 0; while (u1 >= 0 && !bin[u1 * w + col]) { u1n++; u1--; }
      let u2n = 0; while (u1 >= 0 && bin[u1 * w + col]) { u2n++; u1--; }
      let d1 = down + 1; let d1n = 0; while (d1 < h && !bin[d1 * w + col]) { d1n++; d1++; }
      let d2n = 0; while (d1 < h && bin[d1 * w + col]) { d2n++; d1++; }
      if (!ratioOk(u2n, u1n, centre, d1n, d2n)) continue;
      const cy = (up + down) / 2;
      cands.push({ x: cx, y: cy, m: (mod + (u2n + u1n + centre + d1n + d2n) / 7) / 2 });
    }
  }
  // merge the candidates seen on several lines
  const groups = [];
  for (const c of cands) {
    const g = groups.find((q) => Math.hypot(q.x - c.x, q.y - c.y) < Math.max(q.m, c.m) * 3);
    if (g) { g.x = (g.x * g.n + c.x) / (g.n + 1); g.y = (g.y * g.n + c.y) / (g.n + 1); g.m = (g.m * g.n + c.m) / (g.n + 1); g.n++; } else groups.push({ x: c.x, y: c.y, m: c.m, n: 1 });
  }
  // a real finder pattern shows 1:1:3:1:1 on about 3 module-heights of lines (its central black square); chance patterns in the data do not
  return groups.filter((g) => g.n >= 2 && g.n >= g.m * 1.8 && g.n <= g.m * 4.2 && looksLikeFinder(bin, w, h, g.x, g.y, g.m)).sort((a, b) => b.n - a.n).slice(0, 24);
}

function pickTriple(f) {
  let best = null; let bestScore = Infinity;
  for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) for (let k = j + 1; k < f.length; k++) {
    const pts = [f[i], f[j], f[k]];
    const ms = pts.map((p) => p.m); if (Math.max(...ms) / Math.min(...ms) > 1.6) continue;
    for (let c = 0; c < 3; c++) { // c = the corner with the right angle
      const o = pts[c]; const p = pts[(c + 1) % 3]; const q = pts[(c + 2) % 3];
      const a = Math.hypot(p.x - o.x, p.y - o.y); const b = Math.hypot(q.x - o.x, q.y - o.y); const h = Math.hypot(p.x - q.x, p.y - q.y);
      const score = Math.abs(a - b) / Math.max(a, b) + Math.abs(h - Math.hypot(a, b)) / h;
      // the distance between two finder centres is (size - 7) modules, and a size is 21, 25, 29... (4 x version + 17)
      const mod = (o.m + p.m + q.m) / 3; const dim = (a + b) / 2 / mod + 7; const ver = (dim - 17) / 4;
      if (dim < 20.5 || dim > 184 || Math.abs(ver - Math.round(ver)) > 0.3) continue;
      const sizeBonus = 1 - Math.min(0.5, dim / 400); // between two similar triples, the bigger one is the code
      if (score * sizeBonus < bestScore && score < 0.35) { bestScore = score * sizeBonus; best = [o, p, q]; }
    }
  }
  if (!best) return null;
  let [tl, tr, bl] = best;
  const cross = (tr.x - tl.x) * (bl.y - tl.y) - (tr.y - tl.y) * (bl.x - tl.x);
  if (cross < 0) [tr, bl] = [bl, tr];
  return { tl, tr, bl };
}

/** Homography from 4 points of the module grid to the picture. */
function homography(src, dst) {
  const A = []; const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]; const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) { // Gauss
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return (x, y) => { const d = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d]; };
}

function sample(bin, w, h, map, size) {
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const at = (px, py) => { const x = Math.round(px); const y = Math.round(py); return x < 0 || y < 0 || x >= w || y >= h ? 0 : bin[y * w + x]; };
  const [ax, ay] = map(0.5, 0.5); const [bx, by] = map(1.5, 0.5); const mod = Math.max(1, Math.hypot(bx - ax, by - ay)); const o = mod * 0.2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [px, py] = map(x + 0.5, y + 0.5);
    const s = at(px, py) * 2 + at(px - o, py) + at(px + o, py) + at(px, py - o) + at(px, py + o);
    m[y][x] = s >= 4;
  }
  return m;
}

function tryTriple(bin, w, h, t) {
  const modPx = (t.tl.m + t.tr.m + t.bl.m) / 3;
  const dTop = Math.hypot(t.tr.x - t.tl.x, t.tr.y - t.tl.y); const dLeft = Math.hypot(t.bl.x - t.tl.x, t.bl.y - t.tl.y);
  const est = ((dTop + dLeft) / 2) / modPx + 7;
  const result = [];
  const base = Math.round((est - 17) / 4);
  // the size measured from the finder patterns is a little off on big codes: the nearest versions are tried in turn
  for (const ver of [base, base - 1, base + 1, base - 2, base + 2, base - 3, base + 3]) {
    if (ver < 1 || ver > 40) continue;
    const size = ver * 4 + 17;
    const unit = (a, b) => [(b.x - a.x) / (size - 7), (b.y - a.y) / (size - 7)];
    const ux = unit(t.tl, t.tr); const uy = unit(t.tl, t.bl);
    const affine = (x, y) => [t.tl.x + (x - 3.5) * ux[0] + (y - 3.5) * uy[0], t.tl.y + (x - 3.5) * ux[1] + (y - 3.5) * uy[1]];
    const maps = [affine];
    if (ver >= 2) { // the alignment pattern near the lower right corner corrects a little perspective
      const [px, py] = affine(size - 6.5, size - 6.5); const mod = Math.hypot(ux[0], ux[1]); let best = null; let bs = 0;
      // the farther the corner, the more a tilted picture moves it: the search widens until the pattern is found
      for (const reach of [3.5, 3.5 + size * 0.06, 3.5 + size * 0.13]) {
        const rad = Math.ceil(mod * reach);
        for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
          let score = 0;
          for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
            const sx = Math.round(px + dx + i * ux[0] + j * uy[0]); const sy = Math.round(py + dy + i * ux[1] + j * uy[1]);
            if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
            const ring = Math.max(Math.abs(i), Math.abs(j)); const want = ring === 1 ? 0 : 1; // black center and outer ring, white between
            if (bin[sy * w + sx] === want) score++;
          }
          if (score > bs) { bs = score; best = [px + dx, py + dy]; }
        }
        if (bs >= 24) break;
      }
      if (best && bs >= 22) {
        const H = homography([[3.5, 3.5], [size - 3.5, 3.5], [3.5, size - 3.5], [size - 6.5, size - 6.5]], [[t.tl.x, t.tl.y], [t.tr.x, t.tr.y], [t.bl.x, t.bl.y], best]);
        if (H) maps.unshift(H);
      }
    }
    for (const map of maps) {
      const m = sample(bin, w, h, map, size);
      let text = decodeMatrix(m);
      if (text === null) { const tr = m.map((row, y) => row.map((_, x) => m[x][y])); text = decodeMatrix(tr); } // a mirrored code
      if (text !== null) result.push(text);
      if (result.length) return result[0];
    }
  }
  return null;
}

/** img: { data: RGBA bytes, width, height }. Returns the text of the first QR code found, or null. */
function decodeQR(img) {
  let { width: w, height: h } = img;
  let gray = toGray(img);
  const passes = [() => binarizeLocal(gray, w, h, false), () => binarizeLocal(gray, w, h, true), () => binarizeGlobal(gray, w, h, false), () => binarizeGlobal(gray, w, h, true)];
  for (const make of passes) {
    const bin = make();
    const finders = findFinders(bin, w, h);
    if (finders.length < 3) continue;
    // try the best triples first
    const tried = new Set();
    for (let n = 3; n <= finders.length; n++) {
      const t = pickTriple(finders.slice(0, n));
      if (!t) continue;
      const key = [t.tl, t.tr, t.bl].map((p) => Math.round(p.x) + ',' + Math.round(p.y)).join('|');
      if (tried.has(key)) continue; tried.add(key);
      const text = tryTriple(bin, w, h, t);
      if (text !== null) return text;
    }
  }
  return null;
}

/** Same, for a picture that may be too big: it is also tried at half size (photos of a screen are often huge). */
function readQR(img) {
  const direct = decodeQR(img);
  if (direct !== null) return direct;
  let cur = img;
  for (let i = 0; i < 2 && Math.min(cur.width, cur.height) >= 400; i++) {
    const w = Math.floor(cur.width / 2); const h = Math.floor(cur.height / 2); const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
      const s = (2 * y * cur.width + 2 * x) * 4 + c; data[(y * w + x) * 4 + c] = (cur.data[s] + cur.data[s + 4] + cur.data[s + cur.width * 4] + cur.data[s + cur.width * 4 + 4]) / 4;
    }
    cur = { data, width: w, height: h };
    const t = decodeQR(cur); if (t !== null) return t;
  }
  return null;
}

module.exports = { readQR, decodeQR, decodeMatrix, rsCorrect, functionMask, alignPositions, rawModules, parseSegments };
