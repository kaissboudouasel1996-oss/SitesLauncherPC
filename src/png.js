'use strict';
// Minimal PNG decoder (8-bit, non-interlaced, colour types 0/2/3/4/6). Returns {width,height,data:RGBA} or null.
const zlib = require('zlib');

function decodePng(buf) {
  try {
    if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    let p = 8;
    let w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
    let plte = null, trns = null;
    const idat = [];
    while (p + 8 <= buf.length) {
      const len = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      const d = buf.subarray(p + 8, p + 8 + len);
      if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
      else if (type === 'PLTE') plte = d;
      else if (type === 'tRNS') trns = d;
      else if (type === 'IDAT') idat.push(d);
      else if (type === 'IEND') break;
      p += 12 + len;
    }
    if (depth !== 8 || interlace !== 0 || !w || !h) return null;
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
    if (!ch) return null;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * ch;
    const out = Buffer.alloc(h * stride);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)];
      const src = y * (stride + 1) + 1;
      const dst = y * stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? out[dst + x - ch] : 0;
        const b = y > 0 ? out[dst - stride + x] : 0;
        const c = x >= ch && y > 0 ? out[dst - stride + x - ch] : 0;
        let v = raw[src + x];
        if (f === 1) v += a;
        else if (f === 2) v += b;
        else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        out[dst + x] = v & 255;
      }
    }
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      let r, g, b, a = 255;
      if (ctype === 6) { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3]; }
      else if (ctype === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; }
      else if (ctype === 0) { r = g = b = out[i]; }
      else if (ctype === 4) { r = g = b = out[i * 2]; a = out[i * 2 + 1]; }
      else { const k = out[i]; r = plte[k * 3]; g = plte[k * 3 + 1]; b = plte[k * 3 + 2]; a = trns && k < trns.length ? trns[k] : 255; }
      rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
    }
    return { width: w, height: h, data: rgba };
  } catch (e) {
    return null;
  }
}

module.exports = { decodePng };
