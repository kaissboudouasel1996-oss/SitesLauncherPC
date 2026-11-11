'use strict';
// The websites of the home page, the saved logins (kept encrypted) and the scripts that fill the login form.
// Port of the login part of WebActivity.kt and CredentialStore.kt.
const { SecureFile } = require('./vault');
const path = require('path');

const SITES = {
  massar: { title: 'Massar', url: 'https://idprovider.men.gov.ma/?RedirectUrl=https://massar.men.gov.ma', hosts: ['men.gov.ma'], codes: true },
  haraka: { title: 'Haraka', url: 'https://haraka.men.gov.ma', hosts: ['men.gov.ma'], codes: true },
  tabligh: { title: 'Tabligh', url: 'https://idprovider.men.gov.ma/?RedirectUrl=https://notifrh.men.gov.ma', hosts: ['men.gov.ma'], codes: true },
  tgr: { title: 'TGR', url: 'https://eservices.tgr.gov.ma/my/auth/login?returnUrl=%2Ffonctionnaire%2FSituationActesGestion', hosts: ['tgr.gov.ma'], codes: true },
  nouveaux: { title: 'Nouveaux Apprentissages', url: 'https://drive.google.com/drive/folders/1axGbul-t9mqRMNfnx9UBeFMzI3LOa-Dn', hosts: ['google.com'], codes: false }
};

/** The login is typed only in a page that belongs to the site: a redirect to another domain gets nothing. */
function allowedHost(siteKey, url) {
  const site = SITES[siteKey];
  if (!site) return false;
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  return site.hosts.some((d) => u.hostname === d || u.hostname.endsWith('.' + d));
}

const LEGACY = { Tabligh: 'NotifRH' }; // logins saved under the old name

/** One username and one password per site, in the layout of the phone ("u_Massar", "p_Massar"). */
class CredentialStore {
  constructor(dir, vault) { this.f = new SecureFile(path.join(dir, 'creds.sec'), vault); }
  all() { const o = this.f.read({}); return o && typeof o === 'object' ? o : {}; }
  get(site) {
    const o = this.all();
    const read = (s) => { const u = o['u_' + s]; const p = o['p_' + s]; return (!u && !p) ? null : { user: u || '', pass: p || '' }; };
    return read(site) || (LEGACY[site] ? read(LEGACY[site]) : null);
  }
  save(site, user, pass) { const o = this.all(); o['u_' + site] = user; o['p_' + site] = pass; this.f.write(o); }
  delete(site) {
    const o = this.all();
    for (const s of [site, LEGACY[site]].filter(Boolean)) { delete o['u_' + s]; delete o['p_' + s]; }
    this.f.write(o);
  }
  /** Everything saved, for the encrypted backup (only the u_ and p_ keys, like the phone). */
  exportAll() { const out = {}; for (const [k, v] of Object.entries(this.all())) if (/^[up]_/.test(k) && typeof v === 'string') out[k] = v; return out; }
  /** Adds the logins of a backup for the sites that have none here. Returns how many were added. */
  importMissing(o) {
    if (!o || typeof o !== 'object') return 0;
    const cur = this.all(); let n = 0;
    const have = new Set(Object.keys(cur).filter((k) => /^[up]_/.test(k)).map((k) => k.slice(2))); // sites that already have a login here
    let changed = false;
    for (const [k, v] of Object.entries(o)) {
      if (!/^[up]_/.test(k) || typeof v !== 'string' || have.has(k.slice(2))) continue;
      cur[k] = v; changed = true;
      if (k.startsWith('u_')) n++;
    }
    if (changed) this.f.write(cur);
    return n;
  }
}

// Fills empty username/password fields; keeps trying for about 20 seconds because login pages often draw their fields a moment after loading.
// When `a` is true it also presses « Connexion » once (the main process only allows it once a minute).
const AUTOFILL_JS = `(function(u, p, a) {
  if (window.__madrassaFill) clearInterval(window.__madrassaFill);
  var tries = 0;
  function setVal(el, v) {
    var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (d && d.set) { d.set.call(el, v); } else { el.value = v; }
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
  }
  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }
  function findSubmit(pw) {
    var scope = pw.form || document;
    var all = [].slice.call(scope.querySelectorAll('button, input[type=submit], input[type=button], a.btn, [role=button]')).filter(visible);
    var named = all.filter(function(b) {
      var t = ((b.innerText || b.value || '') + ' ' + (b.id || '') + ' ' + (b.name || '')).toLowerCase();
      if (/oubli|forgot|mot de passe|inscri|register|نسيت/.test(t)) return false;
      return /connect|login|log in|sign in|se connecter|connexion|valider|دخول|تسجيل|ولوج/.test(t);
    })[0];
    return named || all.filter(function(b) { return b.type === 'submit'; })[0] || null;
  }
  function run() {
    var all = [].slice.call(document.querySelectorAll('input'));
    var pw = all.filter(function(i) { return i.type === 'password' && visible(i); })[0];
    var texts = all.filter(function(i) {
      var t = (i.type || 'text').toLowerCase();
      return (t === 'text' || t === 'email' || t === 'tel') && visible(i) && !i.disabled && !i.readOnly;
    });
    var user = null;
    if (pw) {
      var before = texts.filter(function(i) { return i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING; });
      user = before.length ? before[before.length - 1] : null;
    } else {
      user = texts.filter(function(i) {
        var s = ((i.name || '') + ' ' + (i.id || '') + ' ' + (i.placeholder || '') + ' ' + (i.getAttribute('autocomplete') || '') + ' ' + (i.getAttribute('aria-label') || '')).toLowerCase();
        if (/otp|token|verif|sms|authent|2fa|totp|digit|one-time/.test(s)) return false;
        return /user|login|e-?mail|identifiant|utilisateur|compte|massar/.test(s);
      })[0] || null;
    }
    if (user && !user.value && u) setVal(user, u);
    if (pw && !pw.value && p) setVal(pw, p);
    if (a && pw && pw.value && user && user.value && !window.__madrassaClicked) {
      var btn = findSubmit(pw);
      if (btn) {
        window.__madrassaClicked = true;
        console.log('__madrassa_autoclicked__');
        setTimeout(function() { btn.click(); }, 400);
      }
    }
    tries++;
    if (tries > 40) clearInterval(window.__madrassaFill);
  }
  run();
  window.__madrassaFill = setInterval(run, 500);
})(__U__, __P__, __A__);`;

// JSON.stringify keeps the text safe inside the script; U+2028/2029 are escaped as well.
const lit = (s) => JSON.stringify(String(s)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029').replace(/</g, '\\u003c');
function autofillScript(user, pass, allowClick) {
  return AUTOFILL_JS.replace('__U__', () => lit(user)).replace('__P__', () => lit(pass)).replace('__A__', allowClick ? 'true' : 'false');
}

/** Types a 6-digit code in the field that has the focus; false-y result means « copy it and paste it yourself ». */
function fillCodeScript(code) {
  if (!/^\d{4,10}$/.test(String(code))) return null;
  return `(function(){var e=document.activeElement;
    if(e&&(e.tagName==='INPUT'||e.tagName==='TEXTAREA')){
      var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value');
      if(d&&d.set){d.set.call(e,'${code}');}else{e.value='${code}';}
      e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return 'ok';}
    return 'no';})()`;
}

module.exports = { SITES, allowedHost, CredentialStore, autofillScript, fillCodeScript, AUTOFILL_JS };
