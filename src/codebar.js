'use strict';
// The strip of Authenticator codes shown under the window of Massar, Haraka, Tabligh and TGR (like on the phone).

const BAR_HEIGHT = 96;

/** The accounts whose name matches the site come first, like on the phone. */
function order(accounts, siteTitle) {
  const t = String(siteTitle || '').toLowerCase();
  const matches = (a) => !!t && (String(a.name || '').toLowerCase().includes(t) || (t === 'tabligh' && /notifrh/i.test(a.name || '')));
  return accounts.map((a, i) => ({ a, i })).sort((x, y) => (matches(y.a) - matches(x.a)) || (x.i - y.i)).map((x) => x.a);
}

/** « 123456 » -> « 123 456 » */
const pretty = (code) => { const c = String(code || ''); return /^\d{4,10}$/.test(c) ? c.slice(0, Math.floor(c.length / 2)) + ' ' + c.slice(Math.floor(c.length / 2)) : '------'; };

/**
 * Run in the site page after it has loaded. Watches for a verification code that is typed and sent (button or Enter): the page then tells the application
 * (through the console) that the strip can go. Returns true when the page is asking for a code right now (a visible code field).
 */
const WATCH_JS = `(function(){
  function visibleInputs(){ return [].slice.call(document.querySelectorAll('input')).filter(function(i){ return i.type!=='password' && i.type!=='hidden' && i.offsetParent!==null; }); }
  function hint(i){ return [i.id,i.name,i.placeholder,i.autocomplete,i.getAttribute('aria-label')].join(' '); }
  var RX=/otp|code|token|verif|totp|2fa|digit|one-time|رمز/i;
  function codeTyped(){
    var ins=visibleInputs();
    if(ins.filter(function(i){return /^[0-9]$/.test(i.value);}).length>=4) return true;
    return ins.some(function(i){ return RX.test(hint(i)) && /^[0-9]{6,8}$/.test((i.value||'').replace(/\\s/g,'')); });
  }
  function asking(){
    var ins=visibleInputs();
    if(ins.filter(function(i){return i.maxLength===1;}).length>=4) return true;
    return ins.some(function(i){ return RX.test(hint(i)); });
  }
  if(!window.__madrassaCodeWatch){
    window.__madrassaCodeWatch=true;
    var SEND=/envoy|valid|v[eé]rif|confirm|soumett|continuer|suivant|connexion|se connecter|submit|send|verify|continue|login|sign in|next|تأكيد|إرسال|ارسال|تحقق|متابعة/i;
    var tell=function(){ console.log('__madrassa_code_submitted__'); };
    document.addEventListener('click',function(e){
      try{ var b=e.target&&e.target.closest?e.target.closest('button, input[type=submit], input[type=button], a, [role=button]'):null; if(!b) return;
        var label=(b.innerText||b.value||b.textContent||'').trim();
        if((b.type==='submit'||SEND.test(label))&&codeTyped()) tell(); }catch(x){}
    },true);
    document.addEventListener('keydown',function(e){ try{ if(e.key==='Enter'&&codeTyped()) tell(); }catch(x){} },true);
    document.addEventListener('submit',function(){ try{ if(codeTyped()) tell(); }catch(x){} },true);
  }
  return asking();
})()`;

module.exports = { BAR_HEIGHT, order, pretty, WATCH_JS };
