'use strict';
// Time-based one-time passwords (RFC 6238), the accounts of the Authenticator, and the Google Authenticator export.
// Port of Totp.kt, AccountStore.kt, Migration.kt and the import of AuthActivity.kt.
const crypto = require('crypto');
const { SecureFile } = require('./vault');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input) {
  const clean = input.toUpperCase().replace(/[ -]/g, '').replace(/=+$/, '');
  if (!clean) throw new Error('Empty key');
  let buffer = 0; let bits = 0; const out = [];
  for (const c of clean) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new Error('Invalid character');
    buffer = (buffer << 5) | v;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 0xff); }
    buffer &= (1 << bits) - 1;
  }
  if (!out.length) throw new Error('Key too short');
  return Buffer.from(out);
}

function base32Encode(data) {
  let s = ''; let buffer = 0; let bits = 0;
  for (const b of data) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) { bits -= 5; s += ALPHABET[(buffer >> bits) & 31]; }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) s += ALPHABET[(buffer << (5 - bits)) & 31];
  return s;
}

function code(key, timeMillis, period, digits, algorithm) {
  const counter = BigInt(Math.floor(timeMillis / 1000 / period));
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(counter);
  const h = crypto.createHmac(algorithm.toLowerCase(), key).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

// ---------- typed key or otpauth:// link ----------

/** An account from a typed key or an otpauth:// link, or null when it is not valid. */
function parseInput(name, raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let secret = text; let digits = 6; let period = 30; let algorithm = 'SHA1'; let finalName = String(name || '').trim();
  if (/^otpauth:\/\//i.test(text)) {
    let u;
    try { u = new URL(text); } catch (e) { return null; }
    secret = u.searchParams.get('secret');
    if (!secret) return null;
    const d = parseInt(u.searchParams.get('digits'), 10); digits = Number.isNaN(d) ? 6 : d;
    const p = parseInt(u.searchParams.get('period'), 10); period = Number.isNaN(p) ? 30 : p;
    algorithm = (u.searchParams.get('algorithm') || 'SHA1').toUpperCase();
    if (!finalName) {
      let path = '';
      try { path = decodeURIComponent(u.pathname).replace(/^\/+/, ''); } catch (e) { path = ''; }
      finalName = u.searchParams.get('issuer') || path || '';
    }
  }
  if (!finalName) finalName = 'Account';
  if (digits < 6 || digits > 8 || period <= 0) return null;
  if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm)) return null;
  const account = { name: finalName, secret: secret.replace(/ /g, '').toUpperCase(), digits, period, algorithm };
  try { base32Decode(account.secret); } catch (e) { return null; } // the key must be readable
  return account;
}

// ---------- Google Authenticator « Transfer accounts » (otpauth-migration://offline?data=...) ----------

class Reader {
  constructor(buf) { this.buf = buf; this.pos = 0; }
  hasMore() { return this.pos < this.buf.length; }
  varint() {
    let result = 0n; let shift = 0n;
    for (;;) {
      if (this.pos >= this.buf.length) throw new Error('cut');
      const b = this.buf[this.pos++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7n;
      if (shift >= 70n) throw new Error('too long');
    }
    return Number(result);
  }
  bytes() {
    const len = this.varint();
    if (len < 0 || this.pos + len > this.buf.length) throw new Error('cut');
    const out = this.buf.subarray(this.pos, this.pos + len); this.pos += len; return out;
  }
  skip(wire) {
    if (wire === 0) this.varint(); else if (wire === 1) this.pos += 8; else if (wire === 2) this.bytes(); else if (wire === 5) this.pos += 4;
    else throw new Error('Unknown wire type');
  }
}

function parseOtp(bytes) {
  const r = new Reader(bytes);
  let secret = Buffer.alloc(0); let name = ''; let issuer = ''; let algo = 1; let digitsEnum = 1; let type = 2;
  while (r.hasMore()) {
    const tag = r.varint(); const field = tag >> 3; const wire = tag & 7;
    if (field === 1 && wire === 2) secret = r.bytes();
    else if (field === 2 && wire === 2) name = r.bytes().toString('utf8');
    else if (field === 3 && wire === 2) issuer = r.bytes().toString('utf8');
    else if (field === 4 && wire === 0) algo = r.varint();
    else if (field === 5 && wire === 0) digitsEnum = r.varint();
    else if (field === 6 && wire === 0) type = r.varint();
    else r.skip(wire);
  }
  if (type === 1 || !secret.length) return null; // counter-based (HOTP) is not supported
  const algorithm = algo === 0 || algo === 1 ? 'SHA1' : algo === 2 ? 'SHA256' : algo === 3 ? 'SHA512' : null;
  if (!algorithm) return null;
  const digits = digitsEnum === 2 ? 8 : 6;
  const short = (name.startsWith(issuer + ':') ? name.slice(issuer.length + 1) : name).trim();
  const label = issuer.trim() && short ? `${issuer} (${short})` : issuer.trim() ? issuer : short || 'Account';
  return { name: label, secret: base32Encode(secret), digits, period: 30, algorithm };
}

/** { accounts, skipped } or null when the link cannot be read. */
function parseMigration(link) {
  try {
    const u = new URL(link);
    const data = u.searchParams.get('data');
    if (!data) return null;
    const bytes = Buffer.from(data.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const accounts = []; let skipped = 0;
    const r = new Reader(bytes);
    while (r.hasMore()) {
      const tag = r.varint(); const field = tag >> 3; const wire = tag & 7;
      if (field === 1 && wire === 2) { const a = parseOtp(r.bytes()); if (a) accounts.push(a); else skipped++; }
      else r.skip(wire);
    }
    return { accounts, skipped };
  } catch (e) { return null; }
}

// ---------- the accounts, protected on the disk ----------

class AccountStore {
  constructor(dir, vault) { this.f = new SecureFile(require('path').join(dir, 'accounts.sec'), vault); }
  load() { return this.f.read([]).filter((a) => a && a.secret); }
  /** Adds accounts whose secret is not already stored. Returns how many were added. */
  addAll(list) {
    const cur = this.load(); const known = new Set(cur.map((a) => a.secret)); const fresh = [];
    for (const a of list) {
      if (!a || !a.secret || known.has(a.secret)) continue;
      known.add(a.secret);
      fresh.push({ id: a.id || crypto.randomUUID(), name: a.name || 'Account', secret: a.secret, digits: a.digits || 6, period: a.period || 30, algorithm: a.algorithm || 'SHA1' });
    }
    if (fresh.length) this.f.write(cur.concat(fresh));
    return fresh.length;
  }
  remove(id) { this.f.write(this.load().filter((a) => a.id !== id)); }
  /** The codes to show now. The secrets stay here, they are never sent to the screen. */
  codes(now = Date.now()) {
    return this.load().map((a) => {
      let c = null;
      try { c = code(base32Decode(a.secret), now, a.period, a.digits, a.algorithm); } catch (e) { /* unreadable key */ }
      return { id: a.id, name: a.name, code: c, period: a.period, remaining: a.period - (Math.floor(now / 1000) % a.period) };
    });
  }
  /** Typed key, otpauth:// link or Google export: { ok, message }. */
  importText(name, text) {
    const t = String(text || '').trim();
    if (/^otpauth-migration:\/\//i.test(t)) {
      const r = parseMigration(t);
      if (!r || !r.accounts.length) return { ok: false, message: 'Impossible de lire cet export. Vérifiez qu’il vient bien de l’export de Google Authenticator.' };
      const added = this.addAll(r.accounts);
      let msg = `${added} compte(s) importé(s)`;
      const dup = r.accounts.length - added;
      if (dup > 0) msg += `, ${dup} déjà présent(s)`;
      if (r.skipped > 0) msg += `, ${r.skipped} ignoré(s) (pas basés sur le temps)`;
      return { ok: true, message: msg };
    }
    const a = parseInput(name, t);
    if (!a) return { ok: false, message: 'Clé ou lien invalide. Vérifiez et réessayez.' };
    return this.addAll([a]) === 0 ? { ok: true, message: 'Ce compte est déjà ajouté.' } : { ok: true, message: `${a.name} ajouté` };
  }
}

module.exports = { base32Decode, base32Encode, code, parseInput, parseMigration, AccountStore };
