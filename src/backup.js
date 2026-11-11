'use strict';
// Encrypted backup, same file format as the Android app (MADBK2: AES-256-GCM in 64 KB blocks, key = PBKDF2-SHA256 150 000 rounds).
// The file holds data.json (logins, authenticator, notes, classes, timetable, lesson log, contacts, settings) and files/<name>.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ZipReader, writeZip } = require('./zip');
const { normalize: normClass } = require('./classes');
const { normalize: normNote } = require('./notes');
const timetable = require('./timetable');
const { SecureFile } = require('./vault');

const MAGIC1 = Buffer.from('MADBK1', 'ascii');
const MAGIC2 = Buffer.from('MADBK2', 'ascii');
const CHUNK = 64 * 1024;
const FINAL_BIT = 0x80000000;
const ROUNDS = 150000;

class BackupError extends Error {}
const NOT_BACKUP = 'Ce n’est pas un fichier de sauvegarde Madrassa.';
const WRONG = 'Mot de passe incorrect, ou fichier abîmé.';

const deriveKey = (password, salt) => crypto.pbkdf2Sync(Buffer.from(String(password), 'utf8'), salt, ROUNDS, 32, 'sha256');
function nonce(prefix, counter) { const n = Buffer.alloc(12); prefix.copy(n, 0, 0, 8); n.writeUInt32BE(counter >>> 0, 8); return n; }

/** Encrypts [zip] (a Buffer) into the MADBK2 layout. */
function encrypt(zip, password) {
  const salt = crypto.randomBytes(16); const prefix = crypto.randomBytes(8);
  const key = deriveKey(password, salt);
  const out = [MAGIC2, salt, prefix];
  let counter = 0;
  for (let pos = 0; ; pos += CHUNK) {
    const part = zip.subarray(pos, pos + CHUNK);
    const last = pos + CHUNK >= zip.length;
    const c = crypto.createCipheriv('aes-256-gcm', key, nonce(prefix, counter++));
    c.setAAD(Buffer.from([last ? 1 : 0]));
    const ct = Buffer.concat([c.update(part), c.final(), c.getAuthTag()]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(((ct.length | (last ? FINAL_BIT : 0)) >>> 0));
    out.push(head, ct);
    if (last) break;
  }
  return Buffer.concat(out);
}

/** Decrypts a whole backup file; throws BackupError with a readable message. Returns the zip bytes. */
function decrypt(buf, password) {
  if (buf.length < 6 + 16 + 8) throw new BackupError(NOT_BACKUP);
  const magic = buf.subarray(0, 6);
  const v2 = magic.equals(MAGIC2);
  if (!v2 && !magic.equals(MAGIC1)) throw new BackupError(NOT_BACKUP);
  const salt = buf.subarray(6, 22);
  try {
    if (!v2) { // old format: one block, 12-byte IV, tag at the end
      const iv = buf.subarray(22, 34); const body = buf.subarray(34);
      const d = crypto.createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv);
      d.setAuthTag(body.subarray(body.length - 16));
      return Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
    }
    const prefix = buf.subarray(22, 30);
    const key = deriveKey(password, salt);
    const parts = []; let pos = 30; let counter = 0;
    for (;;) {
      if (pos + 4 > buf.length) throw new Error('cut short');
      const len = buf.readUInt32BE(pos); pos += 4;
      const last = (len & FINAL_BIT) !== 0;
      const size = (len & ~FINAL_BIT) >>> 0;
      if (size < 16 || size > CHUNK + 16 || pos + size > buf.length) throw new Error('bad block');
      const ct = buf.subarray(pos, pos + size); pos += size;
      const d = crypto.createDecipheriv('aes-256-gcm', key, nonce(prefix, counter++));
      d.setAAD(Buffer.from([last ? 1 : 0]));
      d.setAuthTag(ct.subarray(size - 16));
      parts.push(d.update(ct.subarray(0, size - 16)), d.final());
      if (last) break;
    }
    return Buffer.concat(parts);
  } catch (e) { throw new BackupError(WRONG); }
}

// ---------- what is saved ----------
const safeFile = (n) => String(n).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '_').slice(0, 150) || 'fichier';

class Data {
  /** dir: the app data folder. Everything the PC does not use yet (logins, authenticator, contacts, settings, files) is kept as it came. */
  constructor(dir, stores) { this.dir = dir; this.s = stores; this.extrasFile = new SecureFile(path.join(dir, 'extras.sec'), stores.vault); this.filesDir = path.join(dir, 'files'); }
  extras() { return this.extrasFile.read({}); } // saved logins, contacts, settings: protected on the disk like the Authenticator keys

  json() {
    const ex = this.extras();
    const o = { v: 1 };
    const creds = this.s.creds.exportAll();
    if (Object.keys(creds).length) o.creds = creds;
    o.accounts = this.s.accounts.load().map((a) => ({ name: a.name, secret: a.secret, digits: a.digits, period: a.period, algorithm: a.algorithm }));
    o.notes = this.s.notes.load().map((n) => ({ id: n.id, title: n.title, text: n.text, remindAt: n.remindAt, done: n.done }));
    o.classes = this.s.classes.load();
    o.timetable = this.s.tt.load();
    o.cahier = (() => { const c = this.s.cahier.load(); return { days: c.days, skipped: [...c.skipped], manual: c.manual }; })();
    o.contacts = ex.contacts || [];
    if (ex.settings) o.settings = ex.settings;
    return o;
  }

  fileList() {
    try { return fs.readdirSync(this.filesDir).filter((n) => !/\.(mdb|part)$/i.test(n)).map((n) => ({ name: n, file: path.join(this.filesDir, n) })).filter((f) => fs.statSync(f.file).isFile()); } catch (e) { return []; }
  }

  /** The encrypted backup, as a Buffer. */
  create(password) {
    const entries = [['data.json', JSON.stringify(this.json())]];
    for (const f of this.fileList()) entries.push(['files/' + f.name, fs.readFileSync(f.file)]);
    const buf = encrypt(writeZip(entries), password);
    decrypt(buf, password); // checked before it is announced as saved, like on the phone
    return buf;
  }

  /** Adds what this PC does not have yet. Returns a summary. */
  restore(buf, password, now = Date.now()) {
    const zipBytes = decrypt(buf, password);
    const tmp = path.join(os.tmpdir(), 'restore-' + crypto.randomBytes(6).toString('hex') + '.zip');
    fs.writeFileSync(tmp, zipBytes);
    const sum = { logins: 0, accounts: 0, notes: 0, classes: 0, files: 0 };
    let z;
    try {
      z = new ZipReader(tmp);
      const raw = z.has('data.json') ? JSON.parse(z.readText('data.json')) : {};
      const ex = this.extras(); let exChanged = false;
      const keep = (k, v) => { if (v !== undefined && v !== null && ex[k] === undefined) { ex[k] = v; exChanged = true; return true; } return false; };

      if (raw.creds) sum.logins = this.s.creds.importMissing(raw.creds);
      if (Array.isArray(raw.accounts) && raw.accounts.length) sum.accounts = this.s.accounts.addAll(raw.accounts);
      if (Array.isArray(raw.contacts) && raw.contacts.length) keep('contacts', raw.contacts);
      if (raw.settings && Object.keys(raw.settings).length) keep('settings', raw.settings);
      if (exChanged) this.extrasFile.write(ex);

      if (Array.isArray(raw.notes)) {
        const list = this.s.notes.load(); const known = new Set(list.map((n) => n.id));
        for (const o of raw.notes) {
          if (!o || !o.id || known.has(o.id)) continue;
          known.add(o.id);
          const n = normNote(o);
          if (n.remindAt && n.remindAt <= now) n.fired = true; // an old reminder must not ring now
          list.push(n); sum.notes++;
        }
        if (sum.notes) this.s.notes.save(list);
      }
      if (Array.isArray(raw.classes)) {
        const list = this.s.classes.load(); const known = new Set(list.map((c) => c.id));
        for (const o of raw.classes) { if (!o || !o.id || known.has(o.id)) continue; known.add(o.id); list.push(normClass(o)); sum.classes++; }
        if (sum.classes) this.s.classes.save(list);
      }
      if (raw.timetable && Object.keys(raw.timetable).length && timetable.isEmpty(this.s.tt.load())) this.s.tt.save(timetable.normalize(raw.timetable));
      if (raw.cahier && Object.keys(raw.cahier).length) {
        const cur = this.s.cahier.load();
        for (const [k, v] of Object.entries(raw.cahier.days || {})) if (!(k in cur.days)) cur.days[k] = String(v);
        for (const k of raw.cahier.skipped || []) cur.skipped.add(String(k));
        for (const [k, v] of Object.entries(raw.cahier.manual || {})) if (!(k in cur.manual)) cur.manual[k] = String(v);
        this.s.cahier.save(cur);
      }

      for (const name of z.entries.keys()) {
        if (!name.startsWith('files/') || name.endsWith('/')) continue;
        const data = z.read(name);
        const clean = safeFile(name.slice(6));
        fs.mkdirSync(this.filesDir, { recursive: true });
        let target = path.join(this.filesDir, clean);
        if (fs.existsSync(target) && fs.statSync(target).size === data.length) continue;
        for (let i = 1; fs.existsSync(target); i++) { const p = path.parse(clean); target = path.join(this.filesDir, `${p.name} (${i})${p.ext}`); }
        fs.writeFileSync(target, data); sum.files++;
      }
    } catch (e) {
      if (e instanceof BackupError) throw e;
      throw new BackupError('Le contenu de la sauvegarde est illisible.');
    } finally { if (z) z.close(); try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ } }
    return sum;
  }
}

const stamp = (d = new Date()) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

module.exports = { Data, encrypt, decrypt, BackupError, stamp, safeFile };
