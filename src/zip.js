'use strict';
// Minimal ZIP reader (random access, no size limit) and writer, using only Node's built-in zlib.
const fs = require('fs');
const zlib = require('zlib');

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const n = fs.readSync(fd, buf, off, len - off, pos + off);
    if (n <= 0) break;
    off += n;
  }
  return off === len ? buf : buf.subarray(0, off);
}

class ZipReader {
  constructor(file) {
    this.fd = fs.openSync(file, 'r');
    this.size = fs.fstatSync(this.fd).size;
    this.entries = new Map();
    this._load();
  }
  close() { try { fs.closeSync(this.fd); } catch (e) { /* ignore */ } }

  _load() {
    const tailLen = Math.min(this.size, 66000);
    const tail = readAt(this.fd, this.size - tailLen, tailLen);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    }
    if (e < 0) throw new Error('Not a zip file');
    let count = tail.readUInt16LE(e + 10);
    let cdSize = tail.readUInt32LE(e + 12);
    let cdOff = tail.readUInt32LE(e + 16);
    if (cdOff === 0xffffffff || count === 0xffff) { // zip64
      const locPos = e - 20;
      if (locPos >= 0 && tail.readUInt32LE(locPos) === 0x07064b50) {
        const eocd64 = Number(tail.readBigUInt64LE(locPos + 8));
        const h = readAt(this.fd, eocd64, 56);
        count = Number(h.readBigUInt64LE(32));
        cdSize = Number(h.readBigUInt64LE(40));
        cdOff = Number(h.readBigUInt64LE(48));
      }
    }
    const cd = readAt(this.fd, cdOff, cdSize);
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20);
      let usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28);
      const xlen = cd.readUInt16LE(p + 30);
      const clen = cd.readUInt16LE(p + 32);
      let lho = cd.readUInt32LE(p + 42);
      const crc = cd.readUInt32LE(p + 16);
      const name = cd.toString('utf8', p + 46, p + 46 + nlen);
      // zip64 extra field
      let xp = p + 46 + nlen;
      const xend = xp + xlen;
      while (xp + 4 <= xend) {
        const id = cd.readUInt16LE(xp);
        const sz = cd.readUInt16LE(xp + 2);
        if (id === 1) {
          let q = xp + 4;
          if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (lho === 0xffffffff) { lho = Number(cd.readBigUInt64LE(q)); q += 8; }
        }
        xp += 4 + sz;
      }
      this.entries.set(name, { name, method, csize, usize, lho, crc });
      p += 46 + nlen + xlen + clen;
    }
  }

  has(name) { return this.entries.has(name); }
  entry(name) { return this.entries.get(name) || null; }

  read(name) {
    const en = this.entries.get(name);
    if (!en) return null;
    const lh = readAt(this.fd, en.lho, 30);
    const nlen = lh.readUInt16LE(26);
    const xlen = lh.readUInt16LE(28);
    const data = readAt(this.fd, en.lho + 30 + nlen + xlen, en.csize);
    if (en.method === 0) return data;
    if (en.method === 8) return zlib.inflateRawSync(data);
    throw new Error('Unsupported zip method ' + en.method);
  }
  readText(name) { const b = this.read(name); return b ? b.toString('utf8') : null; }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: array of [name, string|Buffer]. Returns a Buffer holding the zip. */
function writeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // utf-8 names
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

module.exports = { ZipReader, writeZip, crc32 };
