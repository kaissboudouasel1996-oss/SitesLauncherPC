'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, Menu, Notification, safeStorage, clipboard, session, protocol, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const ppt = require('./src/ppt');
const builder = require('./src/builder');
const docx = require('./src/docx');
const sheet = require('./src/sheet');
const suivi = require('./src/suivi');
const grades = require('./src/grades');
const { NoteStore, sorted } = require('./src/notes');
const timetable = require('./src/timetable');
const cahier = require('./src/cahier');
const seating = require('./src/seating');
const holidays = require('./src/holidays');
const backup = require('./src/backup');
const { ClassStore, defaultYear } = require('./src/classes');
const { Vault } = require('./src/vault');
const { SITES, allowedHost, CredentialStore, autofillScript, fillCodeScript } = require('./src/sites');
const totp = require('./src/totp');
const filesLib = require('./src/files');
const i18nLib = require('./renderer/i18n-lib');
const AR = i18nLib.make(require('./src/data/ar.json'));
const { ArabicNames } = require('./src/arabicnames');
const { BookLibrary } = require('./src/books');
const ocr = require('./src/ocr');
const { BookConsigne, pageList } = require('./src/book_consigne');
const ttOcr = require('./src/timetable_ocr');
const qr = require('./src/qr');
const { AccountStore } = require('./src/totp');


const SUBJECTS = {
  'French language': 'Langue française', 'Arabic language': 'Langue arabe', 'English language': 'Langue anglaise',
  'Mathematics': 'Mathématiques', 'Life and Earth sciences': 'Sciences de la vie et de la terre', 'Physics and chemistry': 'Physique-chimie',
  'History and geography': 'Histoire-géographie', 'Islamic education': 'Éducation islamique', 'Computer science': 'Informatique',
  'Physical education': 'Éducation physique', 'Visual arts': 'Arts plastiques', 'Music education': 'Éducation musicale',
  'Technology': 'Technologie', 'Amazigh language': 'Langue amazighe'
};

let store = null;
let notes = null;
let tt = null;
let cahierStore = null;
let vault = null;
let accounts = null;
let creds = null;
let fileStore = null;
let library = null;
let bookConsigne = null;

// automatic updates (electron-updater, from the GitHub releases of the project): only in the installed version, not in the portable one
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { autoUpdater = null; }
const updatesPossible = () => !!autoUpdater && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;

// book://<id>/<page> serves the page pictures to the reader (nothing else can be reached through it)
if (protocol && protocol.registerSchemesAsPrivileged) protocol.registerSchemesAsPrivileged([{ scheme: 'book', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let prefsFile = null;
function prefs() { try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch (e) { return {}; } }
function setPrefs(p) { fs.writeFileSync(prefsFile, JSON.stringify(p), 'utf8'); }
const lang = () => (prefs().lang === 'ar' ? 'ar' : 'fr');
const T = (s) => (lang() === 'ar' ? AR.tr(s) : s); // texts of the native dialogs, menus and notifications
const arabicNames = () => new ArabicNames(prefs().arabic_names);
ipcMain.handle('lang:get', () => lang());
ipcMain.handle('lang:set', (_e, l) => { const p = prefs(); p.lang = l === 'ar' ? 'ar' : 'fr'; setPrefs(p); return p.lang; });
ipcMain.handle('classes:arabicNames', (_e, map) => {
  const names = arabicNames();
  for (const [fr, ar] of Object.entries(map || {})) names.save(fr, ar);
  const p = prefs(); p.arabic_names = names.saved; setPrefs(p);
  return true;
});
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'classe';

// Electron reads PNG/JPEG/BMP/GIF icons natively: better than the built-in PNG decoder.
ppt.setImageDecoder((bytes, ext) => {
  try {
    const img = nativeImage.createFromBuffer(bytes);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    const bgra = img.toBitmap();
    const data = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = bgra[i * 4 + 2]; data[i * 4 + 1] = bgra[i * 4 + 1]; data[i * 4 + 2] = bgra[i * 4]; data[i * 4 + 3] = bgra[i * 4 + 3];
    }
    return { width, height, data };
  } catch (e) { return null; }
});

let win = null;
let deck = null;
let lastSaved = null;

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 820, minHeight: 560, title: 'Madrassa', backgroundColor: '#f4f6f9', icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('fiche:choose', async () => {
  const r = await dialog.showOpenDialog(win, { title: T('Choisir le PowerPoint de la leçon'), properties: ['openFile'], filters: [{ name: 'PowerPoint', extensions: ['pptx'] }] });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const file = r.filePaths[0];
  try {
    deck = ppt.read(file, path.basename(file));
    if (!deck.slides.length) throw new Error('empty');
    const fields = builder.detect(deck);
    const bookId = String(fields.niveau || '').toLowerCase().replace(/\s+/g, '');
    return { ok: true, fileName: deck.fileName, slides: deck.slides.length, fields, bookReady: !!bookId && library.pageCount(bookId) > 0 };
  } catch (e) {
    deck = null;
    return { ok: false, error: 'Ce PowerPoint n’a pas pu être lu.' };
  }
});

ipcMain.handle('fiche:create', async (_e, fields) => {
  if (!deck) return { ok: false, error: 'Choisissez d’abord un PowerPoint.' };
  try {
    const f = {
      niveau: String(fields.niveau || '').trim(), semestre: String(fields.semestre || '').trim() || '1', seance: String(fields.seance || '').trim(),
      unite: String(fields.unite || '').trim(), uniteTitre: String(fields.uniteTitre || '').trim(), tache: String(fields.tache || '').trim(),
      titre: String(fields.titre || '').trim(),
      pages: String(fields.pages || '').trim(), periode: String(fields.periode || '').trim(),
      objectifs: String(fields.objectifs || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    };
    const modeOf = (s) => (s.iconKey ? deck.iconModes[s.iconKey] : null);
    // consignes printed in the book: a first pass lists the activities the fiche needs, their pages are read (once), then the fiche is built
    let bookFn = null; const bookNotes = [];
    if (fields.useBooks && f.niveau) {
      if (!bookConsigne.bookId(f.niveau)) bookNotes.push(`Consignes du livre : le livre ${f.niveau} n’est pas installé (écran Livres), seules les diapositives sont utilisées.`);
      else {
        const wanted = [];
        builder.build(deck, f, modeOf, (act, pages) => { wanted.push(...pageList(pages)); return null; });
        const r = await bookConsigne.prefetch(f.niveau, wanted);
        if (r.failed) bookNotes.push('Consignes du livre : la reconnaissance de texte de Windows n’a pas pu lire les pages (langue française non installée dans Windows ?). Seules les diapositives sont utilisées.');
        bookFn = (act, pages) => bookConsigne.find(f.niveau, act, pages);
      }
    }
    const res = builder.build(deck, f, modeOf, bookFn);
    res.notes = bookNotes.concat(res.notes);
    const out = docx.toBuffer(res.data);
    const def = path.join(app.getPath('documents'), docx.fileName(res.data));
    const r = await dialog.showSaveDialog(win, { title: T('Enregistrer la fiche technique'), defaultPath: def, filters: [{ name: 'Word', extensions: ['docx'] }] });
    if (r.canceled || !r.filePath) return { ok: true, canceled: true, notes: res.notes };
    fs.writeFileSync(r.filePath, out.buffer);
    lastSaved = r.filePath;
    try { // the objectives of the fiche complete the lesson log, like on the phone
      const st = cahierStore.load();
      if (cahier.Cahier.learnFromFiche(st, f.niveau, f.unite, f.seance, f.objectifs)) cahierStore.save(st);
    } catch (e) { /* the fiche is saved anyway */ }
    return { ok: true, path: r.filePath, notes: res.notes, fontPt: out.fontPt };
  } catch (e) {
    return { ok: false, error: 'La fiche n’a pas pu être créée.' };
  }
});

ipcMain.handle('fiche:open', async () => { if (lastSaved) await shell.openPath(lastSaved); return true; });
ipcMain.handle('fiche:show', async () => { if (lastSaved) shell.showItemInFolder(lastSaved); return true; });

// ---------- sites (Massar, Haraka...) : own window, the session is kept between launches ----------
const siteWins = {};
const autoOn = (title) => prefs()['auto_' + title] !== false; // « Connecter » is pressed for you, unless turned off for the site

function showMain(page) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  win.webContents.send('nav', page);
}

/** Types the saved login in the page, only when the page belongs to the site. manual = from the menu: never presses « Connexion ». */
function fillLogin(w, key, manual) {
  if (!w || w.isDestroyed()) return false;
  const site = SITES[key];
  if (!allowedHost(key, w.webContents.getURL())) return false;
  const saved = creds.get(site.title);
  if (!saved) return false;
  // pressing « Connexion » is allowed once a minute at most, so that a wrong password can never lock the account by retrying in a loop
  const allowClick = !manual && autoOn(site.title) && Date.now() - (prefs()['lastauto_' + site.title] || 0) > 60000;
  w.webContents.executeJavaScript(autofillScript(saved.user, saved.pass, allowClick)).catch(() => {});
  return true;
}

/** Puts the code in the field that has the focus and copies it (it is wiped from the clipboard after a minute). */
function typeCode(w, id) {
  const item = accounts.codes().find((x) => x.id === id);
  if (!item || !item.code) return;
  clipboard.writeText(item.code);
  const js = fillCodeScript(item.code);
  if (js && !w.isDestroyed()) w.webContents.executeJavaScript(js).catch(() => {});
  const t = setTimeout(() => { try { if (clipboard.readText() === item.code) clipboard.clear(); } catch (e) { /* ignore */ } }, 60000);
  if (t.unref) t.unref();
}

function siteMenu(w, key) {
  const site = SITES[key];
  const list = site.codes ? accounts.load() : [];
  const codes = site.codes ? [{ type: 'separator' }, { label: T('Codes Authenticator (remplit le champ sélectionné)'), enabled: list.length > 0,
    submenu: list.length ? list.map((a) => ({ label: a.name, click: () => typeCode(w, a.id) })) : [{ label: T('Aucun compte'), enabled: false }] }] : [];
  return Menu.buildFromTemplate([
    { label: T('Connexion'), submenu: [
      { label: T('Remplir mon identifiant'), click: () => {
        if (!fillLogin(w, key, true)) dialog.showMessageBox(w, { type: 'info', message: T('Rien à remplir'), detail: T(`Aucun identifiant n’est enregistré pour ${site.title}, ou cette page n’appartient pas au site.`), buttons: ['OK'] });
      } },
      { label: T('Se connecter automatiquement'), type: 'checkbox', checked: autoOn(site.title), click: (item) => { const p = prefs(); p['auto_' + site.title] = item.checked; setPrefs(p); } },
      { label: T('Gérer les identifiants…'), click: () => showMain('logins') }
    ].concat(codes) },
    { label: T('Page'), submenu: [
      { label: T('Accueil du site'), click: () => w.loadURL(site.url) },
      { label: T('Actualiser'), accelerator: 'F5', click: () => w.webContents.reload() },
      { label: T('Page précédente'), accelerator: 'Alt+Left', click: () => { if (w.webContents.canGoBack()) w.webContents.goBack(); } },
      { type: 'separator' },
      { label: T('Zoom +'), accelerator: 'CommandOrControl+=', click: () => w.webContents.setZoomLevel(w.webContents.getZoomLevel() + 0.5) },
      { label: T('Zoom −'), accelerator: 'CommandOrControl+-', click: () => w.webContents.setZoomLevel(w.webContents.getZoomLevel() - 0.5) }
    ] }
  ]);
}

ipcMain.handle('sites:open', (_e, key) => {
  const site = SITES[key];
  if (!site) return false;
  if (siteWins[key] && !siteWins[key].isDestroyed()) { siteWins[key].focus(); return true; }
  const w = new BrowserWindow({
    width: 1200, height: 800, title: site.title, autoHideMenuBar: false, icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { partition: 'persist:sites', contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  w.setMenu(siteMenu(w, key));
  w.on('focus', () => { if (!w.isDestroyed()) w.setMenu(siteMenu(w, key)); }); // the list of codes follows the accounts
  w.webContents.setWindowOpenHandler(({ url }) => { w.loadURL(url); return { action: 'deny' }; });
  w.on('page-title-updated', (ev) => ev.preventDefault());
  w.webContents.on('did-finish-load', () => fillLogin(w, key, false));
  w.webContents.on('did-navigate-in-page', () => fillLogin(w, key, false));
  // the page script tells when « Connexion » was pressed for you
  w.webContents.on('console-message', (...args) => {
    const msg = args[0] && typeof args[0] === 'object' && args[0].message !== undefined ? args[0].message : args[2];
    if (msg === '__madrassa_autoclicked__') { const p = prefs(); p['lastauto_' + site.title] = Date.now(); setPrefs(p); }
  });
  w.loadURL(site.url);
  siteWins[key] = w;
  return true;
});

// ---------- settings: theme, updates, data folder ----------
const THEMES = ['auto', 'light', 'dark'];
const theme = () => (THEMES.includes(prefs().theme) ? prefs().theme : 'auto');
const applyNativeTheme = () => { try { nativeTheme.themeSource = theme() === 'auto' ? 'system' : theme(); } catch (e) { /* ignore */ } };
const sendUpdate = (u) => { if (win && !win.isDestroyed()) win.webContents.send('update:status', u); };
let updateReady = false;

function setupUpdater() {
  if (!updatesPossible()) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // the new version is installed when the application is closed
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }));
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'available', version: info && info.version }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'progress', percent: Math.round((p && p.percent) || 0) }));
  autoUpdater.on('error', () => sendUpdate({ state: 'error' }));
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true;
    sendUpdate({ state: 'ready', version: info && info.version });
    try { if (Notification.isSupported()) { const n = new Notification({ title: T('Mise à jour téléchargée'), body: T('Elle s’installera à la fermeture de l’application.') }); n.on('click', () => showMain('settings')); n.show(); } } catch (e) { /* the settings page shows it */ }
  });
}

ipcMain.handle('settings:get', () => ({
  lang: lang(), theme: theme(), version: app.getVersion(), autoUpdate: prefs().autoUpdate !== false, updatesPossible: updatesPossible(), dataDir: app.getPath('userData')
}));
ipcMain.handle('settings:setTheme', (_e, t) => { const p = prefs(); p.theme = THEMES.includes(t) ? t : 'auto'; setPrefs(p); applyNativeTheme(); return p.theme; });
ipcMain.handle('settings:setAutoUpdate', (_e, on) => { const p = prefs(); p.autoUpdate = !!on; setPrefs(p); return p.autoUpdate; });
ipcMain.handle('settings:openDataFolder', async () => { await shell.openPath(app.getPath('userData')); return true; });
ipcMain.handle('settings:openExternal', async (_e, url) => { if (/^mailto:[\w.+-]+@[\w.-]+$/.test(String(url))) { await shell.openExternal(String(url)); return true; } return false; });
ipcMain.handle('settings:copy', (_e, text) => { if (/^[\d +]{6,20}$/.test(String(text))) { clipboard.writeText(String(text)); return true; } return false; });
ipcMain.handle('update:check', async () => {
  if (!updatesPossible()) { sendUpdate({ state: 'unavailable' }); return { ok: false, message: T('Les mises à jour automatiques ne sont pas disponibles dans cette version (version portable ou de développement).') }; }
  try { await autoUpdater.checkForUpdates(); return { ok: true }; } catch (e) { sendUpdate({ state: 'error' }); return { ok: false, message: T('La recherche de mise à jour a échoué. Vérifiez votre connexion internet.') }; }
});
ipcMain.handle('update:install', () => { if (updateReady && autoUpdater) { autoUpdater.quitAndInstall(); return true; } return false; });

// ---------- books ----------
function watchBooks() {
  protocol.handle('book', (request) => {
    const hit = library.resolve(request.url);
    if (!hit) return new Response('Not found', { status: 404 });
    try { return new Response(fs.readFileSync(hit.file), { headers: { 'content-type': hit.mime, 'cache-control': 'max-age=600' } }); } catch (e) { return new Response('Not found', { status: 404 }); }
  });
}
ipcMain.handle('books:list', () => library.list());
ipcMain.handle('books:open', (_e, id) => library.open(String(id)));
ipcMain.handle('books:setLast', (_e, id, n) => library.setLast(String(id), n));
ipcMain.handle('books:toggleMark', (_e, id, n) => library.toggleMark(String(id), n | 0));
ipcMain.handle('books:setTone', (_e, t) => library.setTone(t | 0));
ipcMain.handle('books:importPages', async (_e, id) => {
  if (!library.find(String(id))) return { ok: false, error: 'Livre inconnu.' };
  const r = await dialog.showOpenDialog(win, { title: T('Importer les pages du livre'), properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['webp', 'png', 'jpg', 'jpeg'] }] });
  if (r.canceled || !r.filePaths.length) return { ok: true, canceled: true };
  try {
    const n = library.importFiles(String(id), r.filePaths);
    return n ? { ok: true, count: n } : { ok: false, error: 'Aucune image (webp, png, jpg) dans cette sélection.' };
  } catch (e) { return { ok: false, error: 'Les pages n’ont pas pu être importées.' }; }
});
ipcMain.handle('books:importFolder', async (_e, id) => {
  if (!library.find(String(id))) return { ok: false, error: 'Livre inconnu.' };
  const r = await dialog.showOpenDialog(win, { title: T('Importer le dossier des pages'), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return { ok: true, canceled: true };
  try {
    const n = library.importFolder(String(id), r.filePaths[0]);
    return n ? { ok: true, count: n } : { ok: false, error: 'Aucune image (webp, png, jpg) dans cette sélection.' };
  } catch (e) { return { ok: false, error: 'Les pages n’ont pas pu être importées.' }; }
});
ipcMain.handle('books:add', (_e, title, subtitle) => { try { return { ok: true, id: library.addBook(title, subtitle) }; } catch (e) { return { ok: false, error: 'Donnez un titre au livre.' }; } });
ipcMain.handle('books:remove', (_e, id) => library.remove(String(id)));

// ---------- downloads: kept in the app folder, named after what the file really is ----------
function watchDownloads() {
  session.fromPartition('persist:sites').on('will-download', (_e, item) => {
    const url = item.getURL();
    const disposition = item.getContentDisposition ? item.getContentDisposition() : '';
    const suggested = filesLib.resolveName(url, disposition);
    const rawName = suggested !== 'download' ? suggested : filesLib.sanitize(item.getFilename() || 'download');
    const part = fileStore.uniquePath(rawName + '.part');
    item.setSavePath(part);
    item.once('done', (__e, state) => {
      const tell = (title, body, openName) => {
        try {
          if (Notification.isSupported()) {
            const n = new Notification({ title: T(title), body: T(body) });
            if (openName) n.on('click', () => { const f = fileStore.pathOf(openName); if (f) shell.openPath(f); });
            n.show();
          }
        } catch (e) { /* the list of files is enough */ }
        if (win && !win.isDestroyed()) win.webContents.send('files:changed');
      };
      if (state !== 'completed') { try { fs.unlinkSync(part); } catch (e) { /* gone */ } if (state !== 'cancelled') tell('Téléchargement interrompu', rawName); return; }
      try {
        const mime = item.getMimeType ? item.getMimeType() : '';
        const target = fileStore.finish(part, rawName, mime, mime);
        tell('Fichier téléchargé', path.basename(target) + ' (cliquez pour ouvrir)', path.basename(target));
      } catch (e) {
        try { fs.unlinkSync(part); } catch (e2) { /* gone */ }
        tell('Téléchargement refusé', e.message || 'Le fichier n’a pas pu être enregistré.');
      }
    });
  });
}

ipcMain.handle('files:list', () => { try { fileStore.repairNames(); } catch (e) { /* the list is shown anyway */ } return { items: fileStore.list(), dir: fileStore.dir }; });
ipcMain.handle('files:open', async (_e, name) => { const f = fileStore.pathOf(name); if (!f) return { ok: false, error: 'Fichier introuvable.' }; const err = await shell.openPath(f); return err ? { ok: false, error: 'Aucun programme de ce PC ne peut ouvrir ce fichier.' } : { ok: true }; });
ipcMain.handle('files:reveal', (_e, name) => { const f = fileStore.pathOf(name); if (f) shell.showItemInFolder(f); return !!f; });
ipcMain.handle('files:folder', async () => { fileStore.ensure(); await shell.openPath(fileStore.dir); return true; });
ipcMain.handle('files:delete', (_e, names) => fileStore.remove(Array.isArray(names) ? names : []));
ipcMain.handle('files:add', async () => {
  const r = await dialog.showOpenDialog(win, { title: T('Ajouter des fichiers'), properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return { ok: true, added: 0 };
  let n = 0;
  for (const src of r.filePaths) { try { fs.copyFileSync(src, fileStore.uniquePath(path.basename(src))); n++; } catch (e) { /* skipped */ } }
  return { ok: true, added: n };
});

// ---------- saved logins (the passwords never go back to the screen) ----------
ipcMain.handle('logins:list', () => Object.entries(SITES).map(([key, s]) => {
  const c = creds.get(s.title);
  return { key, title: s.title, user: c ? c.user : '', hasPass: !!(c && c.pass), auto: autoOn(s.title), encrypted: vault.encrypted };
}));
ipcMain.handle('logins:save', (_e, d) => {
  const site = SITES[d && d.key];
  if (!site) return { ok: false, message: 'Site inconnu.' };
  const user = String(d.user || '').trim();
  const old = creds.get(site.title);
  const pass = d.pass ? String(d.pass) : (d.keepPass && old ? old.pass : '');
  const p = prefs(); p['auto_' + site.title] = d.auto !== false; setPrefs(p);
  if (!user && !pass) { creds.delete(site.title); return { ok: true, message: 'Rien à enregistrer : identifiant supprimé.' }; }
  creds.save(site.title, user, pass);
  return { ok: true, message: 'Enregistré. Il sera rempli automatiquement.' };
});
ipcMain.handle('logins:delete', (_e, key) => { const site = SITES[key]; if (site) creds.delete(site.title); return true; });

// ---------- classes ----------
let pendingBackup = null;
let pending = null; // roster read from a file, waiting for its name

ipcMain.handle('classes:list', () => store.load().map((c) => ({ id: c.id, name: c.name, count: c.rows.filter((r) => r.some(Boolean)).length })));

ipcMain.handle('classes:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: T('Choisir la liste de la classe'), properties: ['openFile'],
    filters: [{ name: 'Listes (Excel, CSV, Massar)', extensions: ['xlsx', 'xls', 'csv', 'tsv', 'txt', 'html', 'htm'] }, { name: 'Tous les fichiers', extensions: ['*'] }]
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const roster = sheet.loadRoster(r.filePaths[0]);
  if (!roster) { pending = null; return { ok: false, error: 'Aucune liste d’élèves trouvée dans ce fichier.' }; }
  pending = roster;
  return { ok: true, count: roster.rows.length, defaultName: path.basename(r.filePaths[0]).replace(/\.[^.]+$/, '') };
});

function createClass(name, header, rows) {
  const p = prefs();
  const c = store.add({ name, header, rows, year: defaultYear(), subject: p.subject || '', school: p.school || '', direction: p.direction || '' });
  return { ok: true, id: c.id };
}
ipcMain.handle('classes:createFromPick', (_e, name) => {
  name = String(name || '').trim();
  if (!pending || !name) return { ok: false, error: 'Donnez un nom à la classe.' };
  const r = createClass(name, pending.header, pending.rows); pending = null; return r;
});
ipcMain.handle('classes:createFromNames', (_e, name, text) => {
  name = String(name || '').trim();
  const names = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!name || !names.length) return { ok: false, error: 'Indiquez le nom de la classe et au moins un élève.' };
  return createClass(name, ['Nom'], names.map((n) => [n]));
});

ipcMain.handle('classes:get', (_e, id) => {
  const c = store.find(id);
  if (!c) return null;
  const rows = c.rows.map((_, i) => i).filter((i) => c.rows[i].some(Boolean));
  return { id: c.id, name: c.name, subject: c.subject, school: c.school, direction: c.direction, year: c.year || defaultYear(), subjects: SUBJECTS,
    students: rows.map((i) => ({ index: i, name: sheet.studentName(c, i), disc: c.track[i][0], hw: c.track[i][1], rem: c.track[i][2] })) };
});

// The screen sends back only what changed: the header fields and the follow-up of each student.
ipcMain.handle('classes:save', (_e, data) => {
  const c = store.find(data.id);
  if (!c) return false;
  for (const k of ['name', 'subject', 'school', 'direction', 'year']) if (typeof data[k] === 'string') c[k] = data[k].trim();
  for (const s of data.students || []) if (c.track[s.index]) c.track[s.index] = [s.disc, s.hw, s.rem];
  store.update(c);
  const p = prefs();
  for (const k of ['subject', 'school', 'direction']) if (c[k]) p[k] = c[k];
  setPrefs(p);
  return true;
});

ipcMain.handle('classes:grades', async (_e, id, cc) => {
  const c = store.find(id);
  cc = Math.max(1, Math.min(5, cc | 0));
  if (!c) return { ok: false, error: 'Classe introuvable.' };
  try {
    const rows = c.rows.filter((r) => r.some(Boolean));
    const out = grades.build(c.header, rows, cc, T('Moyenne'), T('Moyenne de la classe'));
    const def = path.join(app.getPath('documents'), 'Notes_' + safeName(c.name) + '.xlsx');
    const r = await dialog.showSaveDialog(win, { title: T('Enregistrer la feuille de notes'), defaultPath: def, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (r.canceled || !r.filePath) return { ok: true, canceled: true };
    fs.writeFileSync(r.filePath, out);
    lastSaved = r.filePath;
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, error: 'La feuille de notes n’a pas pu être créée.' }; }
});

ipcMain.handle('classes:remove', (_e, id) => { store.remove(id); return true; });

ipcMain.handle('classes:pdf', async (_e, id, opts) => {
  const c = store.find(id);
  if (!c) return { ok: false, error: 'Classe introuvable.' };
  let w = null;
  try {
    let logo = '';
    try { logo = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'assets', 'logo_ministry.png')).toString('base64'); } catch (e) { /* no logo */ }
    c.subjectLabel = SUBJECTS[c.subject] || c.subject;
    let html;
    if (lang() === 'ar') {
      // the Arabic sheet: mirrored, with the Arabic spelling of the directorate and the school (asked once, then remembered)
      const names = arabicNames();
      const need = names.missing([c.direction, c.school]);
      if (need.length && !(opts && opts.skipNames)) return { ok: false, needArabic: need };
      const labels = {}; for (const [k, v] of Object.entries(suivi.FR)) labels[k] = AR.tr(v);
      c.direction = names.forPdf(c.direction); c.school = names.forPdf(c.school);
      c.subjectLabel = AR.tr(c.subjectLabel);
      html = suivi.buildHtml(c, logo, labels, { rtl: true });
    } else html = suivi.buildHtml(c, logo);
    const tmp = path.join(app.getPath('temp'), 'suivi-' + Date.now() + '.html');
    fs.writeFileSync(tmp, html, 'utf8');
    w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await w.loadFile(tmp);
    const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    const def = path.join(app.getPath('documents'), 'Fiche_de_suivi_' + safeName(c.name) + '.pdf');
    const r = await dialog.showSaveDialog(win, { title: T('Enregistrer la fiche de suivi'), defaultPath: def, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return { ok: true, canceled: true };
    fs.writeFileSync(r.filePath, pdf);
    lastSaved = r.filePath;
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, error: 'Le PDF n’a pas pu être créé.' };
  } finally { if (w && !w.isDestroyed()) w.destroy(); }
});

// ---------- generic HTML -> PDF ----------
async function htmlToPdf(html, opts) {
  const tmp = path.join(app.getPath('temp'), 'sl-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await w.loadFile(tmp);
    return await w.webContents.printToPDF(Object.assign({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true }, opts));
  } finally { if (!w.isDestroyed()) w.destroy(); try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ } }
}

// ---------- notes & reminders ----------
ipcMain.handle('notes:list', () => sorted(notes.load()));
ipcMain.handle('notes:put', (_e, data) => { const n = notes.put(data); checkReminders(); return n; });
ipcMain.handle('notes:done', (_e, id, done) => notes.setDone(id, done));
ipcMain.handle('notes:remove', (_e, id) => { notes.remove(id); return true; });

function checkReminders() {
  if (!notes) return;
  for (const n of notes.takeDue()) {
    if (!Notification.isSupported()) continue;
    const note = new Notification({ title: n.title, body: n.text || T('Rappel') });
    note.on('click', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); win.webContents.send('nav', 'notes'); } });
    note.show();
  }
  if (win && !win.isDestroyed()) win.webContents.send('notes:changed');
}

// ---------- timetable ----------
ipcMain.handle('timetable:get', () => ({ table: tt.load(), days: timetable.DAY_NAMES }));
ipcMain.handle('timetable:save', (_e, t) => { tt.save(t); return true; });
ipcMain.handle('timetable:pdf', async () => {
  try {
    const pdf = await htmlToPdf((lang() === 'ar' ? timetable.buildHtml(tt.load(), AR.tr('Emploi du temps'), { rtl: true, days: timetable.DAY_NAMES.map((d) => AR.tr(d)) }) : timetable.buildHtml(tt.load())), { landscape: true });
    const r = await dialog.showSaveDialog(win, { title: T('Enregistrer l’emploi du temps'), defaultPath: path.join(app.getPath('documents'), 'Emploi_du_temps.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return { ok: true, canceled: true };
    fs.writeFileSync(r.filePath, pdf);
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, error: 'Le PDF n’a pas pu être créé.' }; }
});

// ---------- lesson log (cahier de texte) ----------
ipcMain.handle('cahier:today', () => cahier.todayIso());
ipcMain.handle('cahier:day', (_e, date) => cahier.Cahier.dayView(cahierStore.load(), tt.load(), date));
ipcMain.handle('cahier:detail', (_e, date, period) => cahier.Cahier.detailView(cahierStore.load(), tt.load(), date, period));
ipcMain.handle('cahier:setDay', (_e, date, state) => {
  const st = cahierStore.load();
  if (state === 'off' || state === 'on') st.days[date] = state; else delete st.days[date];
  cahierStore.save(st); return true;
});
ipcMain.handle('cahier:skip', (_e, date, period, on) => {
  const st = cahierStore.load(); const k = date + '|' + period;
  if (on) st.skipped.add(k); else st.skipped.delete(k);
  cahierStore.save(st); return true;
});
ipcMain.handle('cahier:setManual', (_e, level, unit, key, text) => {
  const st = cahierStore.load();
  cahier.Cahier.setManual(st, String(level), parseInt(unit, 10), String(key), text);
  cahierStore.save(st); return true;
});

// ---------- seating plan ----------
function seatingClass(id) {
  const c = store.find(id);
  if (c && seating.sanitize(c)) store.update(c);
  return c;
}
const seatingReply = (c) => Object.assign(seating.view(c), { board: cahier.Cahier.boardText(cahierStore.load(), tt.load(), c.name, cahier.todayIso()) });
ipcMain.handle('seating:get', (_e, id) => { const c = seatingClass(id); return c ? seatingReply(c) : null; });
ipcMain.handle('seating:assign', (_e, id, seat, student) => { const c = seatingClass(id); if (!c) return null; seating.assign(c, seat | 0, student | 0); store.update(c); return seatingReply(c); });
ipcMain.handle('seating:autofill', (_e, id) => { const c = seatingClass(id); if (!c) return null; seating.autoFill(c); store.update(c); return seatingReply(c); });
ipcMain.handle('seating:clear', (_e, id) => { const c = seatingClass(id); if (!c) return null; seating.clear(c); store.update(c); return seatingReply(c); });
ipcMain.handle('seating:pdf', async (_e, id) => {
  const c = seatingClass(id);
  if (!c) return { ok: false, error: 'Classe introuvable.' };
  try {
    const pdf = await htmlToPdf(seating.buildHtml(c, seatingReply(c).board, lang() === 'ar' ? { rtl: true, tr: (x) => AR.tr(x) } : null), { landscape: true });
    const r = await dialog.showSaveDialog(win, { title: T('Enregistrer le plan de classe'), defaultPath: path.join(app.getPath('documents'), 'Plan_de_classe_' + safeName(c.name) + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return { ok: true, canceled: true };
    fs.writeFileSync(r.filePath, pdf);
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, error: 'Le PDF n’a pas pu être créé.' }; }
});

// ---------- school calendar ----------
ipcMain.handle('calendar:view', () => holidays.view(cahier.todayIso()));
ipcMain.handle('calendar:add', async (_e, id) => {
  const text = holidays.ics(id ? [id] : null);
  if (!text) return { ok: false, error: 'Cette fête n’a pas de date fixe.' };
  const name = id ? 'vacance-' + id : 'vacances-2026-2027';
  const tmp = path.join(app.getPath('temp'), name + '.ics');
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    const err = await shell.openPath(tmp); // opens the calendar app (Outlook, Calendrier...) that offers to add it
    if (!err) return { ok: true, opened: true };
    const r = await dialog.showSaveDialog(win, { title: T('Enregistrer le fichier calendrier'), defaultPath: path.join(app.getPath('documents'), name + '.ics'), filters: [{ name: 'Calendrier (.ics)', extensions: ['ics'] }] });
    if (r.canceled || !r.filePath) return { ok: true, canceled: true };
    fs.writeFileSync(r.filePath, text, 'utf8');
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, error: 'Le fichier calendrier n’a pas pu être créé.' }; }
});

// ---------- backup ----------
const backupData = () => new backup.Data(app.getPath('userData'), { notes, classes: store, tt, cahier: cahierStore, accounts, creds, vault });
ipcMain.handle('backup:create', async (_e, password) => {
  password = String(password || '');
  if (password.length < 6) return { ok: false, error: 'Le mot de passe doit contenir au moins 6 caractères.' };
  try {
    const buf = backupData().create(password);
    const r = await dialog.showSaveDialog(win, { title: T('Enregistrer la sauvegarde'), defaultPath: path.join(app.getPath('documents'), 'madrassa-backup-' + backup.stamp() + '.mdb'), filters: [{ name: 'Sauvegarde Madrassa', extensions: ['mdb'] }] });
    if (r.canceled || !r.filePath) return { ok: true, canceled: true };
    fs.writeFileSync(r.filePath, buf);
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, error: 'La sauvegarde n’a pas pu être créée.' }; }
});
ipcMain.handle('backup:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: T('Choisir la sauvegarde'), properties: ['openFile'], filters: [{ name: 'Sauvegarde Madrassa', extensions: ['mdb'] }, { name: 'Tous les fichiers', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  pendingBackup = r.filePaths[0];
  return { ok: true, name: path.basename(pendingBackup) };
});
ipcMain.handle('backup:restore', (_e, password) => {
  if (!pendingBackup) return { ok: false, error: 'Choisissez d’abord le fichier de sauvegarde.' };
  try {
    const sum = backupData().restore(fs.readFileSync(pendingBackup), String(password || ''));
    pendingBackup = null;
    if (win && !win.isDestroyed()) win.webContents.send('notes:changed');
    return { ok: true, summary: sum };
  } catch (e) { return { ok: false, error: e instanceof backup.BackupError ? e.message : 'La restauration a échoué.' }; }
});


// ---------- self test of the packaged app (used by the build on GitHub): `Madrassa.exe --selftest=result.txt` ----------
const selftestArg = process.argv.find((a) => a.startsWith('--selftest='));
async function selfTest(file) {
  const log = [];
  let ok = true;
  const check = (name, cond, extra) => { log.push((cond ? 'OK   ' : 'FAIL ') + name + (extra ? ' : ' + extra : '')); if (!cond) ok = false; };
  const warn = (name, cond, extra) => { log.push((cond ? 'OK   ' : 'WARN ') + name + (extra ? ' : ' + extra : '')); }; // informative: does not stop a release
  try {
    await new Promise((resolve) => { if (win.webContents.isLoading()) win.webContents.once('did-finish-load', resolve); else resolve(); });
    const r = await win.webContents.executeJavaScript(`(async () => ({
      api: typeof window.api, pages: ['home','fiche','classes','notes','timetable','cahier','calendar','backup','auth','logins','files','books','settings'].every((p) => !!document.getElementById('page-' + p)),
      classes: Array.isArray(await window.api.classes.list()), notes: Array.isArray(await window.api.notes.list()),
      tt: (await window.api.timetable.get()).table.cells.length, day: (await window.api.cahier.day(await window.api.cahier.today())).status,
      cal: (await window.api.calendar.view()).items.length, auth: Array.isArray((await window.api.auth.codes()).items)
    }))()`);
    check('renderer and preload', r.api === 'object' && r.pages);
    check('classes / notes / timetable / cahier / calendar', r.classes && r.notes && r.tt === 6 && !!r.day && r.cal === 15 && r.auth, JSON.stringify(r));
    const pdf = await htmlToPdf('<!doctype html><meta charset="utf-8"><body><h1>Test é</h1></body>', {});
    check('PDF', pdf.length > 500 && pdf.subarray(0, 4).toString() === '%PDF', pdf.length + ' bytes');
    const html = suivi.buildHtml({ name: 'T', header: ['Nom'], rows: [['A B']], track: [['+-', '+', 'x']], year: '2026/2027' }, '');
    check('fiche de suivi', html.includes('Fiche de suivi'));
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'logo_ministry.png'));
    check('assets', !img.isEmpty());
    const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'st-'));
    const b = backup.encrypt(Buffer.from('hello'), 'secret1');
    check('backup', backup.decrypt(b, 'secret1').toString() === 'hello');
    // QR code reader (pure JavaScript: it must work everywhere)
    const qrPicture = nativeImage.createFromPath(path.join(__dirname, 'assets', 'selftest_qr.png'));
    check('QR code reader', !qrPicture.isEmpty() && qr.readQR(rgbaOf(qrPicture, 2600)) === 'SELFTEST-QR-1');
    // text recognition of Windows (needs a language with OCR installed: the build machine has English only, so English is tested here)
    try {
      const ow = new BrowserWindow({ show: false, width: 1100, height: 320, webPreferences: { sandbox: true } });
      await ow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="margin:0;background:#fff"><div style="font:bold 96px Arial;padding:50px">HELLO 123 ROOM</div></body>'));
      ow.showInactive(); await new Promise((resolve) => setTimeout(resolve, 600));
      const shot = await ow.webContents.capturePage(); ow.destroy();
      const f = path.join(app.getPath('temp'), 'sl-selftest-ocr.png'); fs.writeFileSync(f, shot.toPNG());
      const r = await ocr.recognize(f, { lang: 'en-US' }); const read = r.words.map((x) => x.text).join(' ');
      warn('Windows text recognition', /HELLO/i.test(read), `read « ${read.slice(0, 60)} » with ${r.lang}`);
    } catch (e) { warn('Windows text recognition', false, `${e.code || ''} ${String(e.message).slice(0, 200)}`); }
    check('updater module', app.isPackaged ? !!autoUpdater : true, 'available=' + !!autoUpdater);
    check('safeStorage (Windows encryption of the keys)', vault.encrypted, 'encrypted=' + vault.encrypted);
    check('user data folder', fs.existsSync(app.getPath('userData')));
  } catch (e) { check('exception', false, String(e && e.stack || e)); }
  fs.writeFileSync(file, (ok ? 'SELFTEST OK\n' : 'SELFTEST FAILED\n') + log.join('\n') + '\n', 'utf8');
  app.exit(ok ? 0 : 1);
}

// ---------- pictures: from a file or from the clipboard (a screenshot) ----------
const NO_PICTURE = 'Le presse-papiers ne contient pas d’image. Copiez une image (ou faites une capture d’écran avec Windows + Maj + S), puis réessayez.';
async function imageFrom(source) {
  if (source === 'clipboard') { const img = clipboard.readImage(); return img.isEmpty() ? { ok: false, error: NO_PICTURE } : { ok: true, img }; }
  const r = await dialog.showOpenDialog(win, { title: T('Choisir une image'), properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }] });
  if (r.canceled || !r.filePaths.length) return { ok: true, canceled: true };
  const img = nativeImage.createFromPath(r.filePaths[0]);
  return img.isEmpty() ? { ok: false, error: 'Cette image n’a pas pu être ouverte.' } : { ok: true, img };
}
/** RGBA pixels of a picture, shrunk when it is very big. */
function rgbaOf(img, maxSide) {
  let size = img.getSize(); const big = Math.max(size.width, size.height);
  if (big > maxSide) { img = img.resize({ width: Math.round(size.width * maxSide / big), quality: 'best' }); size = img.getSize(); }
  const bgra = img.toBitmap(); const data = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) { data[i] = bgra[i + 2]; data[i + 1] = bgra[i + 1]; data[i + 2] = bgra[i]; data[i + 3] = bgra[i + 3]; } // the bitmap is BGRA
  return { data, width: size.width, height: size.height };
}
function ocrMessage(e) {
  if (e && e.code === 'OCR_NO_LANGUAGE') return 'La reconnaissance de texte de Windows n’a aucune langue installée : ajoutez le français dans Paramètres > Heure et langue > Langue et région.';
  if (e && e.code === 'OCR_UNAVAILABLE') return 'La reconnaissance de texte n’est pas disponible sur ce PC.';
  return 'Cette image n’a pas pu être lue.';
}

// timetable from a photo: the text is read with the text recognition of Windows, then placed in the boxes (same rules as on the phone)
let lastOcr = null;
ipcMain.handle('timetable:fromPhoto', async (_e, source, opts) => {
  opts = opts || {};
  let lines; let w; let h;
  if (opts.again && lastOcr) ({ lines, w, h } = lastOcr);
  else {
    const got = await imageFrom(source);
    if (got.canceled) return { ok: true, canceled: true };
    if (!got.ok) return got;
    let img = got.img; const size = img.getSize(); const big = Math.max(size.width, size.height);
    if (big > 3200) img = img.resize({ width: Math.round(size.width * 3200 / big), quality: 'best' });
    const tmp = path.join(app.getPath('temp'), `sl-photo-${Date.now()}.png`);
    try {
      fs.writeFileSync(tmp, img.toPNG());
      const r = await ocr.recognize(tmp, { lang: 'fr' });
      const s2 = img.getSize(); w = r.width || s2.width; h = r.height || s2.height;
      lines = ocr.toLines(r.words);
    } catch (e) { return { ok: false, error: ocrMessage(e) }; } finally { try { fs.unlinkSync(tmp); } catch (e2) { /* gone */ } }
    lastOcr = { lines, w, h };
  }
  if (!ttOcr.hasHeadings(lines) && opts.rtl === undefined) return { ok: false, needDirection: true };
  const table = ttOcr.build(lines, w, h, !!opts.rtl, lang() === 'ar' ? AR.tr('Salle') : 'Salle');
  if (!table) return { ok: false, error: 'Aucun emploi du temps trouvé dans cette image. Essayez une photo nette et bien droite du tableau entier, ou remplissez les cases à la main.' };
  return { ok: true, table, hasCurrent: !timetable.isEmpty(tt.load()) };
});

// ---------- authenticator ----------
ipcMain.handle('auth:fromImage', async (_e, source) => {
  const got = await imageFrom(source);
  if (got.canceled) return { ok: true, canceled: true };
  if (!got.ok) return { ok: false, message: got.error };
  let text = null;
  try { text = qr.readQR(rgbaOf(got.img, 2600)); } catch (e) { text = null; }
  if (text === null) return { ok: false, message: 'Aucun QR code lisible dans cette image. Essayez une capture plus grande et bien nette.' };
  return accounts.importText('', text);
});

ipcMain.handle('auth:codes', () => ({ items: accounts.codes(), encrypted: vault.encrypted }));
ipcMain.handle('auth:add', (_e, name, text) => accounts.importText(name, text));
ipcMain.handle('auth:remove', (_e, id) => { accounts.remove(String(id)); return true; });

app.whenReady().then(() => {
  const dataDir = app.getPath('userData');
  store = new ClassStore(dataDir);
  prefsFile = path.join(dataDir, 'prefs.json');
  notes = new NoteStore(dataDir);
  tt = new timetable.TimetableStore(dataDir);
  cahierStore = new cahier.CahierStore(dataDir);
  vault = new Vault(safeStorage);
  accounts = new AccountStore(dataDir, vault);
  creds = new CredentialStore(dataDir, vault);
  fileStore = new filesLib.FileStore(path.join(dataDir, 'files'));
  watchDownloads();
  library = new BookLibrary(dataDir, path.join(app.isPackaged ? process.resourcesPath : __dirname, 'books'));
  watchBooks();
  bookConsigne = new BookConsigne({ library, dir: dataDir, recognize: async (file) => { const r = await ocr.recognize(file, { lang: 'fr' }); return ocr.toLines(r.words); } });
  applyNativeTheme();
  setupUpdater();
  createWindow();
  if (selftestArg) { setTimeout(() => { try { fs.writeFileSync(selftestArg.slice(11), 'SELFTEST TIMEOUT\n'); } catch (e) { /* ignore */ } app.exit(2); }, 90000); selfTest(selftestArg.slice(11)); return; }
  win.webContents.once('did-finish-load', checkReminders);
  if (prefs().autoUpdate !== false && updatesPossible()) setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 20000); // a quiet check shortly after the start
  setInterval(checkReminders, 20000); // reminders ring while the app is open; missed ones ring at the next start
});
app.on('window-all-closed', () => app.quit());
