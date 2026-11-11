'use strict';
// Reads a lesson PowerPoint (.pptx): texts, notes, hidden slides and the work-mode icon of each slide.
// Port of FichePpt.kt. No size limit: only the parts that are needed are read from the zip.
const path = require('path');
const { ZipReader } = require('./zip');
const xml = require('./xml');
const { decodePng } = require('./png');

const SHAPES = new Set(['sp', 'grpSp', 'pic', 'graphicFrame', 'cxnSp']);
const SAMPLE = 64;
const MAX_PREVIEW = 32 * 1024 * 1024;

// Pluggable bitmap decoder (Electron replaces it with nativeImage, which also reads JPEG/GIF/BMP).
let imageDecoder = (bytes, ext) => {
  if (bytes.length > 4 && bytes.readUInt32BE(0) === 0x89504e47) return decodePng(bytes);
  if (ext === 'bmp') return decodeDib(bytes, true);
  return null;
};
function setImageDecoder(fn) { imageDecoder = fn; }

function parseSlide(text) {
  const paras = [];
  const pics = [];
  let title = '';
  let hiddenSlide = false;
  const hiddenStack = [], picStack = [], phStack = [], yStack = [];
  let hiddenCount = 0, fallback = 0, inT = false, buf = null;
  xml.parse(text, {
    open(n, a) {
      if (n === 'Fallback') { fallback++; return; }
      if (fallback) return;
      if (n === 'sld') hiddenSlide = a.show === '0';
      else if (SHAPES.has(n)) {
        hiddenStack.push(false);
        picStack.push(n === 'pic' ? { x: 0, y: 0, cx: 0, cy: 0, embed: '', descr: '', name: '' } : null);
        phStack.push('');
        yStack.push([-1, 0]);
      } else if (n === 'cNvPr' && hiddenStack.length) {
        if (a.hidden === '1' || a.hidden === 'true') { hiddenStack[hiddenStack.length - 1] = true; hiddenCount++; }
        const pic = picStack[picStack.length - 1];
        if (pic) { pic.descr = a.descr || ''; pic.name = a.name || ''; }
      } else if (n === 'ph' && phStack.length) phStack[phStack.length - 1] = a.type || 'obj';
      else if (n === 'off' && yStack.length) {
        const ox = parseInt(a.x, 10) || 0, oy = parseInt(a.y, 10) || 0;
        const top = yStack[yStack.length - 1];
        if (top[0] < 0) top[0] = oy;
        const pic = picStack[picStack.length - 1];
        if (pic) { pic.x = ox; pic.y = oy; }
      } else if (n === 'ext' && yStack.length && a.cx !== undefined) {
        const ecx = parseInt(a.cx, 10) || 0, ecy = parseInt(a.cy, 10) || 0;
        const top = yStack[yStack.length - 1];
        if (top[1] === 0) top[1] = ecy;
        const pic = picStack[picStack.length - 1];
        if (pic) { pic.cx = ecx; pic.cy = ecy; }
      } else if (n === 'blip' && picStack.length && picStack[picStack.length - 1]) {
        if (a.embed !== undefined) picStack[picStack.length - 1].embed = a.embed;
      } else if (n === 'p') buf = '';
      else if (n === 't') inT = true;
      else if (n === 'br' && buf !== null) buf += ' ';
    },
    text(t) { if (!fallback && inT && buf !== null && hiddenCount === 0) buf += t; },
    close(n) {
      if (n === 'Fallback') { fallback--; return; }
      if (fallback) return;
      if (n === 't') inT = false;
      else if (n === 'p') {
        if (buf !== null && hiddenCount === 0) {
          const t = buf.replace(/\s+/g, ' ').trim();
          if (t) {
            const ph = phStack.length ? phStack[phStack.length - 1] : '';
            const g = yStack.length ? yStack[yStack.length - 1] : null;
            const yc = !g || g[0] < 0 ? -1 : g[0] + Math.floor(g[1] / 2);
            paras.push({ text: t, ph, y: yc });
            if ((ph === 'title' || ph === 'ctrTitle') && !title) title = t;
          }
        }
        buf = null;
      } else if (SHAPES.has(n) && hiddenStack.length) {
        const h = hiddenStack.pop();
        const pic = picStack.pop();
        phStack.pop(); yStack.pop();
        if (h) hiddenCount--;
        if (pic && !h) pics.push(pic);
      }
    }
  });
  return { hidden: hiddenSlide, title, paras, pics };
}

function resolve(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = baseDir ? baseDir.split('/') : [];
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

function readRels(zip, partPath) {
  const relsPath = dirOf(partPath) + '/_rels/' + partPath.slice(partPath.lastIndexOf('/') + 1) + '.rels';
  const t = zip.readText(relsPath);
  const out = {};
  if (!t) return out;
  const base = dirOf(partPath);
  xml.parse(t, {
    open(n, a) {
      if (n === 'Relationship' && a.Id && a.Target && a.TargetMode !== 'External') {
        out[a.Id] = { type: a.Type || '', target: resolve(base, a.Target) };
      }
    }
  });
  return out;
}

function autoMode(label) {
  const t = require('./builder').norm(label);
  if (/oreille|ecoute|\bear\b|listen/.test(t)) return 'L';
  if (/ardoise|tableau|maison|home|house|board|slate/.test(t)) return 'N';
  if (/collectiv|mains? lev|hands?/.test(t)) return 'C';
  if (/binome|paire|pair|duo|fille/.test(t)) return 'B';
  if (/autonom|seul|garcon|solo|individu/.test(t)) return 'A';
  return null;
}

// ---------- recognising the work-mode icon by its colours ----------

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}

function classifyPixels(px) { // px: Uint32Array-like of ARGB ints (a<<24|r<<16|g<<8|b)
  let n = 0, yellow = 0, maroon = 0, blue = 0, purple = 0, peach = 0, pink = 0;
  for (let i = 0; i < px.length; i++) {
    const c = px[i] >>> 0;
    const a = c >>> 24;
    if (a < 40) continue;
    const [h, sat, v] = rgbToHsv((c >>> 16) & 255, (c >>> 8) & 255, c & 255);
    if (sat < 0.12 && v > 0.85) continue;
    n++;
    if (v < 0.30 || sat < 0.15) continue;
    if (h >= 38 && h <= 58 && sat > 0.55 && v > 0.85) yellow++;
    else if (h >= 200 && h <= 235 && sat > 0.5) blue++;
    else if (h > 250 && h < 300) purple++;
    else if (h >= 325 && v < 0.75 && sat > 0.35) maroon++;
    else if (h >= 15 && h < 38 && sat > 0.2) peach++;
    else if ((h < 15 || h > 340) && sat > 0.2) pink++;
  }
  if (n < 40) return null;
  const f = (x) => x / n;
  if (f(yellow) > 0.30) return 'N';
  if (f(maroon) > 0.07) return 'B';
  if (f(blue) + f(purple) > 0.10) return 'A';
  if (f(peach) > 0.50 && f(pink) < 0.15) return 'L';
  if (f(pink) > 0.25 && f(maroon) < 0.03) return 'C';
  return null;
}

/** Area-average downscale of an RGBA bitmap to SAMPLE x SAMPLE ARGB ints. */
function sampleBitmap(img) {
  const out = new Uint32Array(SAMPLE * SAMPLE);
  const { width: w, height: h, data } = img;
  for (let j = 0; j < SAMPLE; j++) {
    const y0 = Math.floor((j * h) / SAMPLE), y1 = Math.max(y0 + 1, Math.floor(((j + 1) * h) / SAMPLE));
    for (let i = 0; i < SAMPLE; i++) {
      const x0 = Math.floor((i * w) / SAMPLE), x1 = Math.max(x0 + 1, Math.floor(((i + 1) * w) / SAMPLE));
      let r = 0, g = 0, b = 0, a = 0, cnt = 0;
      for (let y = y0; y < y1 && y < h; y++) {
        for (let x = x0; x < x1 && x < w; x++) {
          const k = (y * w + x) * 4;
          const al = data[k + 3];
          r += data[k] * al; g += data[k + 1] * al; b += data[k + 2] * al; a += al; cnt++;
        }
      }
      if (!cnt || a === 0) { out[j * SAMPLE + i] = 0; continue; }
      out[j * SAMPLE + i] = (((Math.round(a / cnt) << 24) | (Math.round(r / a) << 16) | (Math.round(g / a) << 8) | Math.round(b / a)) >>> 0);
    }
  }
  return out;
}

/** Plain BMP / DIB (24 or 32 bit, uncompressed). */
function decodeDib(b, withFileHeader) {
  try {
    let p = withFileHeader ? 14 : 0;
    const hs = b.readUInt32LE(p);
    const w = b.readInt32LE(p + 4);
    let h = b.readInt32LE(p + 8);
    const bpp = b.readUInt16LE(p + 14);
    const comp = b.readUInt32LE(p + 16);
    if ((bpp !== 24 && bpp !== 32) || (comp !== 0 && comp !== 3)) return null;
    const topDown = h < 0; h = Math.abs(h);
    let off = p + hs + (comp === 3 && hs === 40 ? 12 : 0);
    if (withFileHeader) off = b.readUInt32LE(10);
    const stride = Math.floor((w * bpp + 31) / 32) * 4;
    const data = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      const row = off + (topDown ? y : h - 1 - y) * stride;
      for (let x = 0; x < w; x++) {
        const s = row + x * (bpp / 8), d = (y * w + x) * 4;
        data[d] = b[s + 2]; data[d + 1] = b[s + 1]; data[d + 2] = b[s];
        data[d + 3] = bpp === 32 ? b[s + 3] || 255 : 255;
      }
    }
    return { width: w, height: h, data };
  } catch (e) { return null; }
}

/** EMF with an EMF+ image object: raw 32-bit pixels or an embedded PNG/JPEG. */
function emfPlusImage(b) {
  let pos = 0;
  while (pos + 16 <= b.length) {
    const type = b.readInt32LE(pos), size = b.readInt32LE(pos + 4);
    if (size < 8 || pos + size > b.length) return null;
    if (type === 70 && b.readInt32LE(pos + 12) === 0x2b464d45) {
      const dsz = b.readInt32LE(pos + 8);
      let p = pos + 16;
      const end = Math.min(pos + 12 + dsz, b.length);
      while (p + 12 <= end) {
        const rt = b.readUInt16LE(p), fl = b.readUInt16LE(p + 2), rs = b.readInt32LE(p + 4), ds = b.readInt32LE(p + 8);
        if (rs < 12 || p + rs > end) break;
        if (rt === 0x4008 && ((fl >> 8) & 0x7f) === 5 && p + 40 <= b.length && b.readInt32LE(p + 16) === 1) {
          const w = b.readInt32LE(p + 20), h = b.readInt32LE(p + 24), stride = b.readInt32LE(p + 28);
          const pf = b.readInt32LE(p + 32), bt = b.readInt32LE(p + 36), start = p + 40;
          if (bt === 0 && w > 0 && h > 0 && stride >= w * 4 && ((pf >> 8) & 0xff) === 32 && start + stride * h <= b.length) {
            const premult = (pf & 0xffffff) === 0x0e200b;
            const data = Buffer.alloc(w * h * 4);
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const s = start + y * stride + x * 4, d = (y * w + x) * 4;
                let bl = b[s], g = b[s + 1], r = b[s + 2];
                const a = b[s + 3];
                if (premult && a > 0 && a < 255) { r = Math.min(255, Math.floor((r * 255) / a)); g = Math.min(255, Math.floor((g * 255) / a)); bl = Math.min(255, Math.floor((bl * 255) / a)); }
                data[d] = r; data[d + 1] = g; data[d + 2] = bl; data[d + 3] = a;
              }
            }
            return { width: w, height: h, data };
          } else if (bt === 1 && ds > 28 && start + (ds - 28) <= b.length) {
            return imageDecoder(b.subarray(start, start + ds - 28), 'png');
          }
          return null;
        }
        p += rs;
      }
    }
    if (type === 14) return null;
    pos += size;
  }
  return null;
}

/** EMF that wraps a plain bitmap (STRETCHDIBITS / BITBLT). */
function emfBitmap(b) {
  let pos = 0;
  while (pos + 8 <= b.length) {
    const type = b.readInt32LE(pos), size = b.readInt32LE(pos + 4);
    if (size < 8 || pos + size > b.length) return null;
    let offBmi = -1, cbBmi = 0, offBits = 0, cbBits = 0;
    if (type === 81 && size >= 80) { offBmi = b.readInt32LE(pos + 48); cbBmi = b.readInt32LE(pos + 52); offBits = b.readInt32LE(pos + 56); cbBits = b.readInt32LE(pos + 60); }
    else if (type === 76 && size >= 100) { offBmi = b.readInt32LE(pos + 84); cbBmi = b.readInt32LE(pos + 88); offBits = b.readInt32LE(pos + 92); cbBits = b.readInt32LE(pos + 96); }
    if (offBmi > 0 && cbBmi > 0 && cbBits > 0 && pos + offBmi + cbBmi <= b.length && pos + offBits + cbBits <= b.length) {
      const dib = Buffer.concat([b.subarray(pos + offBmi, pos + offBmi + cbBmi), b.subarray(pos + offBits, pos + offBits + cbBits)]);
      return decodeDib(dib, false);
    }
    if (type === 14) return null;
    pos += size;
  }
  return null;
}

function classifyIcon(bytes, ext) {
  try {
    let img = null;
    if (ext === 'emf') img = emfPlusImage(bytes) || emfBitmap(bytes);
    else img = imageDecoder(bytes, ext);
    if (!img) return null;
    return classifyPixels(sampleBitmap(img));
  } catch (e) {
    return null;
  }
}

// ---------- reading the whole deck ----------

function read(file, displayName) {
  const zip = new ZipReader(file);
  try {
    if (!zip.has('ppt/presentation.xml')) throw new Error('Not a PowerPoint file');
    let slideW = 12192000, slideH = 6858000;
    xml.parse(zip.readText('ppt/presentation.xml'), {
      open(n, a) { if (n === 'sldSz') { slideW = parseInt(a.cx, 10) || slideW; slideH = parseInt(a.cy, 10) || slideH; } }
    });
    const presText = zip.readText('ppt/presentation.xml');
    const rids = [];
    const re = /<p:sldId\b[^>]*\br:id="([^"]+)"/g;
    let mm;
    while ((mm = re.exec(presText))) rids.push(mm[1]);
    const presRels = readRels(zip, 'ppt/presentation.xml');
    const slidePaths = rids.map((r) => presRels[r] && presRels[r].target).filter(Boolean);

    const slides = [];
    const iconModes = {};
    const tried = new Set();
    slidePaths.forEach((sp, index) => {
      if (!zip.has(sp)) return;
      const parsed = parseSlide(zip.readText(sp));
      const rels = readRels(zip, sp);
      const notes = [];
      const notesRel = Object.values(rels).find((r) => r.type.endsWith('/notesSlide'));
      if (notesRel && zip.has(notesRel.target)) {
        const np = parseSlide(zip.readText(notesRel.target));
        np.paras.filter((p) => p.ph === 'body').forEach((p) => notes.push(p.text));
      }
      // The icon in the top right corner (work mode).
      let best = null;
      for (const pic of parsed.pics) {
        const centerX = pic.x + Math.floor(pic.cx / 2);
        if (pic.cx <= 0 || !pic.embed) continue;
        if (centerX > slideW * 0.55 && pic.y < slideH * 0.30 && pic.cx < slideW * 0.30 && pic.cy < slideH * 0.40) {
          if (!best || pic.x + pic.cx - pic.y > best.x + best.cx - best.y) best = pic;
        }
      }
      let key = null, label = '';
      if (best) {
        const target = rels[best.embed] ? rels[best.embed].target : '';
        const en = target ? zip.entry(target) : null;
        if (en) {
          key = en.crc + '_' + en.usize;
          label = best.descr + ' ' + best.name + ' ' + path.posix.basename(target);
          if (!tried.has(key)) {
            tried.add(key);
            let mode = autoMode(label);
            if (!mode && en.usize >= 1 && en.usize <= MAX_PREVIEW) {
              const ext = (target.split('.').pop() || '').toLowerCase();
              mode = classifyIcon(zip.read(target), ext);
            }
            if (mode) iconModes[key] = mode;
          }
        }
      }
      slides.push({
        number: index + 1, hidden: parsed.hidden, title: parsed.title,
        paras: parsed.paras.map((p) => p.text), ys: parsed.paras.map((p) => p.y),
        notes, iconKey: key, iconLabel: label
      });
    });
    return { fileName: displayName, slides, iconModes };
  } finally {
    zip.close();
  }
}

module.exports = { read, setImageDecoder, classifyIcon, autoMode, parseSlide };
