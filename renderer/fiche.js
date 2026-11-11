'use strict';
const $ = (id) => document.getElementById(id);
const form = $('form');
let ready = false;

function setReady(on) {
  ready = on;
  $('btnCreate').disabled = !on;
  $('card2').classList.toggle('off', !on);
}
setReady(false);

function fill(fields) {
  for (const k of ['niveau', 'semestre', 'periode', 'seance', 'unite', 'uniteTitre', 'pages', 'tache', 'titre']) form.elements[k].value = fields[k] || '';
  form.elements.objectifs.value = (fields.objectifs || []).join('\n');
}

function setBook(ready) {
  const cb = $('useBooks');
  cb.checked = !!ready; cb.disabled = !ready;
  cb.parentElement.title = ready ? '' : window.T('Le livre de ce niveau n\'est pas installé : importez ses pages dans l\'écran Livres.');
}

function showNotes(notes) {
  const box = $('notes');
  box.textContent = '';
  if (!notes || !notes.length) { box.hidden = true; return; }
  const b = document.createElement('b');
  b.textContent = 'À vérifier';
  const ul = document.createElement('ul');
  notes.slice(0, 8).forEach((n) => { const li = document.createElement('li'); li.textContent = n; ul.appendChild(li); });
  box.append(b, ul);
  box.hidden = false;
}

$('btnChoose').addEventListener('click', async () => {
  $('status').textContent = 'Lecture du PowerPoint…';
  $('result').hidden = true;
  showNotes([]);
  const r = await window.api.chooseFiche();
  if (r.canceled) { $('status').textContent = ''; return; }
  if (!r.ok) { $('status').textContent = r.error; setReady(false); return; }
  $('pptInfo').textContent = `${r.fileName} : ${r.slides} diapositives`;
  $('status').textContent = '';
  fill(r.fields);
  setBook(r.bookReady);
  setReady(true);
});

$('btnCreate').addEventListener('click', async () => {
  if (!ready) return;
  const fields = Object.fromEntries(new FormData(form).entries());
  fields.useBooks = $('useBooks').checked;
  $('status').textContent = 'Création de la fiche technique…';
  $('btnCreate').disabled = true;
  const r = await window.api.createFiche(fields);
  $('btnCreate').disabled = false;
  if (!r.ok) { $('status').textContent = r.error; return; }
  if (r.canceled) { $('status').textContent = ''; showNotes(r.notes); return; }
  $('status').textContent = `Fiche enregistrée : ${r.path}`;
  $('result').hidden = false;
  showNotes(r.notes);
});

$('btnOpen').addEventListener('click', () => window.api.openFiche());
$('btnShow').addEventListener('click', () => window.api.showFiche());
