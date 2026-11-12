'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const url = (id, n) => (window.__bookUrl ? window.__bookUrl(id, n) : `book://${id}/${n}`);
  const T = (s) => (window.T ? window.T(s) : s);
  const ZOOMS = [1, 1.5, 2, 3, 4];

  // ---------------------------------------------------------------- the shelf
  async function showBooks() {
    $('bkReader').hidden = true; $('bkShelf').hidden = false;
    const list = await window.api.books.list();
    const box = $('bkCards');
    box.textContent = '';
    list.forEach((b) => {
      const card = el('div', 'bkcard' + (b.pages ? '' : ' empty'));
      const cover = el('div', 'bkcover');
      if (b.pages) { const img = el('img'); img.src = url(b.id, 0); img.alt = ''; cover.appendChild(img); } else cover.textContent = '📘';
      const info = el('div', 'bkinfo');
      info.append(el('b', 'bksub', b.subtitle || b.title), el('span', 'bktitle', b.subtitle ? b.title : ''));
      if (b.pages) {
        info.appendChild(el('span', 'bkpages', T(`${b.pages} pages`)));
        if (b.last > 0) { const bar = el('div', 'bkbar'); const fill = el('div', 'bkfill'); fill.style.width = (100 * b.last / Math.max(1, b.pages - 1)) + '%'; bar.appendChild(fill); info.appendChild(bar); }
        info.appendChild(el('span', 'bkgo', b.last > 0 ? `${T('Continuer la lecture')} · ${T(`Page ${b.last + 1} sur ${b.pages}`)}` : T('Commencer la lecture')));
      } else info.appendChild(el('span', 'bkpages', 'Livre non installé'));
      const acts = el('div', 'bkacts');
      const imp = el('button', 'btn', b.pages ? 'Remplacer les pages' : 'Importer les pages du livre');
      imp.addEventListener('click', async (e) => { e.stopPropagation(); report(await window.api.books.importPages(b.id)); });
      const folder = el('button', 'btn', 'Importer le dossier des pages');
      folder.addEventListener('click', async (e) => { e.stopPropagation(); report(await window.api.books.importFolder(b.id)); });
      acts.append(imp, folder);
      if (b.custom || b.pages) {
        const del = el('button', 'btn danger', 'Supprimer ce livre');
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!window.confirm('Supprimer ce livre ?')) return;
          await window.api.books.remove(b.id); showBooks();
        });
        acts.appendChild(del);
      }
      info.appendChild(acts);
      card.append(cover, info);
      if (b.pages) card.addEventListener('click', () => openBook(b.id));
      box.appendChild(card);
    });
  }
  window.showBooks = showBooks;

  function report(r) {
    if (r.canceled) return;
    $('bkMsg').textContent = r.ok ? T(`${r.count} pages`) + ' ✓' : r.error;
    if (r.ok) showBooks();
  }

  function dialog(title, build) {
    $('bkDlgTitle').textContent = title;
    const body = $('bkDlgBody'); body.textContent = '';
    build(body, () => $('dlgBook').close());
    $('dlgBook').returnValue = ''; $('dlgBook').showModal();
  }

  $('bkNew').addEventListener('click', () => dialog('Ajouter un autre livre', (body, close) => {
    const t = el('input'); t.placeholder = 'Titre du livre'; const s = el('input'); s.placeholder = 'Niveau (exemple : 1ère AC)';
    const ok = el('button', 'btn primary', 'Ajouter'); ok.type = 'button';
    ok.addEventListener('click', async () => { const r = await window.api.books.add(t.value, s.value); if (!r.ok) { $('bkMsg').textContent = r.error; } close(); showBooks(); });
    const f1 = el('label', 'field'); f1.appendChild(t); const f2 = el('label', 'field'); f2.appendChild(s);
    body.append(f1, f2, ok);
  }));

  // ---------------------------------------------------------------- the reader
  const R = { book: null, cur: 0, spread: true, zoom: 1, tone: 0, saveTimer: null, wheelAt: 0, marks: [], toast: null, ref: null, anim: null };
  const rd = $('bkReader');
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const normalize = (i) => { i = Math.max(0, Math.min(R.book.pages - 1, i)); return R.spread && i > 0 && i % 2 === 0 ? i - 1 : i; };
  /** The pages shown for a position. Two pages face to face like a real book: the cover alone on the right, then page pairs; a last page without partner stays on the left. */
  function pagesFor(cur) {
    if (!R.spread) return { L: null, R: cur };
    if (cur <= 0) return { L: null, R: 0 };
    return { L: cur, R: cur + 1 < R.book.pages ? cur + 1 : null };
  }
  const visible = () => { const p = pagesFor(R.cur); return [p.L, p.R].filter((x) => x !== null); };

  function fit() {
    const stage = $('rStage'); const imgs = [...$('rPages').querySelectorAll('img')];
    if (!imgs.length || imgs.some((i) => !i.naturalWidth)) return;
    const sw = stage.clientWidth - 8; const sh = stage.clientHeight - 8;
    if (R.spread) {
      if (!R.ref) R.ref = { w: Math.max(...imgs.map((i) => i.naturalWidth)), h: Math.max(...imgs.map((i) => i.naturalHeight)) };
      const s = Math.min(sh / R.ref.h, sw / (2 * R.ref.w)) * R.zoom;
      $('rPages').querySelectorAll('.slot').forEach((sl) => { sl.style.width = R.ref.w * s + 'px'; sl.style.height = R.ref.h * s + 'px'; });
    } else {
      const maxH = Math.max(...imgs.map((i) => i.naturalHeight)); const sumW = imgs.reduce((a, i) => a + i.naturalWidth, 0);
      const s = Math.min(sh / maxH, sw / sumW) * R.zoom;
      imgs.forEach((i) => { i.style.width = i.naturalWidth * s + 'px'; i.style.height = i.naturalHeight * s + 'px'; });
    }
    stage.classList.toggle('zoomed', R.zoom > 1);
  }

  function render() {
    const box = $('rPages'); box.textContent = '';
    const mk = (i) => { const img = el('img'); img.draggable = false; img.alt = ''; img.addEventListener('load', fit); img.src = url(R.book.id, i); return img; };
    const sl = pagesFor(R.cur);
    box.classList.toggle('book', R.spread);
    if (R.spread) {
      const left = el('div', 'slot sl'); const right = el('div', 'slot sr');
      if (sl.L !== null) left.appendChild(mk(sl.L));
      if (sl.R !== null) right.appendChild(mk(sl.R));
      box.append(left, right);
    } else box.appendChild(mk(R.cur));
    fit();
    for (const i of [R.cur - 2, R.cur - 1, R.cur + 2, R.cur + 3]) if (i >= 0 && i < R.book.pages) { const p = new Image(); p.src = url(R.book.id, i); } // the nearby pages are ready
    const vis = visible(); const first = vis[0]; const last = vis[vis.length - 1];
    $('rLabel').textContent = T(`Page ${first + 1} sur ${R.book.pages}`).replace(/\d+/, (m) => (last !== first ? `${first + 1}-${last + 1}` : m));
    $('rSeek').value = R.cur;
    const on = R.marks.includes(R.cur);
    $('rMark').textContent = on ? '★' : '☆'; $('rMark').classList.toggle('on', on);
    $('rStage').scrollTo(0, 0);
  }

  // ---- the page turns like on the phone: the leaf is hinged on the spine and swings over, a shadow follows it
  const TURN_MS = 650;
  function finishAnim() { if (R.anim) { clearTimeout(R.anim.timer); R.anim.box.remove(); R.anim = null; } }
  function animate(old, n) {
    const first = R.spread ? $('rPages').querySelector('.slot.sr') : $('rPages').querySelector('img');
    if (!first) return false;
    const stage = $('rStage'); const sr = stage.getBoundingClientRect(); const fr = first.getBoundingClientRect();
    if (!fr.width || !fr.height) return false;
    const sw = fr.width; const sh = fr.height; const hx = fr.left - sr.left; const y = fr.top - sr.top; // hx: the spine (or the left edge of a single page)
    const fwd = n > old;
    const A = pagesFor(fwd ? old : n); const B = pagesFor(fwd ? n : old); // earlier / later position
    R.cur = n; render(); // the real page is drawn under the animation
    const box = el('div', 'flipbox'); box.style.perspectiveOrigin = `${hx}px 50%`;
    const page = (idx, x) => { const d = el('div', 'pg'); d.style.cssText = `left:${x}px;top:${y}px;width:${sw}px;height:${sh}px`; if (idx !== null) { const im = el('img'); im.draggable = false; im.alt = ''; im.src = url(R.book.id, idx); d.appendChild(im); } return d; };
    if (R.spread) { if (A.L !== null) box.appendChild(page(A.L, hx - sw)); if (B.R !== null) box.appendChild(page(B.R, hx)); } else box.appendChild(page(B.R, hx));
    const leaf = el('div', 'leaf'); leaf.style.cssText = `left:${hx}px;top:${y}px;width:${sw}px;height:${sh}px;transform:rotateY(${fwd ? 0 : -180}deg)`;
    const faceOf = (idx, cls) => { const f = el('div', cls); if (idx !== null) { const im = el('img'); im.draggable = false; im.alt = ''; im.src = url(R.book.id, idx); f.appendChild(im); } return f; };
    leaf.appendChild(faceOf(A.R, 'face'));
    if (R.spread && B.L !== null) leaf.appendChild(faceOf(B.L, 'face back'));
    box.appendChild(leaf);
    const cast = el('div', 'cast'); cast.style.cssText = `left:${R.spread ? hx - sw : hx}px;top:${y}px;width:${R.spread ? sw * 2 : sw}px;height:${sh}px`; box.appendChild(cast);
    stage.appendChild(box);
    void box.offsetWidth; // the start position is drawn before the move
    requestAnimationFrame(() => { leaf.style.transform = `rotateY(${fwd ? -180 : 0}deg)`; });
    R.anim = { box, timer: setTimeout(finishAnim, TURN_MS + 60) };
    return true;
  }

  function goTo(i) {
    const n = normalize(i);
    if (n === R.cur && $('rPages').children.length) return;
    const old = R.cur; finishAnim();
    const shown = old >= 0 && $('rPages').children.length && !rd.hidden;
    if (!(shown && R.zoom === 1 && !reduced() && Math.abs(n - old) <= 2 && animate(old, n))) { R.cur = n; render(); }
    clearTimeout(R.saveTimer); R.saveTimer = setTimeout(() => window.api.books.setLast(R.book.id, R.cur), 300);
  }
  const next = () => { const i = R.spread ? (R.cur === 0 ? 1 : R.cur + 2) : R.cur + 1; if (i < R.book.pages) goTo(i); };
  const prev = () => { const i = R.spread ? (R.cur <= 1 ? 0 : R.cur - 2) : R.cur - 1; if (i >= 0) goTo(i); };

  function say(text) {
    let t = $('rToast'); if (!t) { t = el('div', 'rtoast'); t.id = 'rToast'; rd.appendChild(t); }
    t.textContent = text; t.classList.add('show'); clearTimeout(R.toast); R.toast = setTimeout(() => t.classList.remove('show'), 1600);
  }

  async function openBook(id) {
    const b = await window.api.books.open(id);
    if (!b) { $('bkMsg').textContent = 'Ce livre n\'a pas pu être ouvert.'; return; }
    R.book = b; R.marks = b.marks; R.tone = b.tone; R.zoom = 1;
    R.spread = true; R.ref = null; finishAnim(); $('rSpread').classList.add('on');
    $('rSeek').max = Math.max(1, b.pages - 1);
    $('rTitle').textContent = `${b.title} ${b.subtitle}`.trim();
    $('bkShelf').hidden = true; rd.hidden = false; setTone(R.tone);
    R.cur = -1; goTo(b.last);
  }

  function leave() {
    if (!R.book || rd.hidden) return;
    clearTimeout(R.saveTimer); window.api.books.setLast(R.book.id, R.cur);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    rd.hidden = true;
  }
  window.leaveBooks = leave;

  function setTone(t) { R.tone = t; rd.className = 'reader tone' + t; }

  function zoom(dir) {
    const i = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(R.zoom) + dir));
    R.zoom = ZOOMS[i]; fit();
  }

  // buttons
  $('rBack').addEventListener('click', () => { leave(); showBooks(); });
  $('rPrev').addEventListener('click', prev); $('rNext').addEventListener('click', next);
  $('rZoomIn').addEventListener('click', () => zoom(1)); $('rZoomOut').addEventListener('click', () => zoom(-1));
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else document.documentElement.requestFullscreen().catch(() => {}); };
  $('rFull').addEventListener('click', toggleFull);
  document.addEventListener('fullscreenchange', () => { if (!rd.hidden) rd.classList.toggle('nobars', !!document.fullscreenElement); finishAnim(); setTimeout(fit, 60); });
  $('rSpread').addEventListener('click', () => { R.spread = !R.spread; $('rSpread').classList.toggle('on', R.spread); const c = R.cur; R.cur = -1; goTo(c); });
  $('rMark').addEventListener('click', async () => {
    const now = await window.api.books.toggleMark(R.book.id, R.cur);
    R.marks = now ? [...R.marks, R.cur].sort((a, b) => a - b) : R.marks.filter((x) => x !== R.cur);
    $('rMark').textContent = now ? '★' : '☆'; $('rMark').classList.toggle('on', now);
    say(now ? T(`Marque-page ajouté à la page ${R.cur + 1}`) : T('Marque-page retiré'));
  });
  $('rMarks').addEventListener('click', () => dialog('Marque-pages', (body, close) => {
    if (!R.marks.length) { body.appendChild(el('p', 'muted', 'Aucun marque-page. Touchez l\'étoile en haut pour marquer la page en cours.')); return; }
    R.marks.forEach((m) => { const b = el('button', 'pickrow', T(`Page ${m + 1}`)); b.type = 'button'; b.addEventListener('click', () => { close(); goTo(m); }); body.appendChild(b); });
  }));
  $('rTone').addEventListener('click', () => dialog('Affichage', (body, close) => {
    ['Normal', 'Sépia', 'Nuit'].forEach((name, i) => { const b = el('button', 'pickrow' + (R.tone === i ? ' on' : ''), name); b.type = 'button'; b.addEventListener('click', async () => { close(); setTone(i); await window.api.books.setTone(i); fit(); }); body.appendChild(b); });
  }));
  $('rGo').addEventListener('click', () => dialog('Aller à la page', (body, close) => {
    const n = el('input'); n.type = 'number'; n.min = 1; n.max = R.book.pages; n.placeholder = T(`Numéro de page (1 à ${R.book.pages})`);
    const ok = el('button', 'btn primary', 'Aller à'); ok.type = 'button';
    const go = () => { const v = parseInt(n.value, 10); if (v >= 1 && v <= R.book.pages) { close(); goTo(v - 1); } };
    ok.addEventListener('click', go); n.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const f = el('label', 'field'); f.appendChild(n); body.append(f, ok); setTimeout(() => n.focus(), 50);
  }));
  $('rSeek').addEventListener('input', () => { $('rLabel').textContent = T(`Page ${(+$('rSeek').value) + 1} sur ${R.book.pages}`); });
  $('rSeek').addEventListener('change', () => goTo(+$('rSeek').value));

  // the page: click on the sides to turn, double click to zoom, wheel to turn (ctrl + wheel to zoom)
  $('rStage').addEventListener('click', (e) => {
    if (R.zoom > 1) return;
    const r = $('rStage').getBoundingClientRect(); const x = (e.clientX - r.left) / r.width;
    if (x < 0.28) prev(); else if (x > 0.72) next(); else rd.classList.toggle('nobars');
  });
  $('rStage').addEventListener('dblclick', () => { R.zoom = R.zoom > 1 ? 1 : 2; fit(); });
  $('rStage').addEventListener('wheel', (e) => {
    if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); return; }
    if (R.zoom > 1) return;
    e.preventDefault();
    const now = Date.now(); if (now - R.wheelAt < 280) return; R.wheelAt = now;
    if (e.deltaY > 0) next(); else if (e.deltaY < 0) prev();
  }, { passive: false });
  window.addEventListener('resize', () => { if (!rd.hidden) fit(); });
  document.addEventListener('keydown', (e) => {
    if (rd.hidden || $('dlgBook').open || /INPUT|TEXTAREA/.test((e.target.tagName || ''))) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); toggleFull(); }
    else if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); prev(); }
    else if (k === 'Home') goTo(0); else if (k === 'End') goTo(R.book.pages - 1);
    else if (k === '+' || k === '=') zoom(1); else if (k === '-') zoom(-1);
    else if (k === 'b' || k === 'B') $('rMark').click();
    else if (k === 'F11' || k === 'f') { e.preventDefault(); toggleFull(); }
    else if (k === 'Escape' && !document.fullscreenElement) $('rBack').click();
  });
})();
