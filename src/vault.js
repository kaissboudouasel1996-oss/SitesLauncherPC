'use strict';
// Secrets (Authenticator keys, saved logins) are kept encrypted on the disk with the protection of the Windows session
// (Electron safeStorage = DPAPI): another Windows user, or a copy of the folder on another PC, cannot read them.
const fs = require('fs');
const path = require('path');

const SEALED = 0x45; // 'E'
const PLAIN = 0x50;  // 'P': only when Windows cannot encrypt (never in practice), and in the tests

class Vault {
  /** safe: Electron's safeStorage (or null). */
  constructor(safe = null) { this.safe = safe; }
  get encrypted() { try { return !!this.safe && this.safe.isEncryptionAvailable(); } catch (e) { return false; } }
  seal(text) {
    const body = Buffer.from(text, 'utf8');
    if (this.encrypted) return Buffer.concat([Buffer.from([SEALED]), this.safe.encryptString(text)]);
    return Buffer.concat([Buffer.from([PLAIN]), body]);
  }
  open(buf) {
    if (!buf.length) throw new Error('empty');
    if (buf[0] === SEALED) {
      if (!this.encrypted) throw new Error('This file was encrypted by another Windows session.');
      return this.safe.decryptString(buf.subarray(1));
    }
    if (buf[0] === PLAIN) return buf.subarray(1).toString('utf8');
    return buf.toString('utf8'); // an older, unprotected JSON file
  }
}

/** One JSON file protected by the vault. An older plain JSON file is read as it is and sealed at the next write. */
class SecureFile {
  constructor(file, vault) { this.file = file; this.vault = vault; }
  read(fallback) {
    let buf;
    try { buf = fs.readFileSync(this.file); } catch (e) { return fallback; }
    try { return JSON.parse(this.vault.open(buf)); } catch (e) { return fallback; }
  }
  write(obj) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, this.vault.seal(JSON.stringify(obj)));
    fs.renameSync(tmp, this.file);
  }
  /** True when the file is not protected yet. */
  isPlain() { try { return fs.readFileSync(this.file)[0] !== SEALED; } catch (e) { return false; } }
}

module.exports = { Vault, SecureFile };
