'use strict';
const pages = ['home', 'fiche', 'classes', 'notes', 'timetable', 'cahier', 'calendar', 'backup', 'auth', 'logins', 'files', 'books', 'settings'];

function showPage(name) {
  pages.forEach((p) => { document.getElementById('page-' + p).hidden = p !== name; });
  document.querySelectorAll('.nav[data-page]').forEach((b) => b.classList.toggle('on', b.dataset.page === name));
  if (name === 'classes' && window.showClassList) window.showClassList();
  if (name === 'notes' && window.showNotes) window.showNotes();
  if (name === 'settings' && window.showSettings) window.showSettings();
  if (name === 'books' && window.showBooks) window.showBooks();
  if (name !== 'books' && window.leaveBooks) window.leaveBooks();
  if (name === 'files' && window.showFiles) window.showFiles();
  if (name === 'logins' && window.showLogins) window.showLogins();
  if (name === 'auth' && window.showAuth) window.showAuth();
  if (window.stopAuth && name !== 'auth') window.stopAuth();
  if (name === 'calendar' && window.showCalendar) window.showCalendar();
  if (name === 'cahier' && window.showCahier) window.showCahier();
  if (name === 'timetable' && window.showTimetable) window.showTimetable();
}

document.querySelectorAll('.nav[data-page]').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.page)));
document.querySelectorAll('.site').forEach((b) => b.addEventListener('click', () => window.api.openSite(b.dataset.site)));
window.api.on('nav', (name) => { if (pages.includes(name)) showPage(name); });

(window.I18N.ready || Promise.resolve()).then(() => {
  const d = new Date().toLocaleDateString(window.I18N.locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('today').textContent = d.charAt(0).toUpperCase() + d.slice(1);
});
