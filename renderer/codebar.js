'use strict';
const strip = document.getElementById('strip');
const chips = new Map();
let timer = null;

function build(items, t) {
  strip.textContent = '';
  chips.clear();
  if (!items.length) {
    const e = document.createElement('span'); e.className = 'empty'; e.textContent = t.empty; strip.appendChild(e); return;
  }
  items.forEach((it) => {
    const b = document.createElement('button'); b.className = 'chip'; b.type = 'button';
    const n = document.createElement('span'); n.className = 'name'; n.textContent = it.name;
    const c = document.createElement('span'); c.className = 'code';
    const tr = document.createElement('div'); tr.className = 'track'; const f = document.createElement('div'); f.className = 'fill'; tr.appendChild(f);
    b.append(n, c, tr);
    b.addEventListener('click', async () => {
      await window.bar.use(it.id);
      const m = document.getElementById('copied'); m.textContent = t.copied; m.classList.add('on'); clearTimeout(timer); timer = setTimeout(() => m.classList.remove('on'), 1400);
    });
    strip.appendChild(b); chips.set(it.id, { c, f });
  });
}

window.bar.onUpdate((data) => {
  document.documentElement.dir = data.rtl ? 'rtl' : 'ltr';
  document.getElementById('hint').textContent = data.items.length ? data.texts.hint : '';
  const ids = data.items.map((i) => i.id).join(',');
  if (strip.dataset.ids !== ids) { strip.dataset.ids = ids; build(data.items, data.texts); }
  data.items.forEach((it) => {
    const ui = chips.get(it.id); if (!ui) return;
    ui.c.textContent = it.pretty; ui.c.classList.toggle('warn', it.remaining <= 5);
    ui.f.style.width = (100 * it.remaining / it.period) + '%';
  });
});
