'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = (ms) => new Date(ms).toLocaleString(window.I18N.locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const toLocalInput = (ms) => { if (!ms) return ''; const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
  const fromLocalInput = (v) => (v ? new Date(v).getTime() : 0);
  let editing = null;

  async function showNotes() {
    const list = await window.api.notes.list();
    const box = $('nList');
    box.textContent = '';
    if (!list.length) { box.appendChild(el('p', 'muted', 'Aucune note pour le moment. Cliquez sur « Nouvelle note », par exemple « Saisir les notes de CC avant vendredi ».')); return; }
    list.forEach((n) => {
      const card = el('div', 'note' + (n.done ? ' done' : ''));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = n.done;
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', async () => { await window.api.notes.done(n.id, cb.checked); showNotes(); });
      const col = el('div', 'ncol');
      col.appendChild(el('b', 'ntitle', n.title));
      if (n.text) col.appendChild(el('span', 'ntext', n.text));
      if (n.remindAt) col.appendChild(el('span', 'nwhen' + (!n.done && n.remindAt < Date.now() ? ' late' : ''), '🔔 ' + fmt(n.remindAt)));
      card.append(cb, col);
      card.addEventListener('click', () => openEditor(n));
      box.appendChild(card);
    });
  }
  window.showNotes = showNotes;

  function openEditor(n) {
    editing = n;
    $('nTitleH').textContent = n ? 'Modifier la note' : 'Nouvelle note';
    $('nTitle').value = n ? n.title : '';
    $('nText').value = n ? n.text : '';
    $('nWhen').value = n ? toLocalInput(n.remindAt) : '';
    $('nDelete').hidden = !n;
    $('dlgNote').returnValue = '';
    $('dlgNote').showModal();
    $('nTitle').focus();
  }

  $('nNew').addEventListener('click', () => openEditor(null));

  $('dlgNote').addEventListener('close', async () => {
    if ($('dlgNote').returnValue !== 'ok') return;
    await window.api.notes.put({ id: editing && editing.id, title: $('nTitle').value, text: $('nText').value, remindAt: fromLocalInput($('nWhen').value) });
    showNotes();
  });

  $('nDelete').addEventListener('click', async () => {
    if (!editing) return;
    $('dlgNote').close('cancel');
    await window.api.notes.remove(editing.id);
    showNotes();
  });

  window.api.on('notes:changed', () => { if (!$('page-notes').hidden) showNotes(); });
})();
