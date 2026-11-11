'use strict';
// Language of the screens: French (default) or Arabic with the layout mirrored. The texts of the screens are written in French
// in the code; in Arabic they are replaced as they appear (and the dialogs too).
(() => {
  const lib = window.I18N_LIB && window.AR_DATA ? window.I18N_LIB.make(window.AR_DATA) : null;
  const I = { lang: 'fr', tr: (s) => s, locale: () => 'fr-FR' };
  window.I18N = I;
  window.T = (s) => (I.lang === 'ar' ? I.tr(s) : s);

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT']);
  const ATTRS = ['placeholder', 'title', 'aria-label'];

  function text(node) {
    if (node.parentNode && SKIP.has(node.parentNode.nodeName)) return;
    const t = I.tr(node.nodeValue);
    if (t !== node.nodeValue) node.nodeValue = t;
  }
  function attrs(el) {
    for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v) { const t = I.tr(v); if (t !== v) el.setAttribute(a, t); } }
  }
  function walk(root) {
    if (root.nodeType === 3) { text(root); return; }
    if (root.nodeType !== 1) return;
    attrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) text(n); else attrs(n); }
  }

  function enableArabic() {
    I.lang = 'ar';
    I.tr = lib.tr;
    I.locale = () => 'ar-MA-u-nu-latn'; // Moroccan month names, western digits
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    document.documentElement.classList.add('ar');
    document.title = I.tr(document.title);
    walk(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') text(m.target);
        else if (m.type === 'attributes') attrs(m.target);
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // the native dialogs (confirm, alert) are translated too
    const c = window.confirm.bind(window); window.confirm = (m) => c(I.tr(String(m)));
    const a = window.alert.bind(window); window.alert = (m) => a(I.tr(String(m)));
  }

  const btn = document.getElementById('langBtn');
  async function init() {
    let lang = 'fr';
    try { lang = await window.api.lang.get(); } catch (e) { /* French */ }
    if (lang === 'ar' && lib) enableArabic();
    if (btn) {
      btn.textContent = lang === 'ar' ? 'Français' : 'العربية';
      btn.addEventListener('click', async () => { await window.api.lang.set(lang === 'ar' ? 'fr' : 'ar'); location.reload(); });
    }
  }
  I.ready = init();
})();
