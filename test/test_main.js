'use strict';
// Loads main.js with a fake « electron » and calls every IPC handler, to check the wiring between the screens and the code.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Module = require('module');
const { makePptx } = require('./make_pptx');
const { writeZip } = require('../src/zip');
const ocrModule = require('../src/ocr');
const recognized = []; let ocrPlan = () => ({ width: 2000, height: 1100, words: [] });
ocrModule.recognize = async (file) => { recognized.push(path.basename(file)); const r = ocrPlan(file); if (r instanceof Error) throw r; return r; }; // no text recognition engine in the tests

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'main-'));
const userData = path.join(root, 'userData'); fs.mkdirSync(userData);
const handlers = {}; const sent = []; const saves = []; let nextOpen = null; let readyCb = null; const opened = []; const externals = []; const scripts = []; let willDownload = null; let pictureOf = {}; let clipImage = null; const protoHandlers = {}; let lastHtml = ''; const allWins = []; let clip = '';

class FakeWC {
  constructor() { this.l = {}; }
  on(e, f) { this.l[e] = f; } once(e, f) { this.l[e] = f; } send(...a) { sent.push(a); }
  setWindowOpenHandler() {} isLoading() { return false; }
  async printToPDF() { return Buffer.from('%PDF-1.4 fake pdf ' + 'x'.repeat(600)); }
  getURL() { return this.url || 'https://idprovider.men.gov.ma/login'; }
  async executeJavaScript(js) { scripts.push(js); return {}; }
  canGoBack() { return false; } goBack() {} reload() {} getZoomLevel() { return 0; } setZoomLevel() {}
}
class FakeWin {
  constructor() { this.webContents = new FakeWC(); this.destroyed = false; allWins.push(this); }
  setMenu(m) { this.menu = m; }
  loadFile(f) { try { lastHtml = fs.readFileSync(f, 'utf8'); } catch (e) { /* not a file */ } return Promise.resolve(); } loadURL() { return Promise.resolve(); } on(e, f) { (this.l = this.l || {})[e] = f; } focus() {} show() {} restore() {} isMinimized() { return false; }
  isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
}
const electron = {
  nativeTheme: { themeSource: 'system' },
  app: { isPackaged: true, getVersion: () => '7.4.0', getPath: (n) => (n === 'userData' ? userData : n === 'temp' ? os.tmpdir() : root), whenReady: () => ({ then: (f) => { readyCb = f; } }), on() {}, quit() {}, exit() {} },
  BrowserWindow: FakeWin,
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
  dialog: {
    showSaveDialog: async (w, o) => { const p = path.join(root, path.basename(o.defaultPath)); saves.push(p); return { canceled: false, filePath: p }; },
    showOpenDialog: async () => ({ canceled: false, filePaths: [nextOpen] })
  },
  shell: { openPath: async (p) => { opened.push(p); return ''; }, openExternal: async (u) => { externals.push(u); }, showItemInFolder() {} },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }), createFromPath: (p) => pictureOf[p] || { isEmpty: () => true } },
  protocol: { registerSchemesAsPrivileged() {}, handle: (scheme, fn) => { protoHandlers[scheme] = fn; } },
  session: { fromPartition: () => ({ on: (ev, fn) => { if (ev === 'will-download') willDownload = fn; } }) },
  Menu: { setApplicationMenu() {}, buildFromTemplate: (t) => t },
  clipboard: { writeText: (t) => { clip = t; }, readText: () => clip, clear: () => { clip = ''; }, readImage: () => clipImage || { isEmpty: () => true } },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(t, 'utf8').map((b) => b ^ 0x5a), decryptString: (b) => Buffer.from(b).map((x) => x ^ 0x5a).toString('utf8') },
  Notification: class { static isSupported() { return false; } on() {} show() {} }
};
const EventEmitter = require('events');
const fakeUpdater = Object.assign(new EventEmitter(), { checks: 0, installed: 0, checkForUpdates() { this.checks++; return Promise.resolve(); }, quitAndInstall() { this.installed++; } });
const realLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? electron : req === 'electron-updater' ? { autoUpdater: fakeUpdater } : realLoad.call(this, req, ...rest); };
process.resourcesPath = path.join(root, 'resources'); // where the packaged application finds the shipped books
const realSetInterval = global.setInterval; global.setInterval = () => 0; // no timer left running
require('../main.js');
global.setInterval = realSetInterval;
readyCb();
const call = (ch, ...a) => { assert.ok(handlers[ch], 'handler missing: ' + ch); return handlers[ch]({}, ...a); };

(async () => {
  // every channel of the preload is handled
  const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  for (const m of pre.matchAll(/call\('([a-z]+:[A-Za-z]+)'\)/g)) assert.ok(handlers[m[1]], 'preload channel without handler: ' + m[1]);

  // classes: names typed, header, marks, PDF, grades, seating, delete
  const made = await call('classes:createFromNames', '3APIC-2', 'AMRANI Yassine\nBENALI Salma\nCHAKIR Omar');
  assert.ok(made.ok);
  let list = await call('classes:list'); assert.deepStrictEqual([list[0].name, list[0].count], ['3APIC-2', 3]);
  await call('classes:save', { id: made.id, subject: 'French language', school: 'Collège Pionnier', direction: 'Nador', students: [{ index: 0, disc: '++-', hw: '+', rem: 'Participe' }] });
  const cl = await call('classes:get', made.id);
  assert.deepStrictEqual([cl.students[0].disc, cl.subject, cl.students.length], ['++-', 'French language', 3]);
  const nc = await call('classes:createFromNames', '3APIC-3', 'Un\nDeux');
  assert.strictEqual((await call('classes:get', nc.id)).school, 'Collège Pionnier', 'last typed school is proposed for the next class');
  const pdf = await call('classes:pdf', made.id); assert.ok(pdf.ok && fs.readFileSync(pdf.path).subarray(0, 4).toString() === '%PDF');
  const xl = await call('classes:grades', made.id, 3); assert.ok(xl.ok && fs.readFileSync(xl.path).subarray(0, 2).toString() === 'PK');
  let seat = await call('seating:autofill', made.id); assert.strictEqual(seat.placed, 3);
  seat = await call('seating:assign', made.id, 7, 0); assert.strictEqual(seat.seats[7].label, 'AMRANI Yassine');
  assert.ok(seat.board.startsWith('3APIC-2'));
  assert.ok((await call('seating:pdf', made.id)).ok);
  // a class list from a file
  const csv = path.join(root, 'liste.csv'); fs.writeFileSync(csv, 'Code;Nom;Prénom\nG1;ALAMI;Rim\nG2;BOUZID;Adam\n'); nextOpen = csv;
  const pick = await call('classes:pick'); assert.ok(pick.ok && pick.count === 2);
  assert.ok((await call('classes:createFromPick', 'Liste fichier')).ok);

  // notes, timetable, cahier, calendar
  const n = await call('notes:put', { title: 'Réunion', remindAt: Date.now() - 1000 });
  assert.ok(n.id); assert.strictEqual((await call('notes:list')).length, 1);
  assert.ok(sent.some((m) => m[0] === 'notes:changed'), 'screen told to refresh');
  const t = await call('timetable:get'); t.table.cells[0][0] = '3APIC-2'; await call('timetable:save', t.table);
  assert.ok((await call('timetable:pdf')).ok);
  const day = await call('cahier:day', '2026-10-26'); assert.strictEqual(day.slots.length, 1);
  assert.ok(await call('cahier:detail', '2026-10-26', 0));
  await call('cahier:skip', '2026-10-26', 0, true); await call('cahier:setDay', '2026-11-02', 'off'); await call('cahier:setManual', '3AC', 1, 'cd1', 'Objectif à moi');
  assert.strictEqual((await call('cahier:day', '2026-11-02')).status, 'off');
  const cal = await call('calendar:view'); assert.strictEqual(cal.items.length, 15);
  const ics = await call('calendar:add', 'b1'); assert.ok(ics.ok && ics.opened && fs.readFileSync(opened[0], 'utf8').includes('BEGIN:VEVENT'));

  // backup: create on this « PC », restore on a fresh one
  const bk = await call('backup:create', 'secret1'); assert.ok(bk.ok);
  assert.strictEqual((await call('backup:create', 'abc')).ok, false);
  nextOpen = bk.path; assert.ok((await call('backup:pick')).ok);
  const wrong = await call('backup:restore', 'mauvais'); assert.deepStrictEqual([wrong.ok, wrong.error], [false, 'Mot de passe incorrect, ou fichier abîmé.']);
  const again = await call('backup:restore', 'secret1'); assert.ok(again.ok && again.summary.classes === 0, 'nothing is added twice');
  await call('classes:remove', nc.id);
  nextOpen = bk.path; await call('backup:pick');
  assert.strictEqual((await call('backup:restore', 'secret1')).summary.classes, 1, 'a deleted class comes back from the backup');

  // authenticator: add, codes, kept encrypted on the disk, in the backup, deleted
  const added = await call('auth:add', 'Massar', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.ok(added.ok && added.message === 'Massar ajouté', JSON.stringify(added));
  assert.strictEqual((await call('auth:add', '', 'pas une clé !')).ok, false);
  const codes = await call('auth:codes');
  assert.ok(codes.encrypted && codes.items.length === 1 && /^\d{6}$/.test(codes.items[0].code) && !JSON.stringify(codes).includes('GEZDGN'), 'the secret never reaches the screen');
  assert.ok(!fs.readFileSync(path.join(userData, 'accounts.sec')).includes('GEZDGN'), 'the key is not readable on the disk');
  const bk2 = await call('backup:create', 'secret2'); nextOpen = bk2.path; await call('backup:pick');
  const check = require('../src/backup').decrypt(fs.readFileSync(bk2.path), 'secret2'); fs.writeFileSync(path.join(root, 'bk2.zip'), check);
  const zr = new (require('../src/zip').ZipReader)(path.join(root, 'bk2.zip'));
  assert.strictEqual(JSON.parse(zr.readText('data.json')).accounts[0].secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'the backup holds the key (it is itself encrypted)'); zr.close();
  await call('auth:remove', codes.items[0].id); assert.strictEqual((await call('auth:codes')).items.length, 0);

  // saved logins: the password never goes back to the screen; kept encrypted; used only on the pages of the site
  await call('logins:save', { key: 'massar', user: 'ali@mail.ma', pass: 'p@ss"1', auto: true });
  const lg = await call('logins:list');
  const mz = lg.find((x) => x.key === 'massar');
  assert.deepStrictEqual([mz.user, mz.hasPass, mz.auto, lg.length], ['ali@mail.ma', true, true, 5]);
  assert.ok(!JSON.stringify(lg).includes('p@ss'), 'the password is not sent to the screen');
  assert.ok(!fs.readFileSync(path.join(userData, 'creds.sec')).includes('p@ss') && !fs.readFileSync(path.join(userData, 'creds.sec')).includes('ali@mail'), 'not readable on the disk');
  await call('logins:save', { key: 'massar', user: 'ali2@mail.ma', pass: '', keepPass: true, auto: false });
  assert.strictEqual((await call('logins:list')).find((x) => x.key === 'massar').user, 'ali2@mail.ma');
  await call('logins:save', { key: 'massar', user: 'ali@mail.ma', pass: '', keepPass: true, auto: true });
  assert.strictEqual(await call('sites:open', 'massar'), true);
  const sw = allWins[allWins.length - 1];
  const fire = () => { scripts.length = 0; sw.webContents.l['did-finish-load'](); return scripts.slice(); };
  let ran = fire();
  assert.ok(ran.length === 1 && ran[0].includes('"ali@mail.ma"') && ran[0].includes('"p@ss\\"1"') && ran[0].trim().endsWith(', true);'), 'the login is typed and « Connexion » pressed: ' + ran[0].slice(-60));
  sw.webContents.l['console-message']({}, 1, '__madrassa_autoclicked__');
  ran = fire(); assert.ok(ran[0].trim().endsWith(', false);'), 'not pressed twice within a minute');
  sw.webContents.url = 'https://massar.men.gov.ma.evil.com/login';
  assert.strictEqual(fire().length, 0, 'nothing is typed on a page that does not belong to the site');
  sw.webContents.url = 'https://massar.men.gov.ma/';
  assert.strictEqual(fire().length, 1);
  // the menu: codes of the Authenticator typed in the focused field
  await call('auth:add', 'Massar', 'GEZDGNBVGY3TQOJQ');
  sw.l.focus(); // the menu is rebuilt with the current accounts
  const menu = sw.menu; // (rebuilt by the focus event above)
  const codeMenu = menu[0].submenu.find((i) => i.label && i.label.startsWith('Codes Authenticator'));
  assert.ok(codeMenu.submenu.length === 1 && codeMenu.submenu[0].label === 'Massar');
  scripts.length = 0; codeMenu.submenu[0].click();
  assert.ok(/^\d{6}$/.test(clip) && scripts.length === 1 && scripts[0].includes(clip), 'the code is copied and typed');
  const autoItem = menu[0].submenu.find((i) => i.type === 'checkbox'); autoItem.click({ checked: false });
  assert.strictEqual((await call('logins:list')).find((x) => x.key === 'massar').auto, false, 'the menu switch is kept');
  assert.strictEqual(menu[0].submenu.length, 5, 'no codes menu is missing for a site that uses them');
  await call('auth:remove', (await call('auth:codes')).items[0].id);
  // the logins travel in the backup, in the layout of the phone
  const bk3 = await call('backup:create', 'secret3'); const z3 = require('../src/backup').decrypt(fs.readFileSync(bk3.path), 'secret3'); fs.writeFileSync(path.join(root, 'bk3.zip'), z3);
  const zr3 = new (require('../src/zip').ZipReader)(path.join(root, 'bk3.zip')); const d3 = JSON.parse(zr3.readText('data.json')); zr3.close();
  assert.deepStrictEqual(d3.creds, { u_Massar: 'ali@mail.ma', 'p_Massar': 'p@ss"1' });
  await call('logins:delete', 'massar'); assert.strictEqual((await call('logins:list')).find((x) => x.key === 'massar').user, '');

  // downloads from a site: kept in the app folder, named after the real content
  assert.ok(willDownload, 'the download handler is installed');
  const download = (url, cd, mime, data) => new Promise((resolve) => {
    let savePath = null; let done = null;
    willDownload({}, { getURL: () => url, getContentDisposition: () => cd, getFilename: () => 'x', getMimeType: () => mime, setSavePath: (p) => { savePath = p; }, once: (e, f) => { done = f; } });
    assert.ok(savePath && savePath.endsWith('.part') && savePath.startsWith(path.join(userData, 'files')), 'saved in the app folder, as a .part first');
    fs.writeFileSync(savePath, data); sent.length = 0; done({}, 'completed'); resolve();
  });
  await download('https://massar.men.gov.ma/export.php?id=3', 'attachment; filename="releve notes.php"', 'application/pdf', Buffer.from('%PDF-1.4 x'));
  let fl = await call('files:list');
  assert.ok(fl.items.some((x) => x.name === 'releve notes.pdf' && x.icon === '📕'), JSON.stringify(fl.items.map((x) => x.name)));
  assert.ok(sent.some((m) => m[0] === 'files:changed'), 'the screen is told');
  await download('https://massar.men.gov.ma/liste.xls', '', 'application/vnd.ms-excel', Buffer.from('<html><table><tr><td>Nom</td><td>Code</td></tr><tr><td>Ali</td><td>007</td></tr></table></html>'));
  fl = await call('files:list'); assert.ok(fl.items.some((x) => x.name === 'liste.xlsx'), 'an « Excel » web page becomes a real .xlsx');
  await download('https://massar.men.gov.ma/doc.pdf', '', 'application/pdf', Buffer.from('<html><body>Session expirée</body></html>'));
  fl = await call('files:list'); assert.ok(!fl.items.some((x) => x.name.startsWith('doc')), 'a web page is not kept as a PDF');
  assert.ok(!fs.readdirSync(path.join(userData, 'files')).some((n) => n.endsWith('.part')), 'no half-finished file is left');
  assert.ok((await call('files:open', 'releve notes.pdf')).ok);
  assert.strictEqual((await call('files:open', '../x')).ok, false);
  assert.strictEqual(await call('files:delete', ['releve notes.pdf', '../../etc/passwd']), 1);
  assert.strictEqual(await call('files:folder'), true);

  // books: pages imported from the PC, read through book://, reading state kept
  assert.ok(protoHandlers.book, 'the book:// protocol is installed');
  assert.strictEqual((await call('books:list')).length, 2);
  const pagesDir = path.join(root, 'pages'); fs.mkdirSync(pagesDir);
  for (let i = 1; i <= 3; i++) fs.writeFileSync(path.join(pagesDir, `page${i}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47, i]));
  nextOpen = pagesDir;
  const imp = await call('books:importFolder', '3ac'); assert.deepStrictEqual([imp.ok, imp.count], [true, 3]);
  assert.strictEqual((await call('books:list')).find((b) => b.id === '3ac').pages, 3);
  const bkOpen = await call('books:open', '3ac'); assert.deepStrictEqual([bkOpen.pages, bkOpen.last, bkOpen.marks], [3, 0, []]);
  const res = await protoHandlers.book({ url: 'book://3ac/2' });
  assert.strictEqual(res.status, 200); assert.strictEqual(res.headers.get('content-type'), 'image/png');
  assert.deepStrictEqual([...new Uint8Array(await res.arrayBuffer())], [0x89, 0x50, 0x4e, 0x47, 3]);
  assert.strictEqual((await protoHandlers.book({ url: 'book://3ac/7' })).status, 404);
  assert.strictEqual((await protoHandlers.book({ url: 'book://1ac/0' })).status, 404, 'a book without pages');
  assert.strictEqual((await protoHandlers.book({ url: 'book://3ac/../../../etc/passwd' })).status, 404);
  await call('books:setLast', '3ac', 2); assert.strictEqual(await call('books:toggleMark', '3ac', 1), true); await call('books:setTone', 1);
  const reopened = await call('books:open', '3ac'); assert.deepStrictEqual([reopened.last, reopened.marks, reopened.tone], [2, [1], 1]);
  nextOpen = path.join(pagesDir, 'page1.png'); const files3 = await call('books:importPages', '3ac'); assert.strictEqual(files3.count, 1);
  const newBook = await call('books:add', 'Mon livre', '2ème AC'); assert.ok(newBook.ok); assert.strictEqual((await call('books:list')).length, 3);
  assert.strictEqual((await call('books:add', '', '')).ok, false);
  assert.ok(await call('books:remove', newBook.id));

  // settings: theme, updates, data folder, the hidden « À propos »
  const set0 = await call('settings:get');
  assert.deepStrictEqual([set0.theme, set0.version, set0.autoUpdate, set0.updatesPossible, set0.lang], ['auto', '7.4.0', true, true, 'fr']);
  assert.strictEqual(await call('settings:setTheme', 'dark'), 'dark'); assert.strictEqual(electron.nativeTheme.themeSource, 'dark');
  assert.strictEqual((await call('settings:get')).theme, 'dark');
  assert.strictEqual(await call('settings:setTheme', 'nonsense'), 'auto'); assert.strictEqual(electron.nativeTheme.themeSource, 'system');
  assert.strictEqual(await call('settings:setAutoUpdate', false), false); assert.strictEqual((await call('settings:get')).autoUpdate, false); await call('settings:setAutoUpdate', true);
  assert.strictEqual(await call('settings:openExternal', 'mailto:boudouasel12@gmail.com'), true); assert.deepStrictEqual(externals, ['mailto:boudouasel12@gmail.com']);
  assert.strictEqual(await call('settings:openExternal', 'https://evil.example/'), false); assert.strictEqual(await call('settings:openExternal', 'mailto:a@b.c?body=x'), false);
  assert.strictEqual(await call('settings:copy', '0671677162'), true); assert.strictEqual(clip, '0671677162'); assert.strictEqual(await call('settings:copy', 'rm -rf'), false);
  assert.strictEqual(await call('settings:openDataFolder'), true);
  // updates: found, downloaded, installed when the person asks; unavailable in the portable version
  sent.length = 0;
  assert.deepStrictEqual(await call('update:check'), { ok: true }); assert.strictEqual(fakeUpdater.checks, 1);
  fakeUpdater.emit('checking-for-update'); fakeUpdater.emit('update-available', { version: '7.5.0' }); fakeUpdater.emit('download-progress', { percent: 41.6 }); fakeUpdater.emit('update-downloaded', { version: '7.5.0' });
  assert.deepStrictEqual(sent.filter((m) => m[0] === 'update:status').map((m) => m[1]), [{ state: 'checking' }, { state: 'available', version: '7.5.0' }, { state: 'progress', percent: 42 }, { state: 'ready', version: '7.5.0' }]);
  assert.strictEqual(fakeUpdater.autoInstallOnAppQuit, true);
  assert.strictEqual(await call('update:install'), true); assert.strictEqual(fakeUpdater.installed, 1);
  fakeUpdater.emit('error', new Error('offline')); assert.deepStrictEqual(sent[sent.length - 1][1], { state: 'error' });
  process.env.PORTABLE_EXECUTABLE_DIR = 'C:/portable';
  const unavailable = await call('update:check'); assert.strictEqual(unavailable.ok, false); assert.ok(unavailable.message.includes('version portable'));
  assert.strictEqual((await call('settings:get')).updatesPossible, false); delete process.env.PORTABLE_EXECUTABLE_DIR;

  // pictures: a QR code read from a file or from the clipboard, a timetable read from a photo
  const qrFixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'qr.json'), 'utf8')); const fx = qrFixtures.find((f) => f.version === 5 && f.ecc === 'Q');
  const bytes = Buffer.from(fx.bits, 'base64'); const scale = 6; const side = (fx.size + 8) * scale; const bgra = Buffer.alloc(side * side * 4, 255);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) { const mx = Math.floor(x / scale) - 4; const my = Math.floor(y / scale) - 4; if (mx >= 0 && my >= 0 && mx < fx.size && my < fx.size) { const i = my * fx.size + mx; if ((bytes[i >> 3] >> (7 - (i & 7))) & 1) { const p = (y * side + x) * 4; bgra[p] = bgra[p + 1] = bgra[p + 2] = 20; } } }
  const image = (buf, w, h) => ({ isEmpty: () => false, getSize: () => ({ width: w, height: h }), toBitmap: () => buf, resize() { return this; }, toPNG: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  const qrFile = path.join(root, 'qr.png'); pictureOf[qrFile] = image(bgra, side, side);
  nextOpen = qrFile;
  const qrRes = await call('auth:fromImage', 'file'); assert.ok(qrRes.ok && /ajouté$/.test(qrRes.message), JSON.stringify(qrRes));
  assert.strictEqual((await call('auth:codes')).items.length, 1, 'the account of the QR code is in the Authenticator');
  clipImage = image(bgra, side, side); assert.strictEqual((await call('auth:fromImage', 'clipboard')).message, 'Ce compte est déjà ajouté.');
  clipImage = null; const noClip = await call('auth:fromImage', 'clipboard'); assert.ok(!noClip.ok && noClip.message.startsWith('Le presse-papiers ne contient pas d’image'));
  const blankFile = path.join(root, 'blank.png'); pictureOf[blankFile] = image(Buffer.alloc(200 * 200 * 4, 255), 200, 200); nextOpen = blankFile;
  assert.ok((await call('auth:fromImage', 'file')).message.startsWith('Aucun QR code lisible'));
  await call('auth:remove', (await call('auth:codes')).items[0].id);

  const Lw = (text, cxm, cym, line) => ({ text, left: cxm - 55, right: cxm + 55, top: cym - 14, bottom: cym + 14, line });
  const hoursTT = ['08h - 09h', '09h - 10h', '10h - 11h', '11h - 12h', '14h - 15h', '15h - 16h', '16h - 17h', '17h - 18h'];
  const words = hoursTT.map((h, i) => Lw(h, 340 + i * 215, 100, 'h' + i));
  words.push(Lw('3APIC-2', 340, 242, 'a'), Lw('Salle 10', 340, 280, 'b'), Lw('1APIC3', 340 + 3 * 215, 392, 'c'), Lw('Salle 4', 340 + 3 * 215, 430, 'd'));
  const photoFile = path.join(root, 'photo.png'); pictureOf[photoFile] = image(Buffer.alloc(0), 2000, 1100); nextOpen = photoFile;
  ocrPlan = () => ({ width: 2000, height: 1100, words });
  const ph = await call('timetable:fromPhoto', 'file', {});
  assert.ok(ph.ok && ph.table.cells[0][0] === '3APIC-2\nSalle 10' && ph.table.cells[1][3] === '1APIC3\nSalle 4', JSON.stringify(ph));
  assert.strictEqual(ph.hasCurrent, true, 'the person is asked before the timetable is replaced');
  assert.ok(recognized.length >= 1 && recognized[0].startsWith('sl-photo-'), 'the picture is read by the text recognition');
  // no hour read: the side of the days is asked, then the same reading is reused (no second reading)
  const before = recognized.length;
  ocrPlan = () => ({ width: 2000, height: 1100, words: [Lw('3APIC-2', 300, 330, 'a'), Lw('Salle 10', 300, 366, 'b')] });
  const asks = await call('timetable:fromPhoto', 'file', {}); assert.deepStrictEqual([asks.ok, asks.needDirection], [false, true]);
  const second = await call('timetable:fromPhoto', 'file', { again: true, rtl: false }); assert.ok(second.ok && second.table.cells.flat().some((c) => c.startsWith('3APIC-2')));
  assert.strictEqual(recognized.length, before + 1, 'read only once');
  ocrPlan = () => new (require('../src/ocr').OcrError)('x', 'OCR_NO_LANGUAGE');
  const noLang = await call('timetable:fromPhoto', 'file', {}); assert.ok(!noLang.ok && noLang.error.includes('aucune langue installée'));
  ocrPlan = () => ({ width: 2000, height: 1100, words: [Lw('ab', 300, 300, 'a')] });
  const nothing = await call('timetable:fromPhoto', 'file', { rtl: false }); assert.ok(!nothing.ok && nothing.error.startsWith('Aucun emploi du temps trouvé'));
  clipImage = image(Buffer.alloc(0), 2000, 1100); ocrPlan = () => ({ width: 2000, height: 1100, words }); assert.ok((await call('timetable:fromPhoto', 'clipboard', {})).ok, 'from a screenshot in the clipboard'); clipImage = null;

  // fiche technique with the consignes of the book: the pages are read once, the consigne is used and said
  const bookPages = path.join(root, 'book3ac'); fs.mkdirSync(bookPages);
  for (let i = 1; i <= 12; i++) fs.writeFileSync(path.join(bookPages, `p${String(i).padStart(2, '0')}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47, i]));
  nextOpen = bookPages; await call('books:importFolder', '3ac');
  const bookPage = [{ text: 'Activité 1', left: 60, top: 100, right: 220, bottom: 124 }, { text: 'Souligne les verbes conjugués dans le texte.', left: 240, top: 100, right: 900, bottom: 124 }];
  const pptxBook = path.join(root, '3AC_UD1_S1.pptx');
  fs.writeFileSync(pptxBook, makePptx([
    { shapes: [['Voyages'], ['Séance 1'], ['3AC']] },
    { shapes: [['Structure de la séance'], ['Ouverture de la séance', '05:00 min'], ['Vocabulaire', '20:00 min'], ['Clôture de la séance', '05:00 min']] },
    { shapes: [['Vocabulaire', '20:00 min']] },
    { shapes: [['Voici l’objectif de la séance'], ['Employer des mots pour décrire.']] },
    { shapes: [['Pratiques guidées'], ['Collective'], ['Activité 1, page 7']] }
  ]));
  nextOpen = pptxBook; const choose2 = await call('fiche:choose'); assert.ok(choose2.ok && choose2.bookReady === true, 'the book of this level is installed');
  const readsBefore = recognized.length;
  ocrPlan = (file) => ({ width: 1000, height: 1400, words: /p007/.test(file) ? [{ text: 'Activité', left: 60, top: 100, right: 150, bottom: 124, line: 1 }, { text: '1', left: 156, top: 100, right: 170, bottom: 124, line: 1 }, { text: 'Souligne', left: 240, top: 100, right: 340, bottom: 124, line: 2 }, { text: 'les', left: 346, top: 100, right: 380, bottom: 124, line: 2 }, { text: 'verbes', left: 386, top: 100, right: 460, bottom: 124, line: 2 }, { text: 'conjugués', left: 466, top: 100, right: 570, bottom: 124, line: 2 }] : [] });
  const withBook = await call('fiche:create', Object.assign({}, choose2.fields, { objectifs: choose2.fields.objectifs.join('\n'), useBooks: true }));
  assert.ok(withBook.ok, JSON.stringify(withBook));
  assert.ok(withBook.notes.some((n) => n.startsWith('Consigne lue dans le livre (Activité 1, page 7)') && n.includes('Souligner les verbes conjugués')), JSON.stringify(withBook.notes));
  assert.strictEqual(recognized.length, readsBefore + 1, 'only the page the fiche needs is read');
  const without = await call('fiche:create', Object.assign({}, choose2.fields, { objectifs: choose2.fields.objectifs.join('\n'), useBooks: false }));
  assert.ok(!without.notes.some((n) => n.startsWith('Consigne lue dans le livre')) && recognized.length === readsBefore + 1, 'switched off: the book is not read');
  ocrPlan = () => new (require('../src/ocr').OcrError)('x', 'OCR_NO_LANGUAGE'); await call('books:remove', '3ac'); nextOpen = bookPages; await call('books:importFolder', '3ac');
  fs.rmSync(path.join(userData, 'book_ocr_v1'), { recursive: true, force: true });
  const failing = await call('fiche:create', Object.assign({}, choose2.fields, { objectifs: choose2.fields.objectifs.join('\n'), useBooks: true }));
  assert.ok(failing.ok && failing.notes.some((n) => n.startsWith('Consignes du livre : la reconnaissance de texte de Windows')), 'the fiche is still made when the text recognition fails');
  await call('books:remove', '3ac');
  const noBook = await call('fiche:create', Object.assign({}, choose2.fields, { objectifs: choose2.fields.objectifs.join('\n'), useBooks: true }));
  assert.ok(noBook.notes.some((n) => n.startsWith('Consignes du livre : le livre 3AC n’est pas installé')));

  // sites
  assert.strictEqual(await call('sites:open', 'massar'), true);
  assert.strictEqual(await call('sites:open', 'nope'), false);

  // fiche technique: choose a PowerPoint, create the Word file
  const pptx = path.join(root, '1AC_UD1_S1.pptx');
  fs.writeFileSync(pptx, makePptx([
    { shapes: [['Ambiances du quotidien'], ['Séance 1'], ['1AC']] },
    { shapes: [['Structure de la séance'], ['Ouverture de la séance', '05:00 min'], ['Vocabulaire', '20:00 min'], ['Clôture de la séance', '05:00 min']] },
    { shapes: [['Vocabulaire', '20:00 min']] },
    { shapes: [['Voici l’objectif de la séance'], ['Employer un vocabulaire varié pour décrire une ambiance.']] }
  ]));
  nextOpen = pptx;
  const chosen = await call('fiche:choose');
  assert.ok(chosen.ok, JSON.stringify(chosen)); assert.deepStrictEqual([chosen.fields.niveau, chosen.fields.unite, chosen.fields.periode], ['1AC', '1', '1']);
  const fiche = await call('fiche:create', Object.assign({}, chosen.fields, { objectifs: chosen.fields.objectifs.join('\n') }));
  assert.ok(fiche.ok && fs.readFileSync(fiche.path).subarray(0, 2).toString() === 'PK', JSON.stringify(fiche));
  assert.ok(await call('fiche:open')); assert.ok(opened.length >= 2);

  // Arabic: the tracking sheet is mirrored and asks once for the Arabic spelling of the directorate and the school
  assert.strictEqual(await call('lang:get'), 'fr');
  assert.strictEqual(await call('lang:set', 'ar'), 'ar'); assert.strictEqual(await call('lang:get'), 'ar');
  const c3 = await call('classes:createFromNames', 'AR-1', 'AMRANI Yassine\nBENALI Salma');
  await call('classes:save', { id: c3.id, direction: 'Zzz ville', school: 'Nador', subject: 'Mathematics' });
  let arPdf = await call('classes:pdf', c3.id);
  assert.deepStrictEqual([arPdf.ok, arPdf.needArabic], [false, ['Zzz ville']], 'only what is not known is asked: Nador is built in');
  assert.ok(await call('classes:arabicNames', { 'Zzz ville': 'مدينة زززز' }));
  arPdf = await call('classes:pdf', c3.id); assert.ok(arPdf.ok, JSON.stringify(arPdf));
  assert.ok(lastHtml.includes('lang="ar" dir="rtl"') && lastHtml.includes('بطاقة المتابعة') && lastHtml.includes('مدينة زززز') && lastHtml.includes('الناظور') && lastHtml.includes('الرياضيات'));
  await call('classes:save', { id: c3.id, direction: 'Autre ville' });
  assert.ok((await call('classes:pdf', c3.id, { skipNames: true })).ok, 'skipping prints the name as typed');
  assert.ok(lastHtml.includes('Autre ville'));
  await call('timetable:pdf'); assert.ok(lastHtml.includes('dir="rtl"') && lastHtml.includes('الإثنين'));
  await call('seating:pdf', c3.id); assert.ok(lastHtml.includes('الصف 1') || lastHtml.includes('الصف'));
  await call('lang:set', 'fr'); await call('classes:pdf', c3.id); assert.ok(lastHtml.includes('lang="fr"') && lastHtml.includes('Fiche de suivi'), 'back to French');

  console.log('MAIN TESTS PASSED (' + Object.keys(handlers).length + ' channels)');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
