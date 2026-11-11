'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let timer = null; let busy = false; let fp = '';

  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const r = await window.api.auth.codes();
      const key = r.items.map((a) => a.id).join('|');
      const box = $('aList');
      if (key !== fp) { // the list changed: rebuild; otherwise only the numbers move
        fp = key;
        box.textContent = '';
        if (!r.items.length) box.appendChild(el('p', 'muted', 'Aucun compte pour le moment. Cliquez sur « Ajouter un compte ».'));
        r.items.forEach((a) => {
          const card = el('div', 'acard'); card.dataset.id = a.id;
          const head = el('div', 'ahead');
          head.appendChild(el('span', 'aname', a.name));
          const del = el('button', 'adel', '🗑'); del.title = 'Supprimer ce compte';
          del.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!window.confirm(`Supprimer « ${a.name} » ? Vous perdrez ce générateur de codes : vérifiez que vous pouvez encore vous connecter au site autrement.`)) return;
            await window.api.auth.remove(a.id); fp = ''; refresh();
          });
          head.appendChild(del);
          card.append(head, el('div', 'acode', ''), el('div', 'abar'));
          card.lastChild.appendChild(el('div', 'afill'));
          card.addEventListener('click', async () => {
            const c = card.dataset.code;
            if (!c) return;
            try { await navigator.clipboard.writeText(c); $('aMsg').textContent = 'Code copié.'; } catch (e) { $('aMsg').textContent = 'Copie impossible.'; }
          });
          box.appendChild(card);
        });
      }
      r.items.forEach((a) => {
        const card = box.querySelector(`[data-id="${CSS.escape(a.id)}"]`);
        if (!card) return;
        const c = a.code;
        card.dataset.code = c || '';
        const h = c ? Math.floor(c.length / 2) : 0;
        card.querySelector('.acode').textContent = c ? c.slice(0, h) + ' ' + c.slice(h) : '------';
        card.querySelector('.acode').classList.toggle('warn', a.remaining <= 5);
        card.querySelector('.afill').style.width = (100 * a.remaining / a.period) + '%';
      });
      $('aNote').textContent = r.encrypted ? 'Les clés sont chiffrées sur ce PC avec la protection de votre session Windows.' : '⚠ Le chiffrement de Windows n’est pas disponible : les clés sont enregistrées sans protection.';
    } finally { busy = false; }
  }

  window.showAuth = () => { fp = ''; $('aMsg').textContent = ''; refresh(); clearInterval(timer); timer = setInterval(refresh, 500); };
  window.stopAuth = () => { clearInterval(timer); timer = null; };

  $('aAdd').addEventListener('click', () => { $('aName').value = ''; $('aKey').value = ''; $('aDlgMsg').textContent = ''; $('dlgAuth').returnValue = ''; $('dlgAuth').showModal(); $('aName').focus(); });
  async function readQr(source) {
    const r = await window.api.auth.fromImage(source);
    if (r.canceled) return;
    $('aMsg').textContent = r.message || ''; fp = ''; refresh();
  }
  $('aQrFile').addEventListener('click', () => readQr('file'));
  $('aQrClip').addEventListener('click', () => readQr('clipboard'));
  $('aOk').addEventListener('click', async () => {
    const r = await window.api.auth.add($('aName').value, $('aKey').value);
    if (!r.ok) { $('aDlgMsg').textContent = r.message; return; }
    $('dlgAuth').close('ok');
    $('aMsg').textContent = r.message; fp = ''; refresh();
  });
})();
