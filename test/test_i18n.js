'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const lib = require('../renderer/i18n-lib');
const data = require('../src/data/ar.json');
const { ArabicNames } = require('../src/arabicnames');
const suivi = require('../src/suivi');
const { tr } = lib.make(data);

// ---- exact texts, spaces, apostrophes
assert.strictEqual(tr('Fichiers'), 'الملفات');
assert.strictEqual(tr('  Fichiers \n'), '  الملفات \n', 'spaces around the text are kept');
assert.strictEqual(tr('Aujourd’hui'), tr("Aujourd'hui"), 'curly and straight apostrophes are the same');
assert.strictEqual(tr('Aujourd’hui'), 'اليوم');
assert.strictEqual(tr('Texte inconnu de la table'), 'Texte inconnu de la table', 'unknown text is left as it is');
assert.strictEqual(tr('AMRANI Yassine'), 'AMRANI Yassine', 'names are never touched');
assert.strictEqual(tr(''), ''); assert.strictEqual(tr(null), null);
assert.strictEqual(tr('Haraka'), 'حركة');

// ---- numbers, lists, dates
assert.strictEqual(tr('1 élèves'), 'تلميذ واحد');
assert.strictEqual(tr('2 élèves'), 'تلميذان');
assert.strictEqual(tr('7 élèves'), '7 تلاميذ');
assert.strictEqual(tr('32 élèves'), '32 تلميذاً');
assert.strictEqual(tr('30/40 placés · 2 sans place'), '30/40 جالسون · 2 بدون مقعد');
assert.strictEqual(tr('Rangée 3 · Table 2 · gauche'), 'الصف 3 · الطاولة 2 · يسار');
assert.strictEqual(tr('mercredi 4 novembre 2026'), 'الأربعاء 4 نونبر 2026');
assert.strictEqual(tr('dimanche 1er novembre 2026'), 'الأحد 1 نونبر 2026');
assert.strictEqual(tr('Du dimanche 18 octobre 2026\nau dimanche 25 octobre 2026'), 'من الأحد 18 أكتوبر 2026\nإلى الأحد 25 أكتوبر 2026');
assert.strictEqual(tr('Les cours commencent le lundi 26 octobre 2026.'), 'تبدأ الدراسة يوم الإثنين 26 أكتوبر 2026.');
assert.strictEqual(tr('Dans 3 jours'), 'بعد 3 أيام');
assert.strictEqual(tr('Unité 1 · Séance 1 — Vocabulaire / Compréhension de l’oral'), 'الوحدة 1 · الحصة 1 — المعجم / فهم المسموع');
assert.strictEqual(tr('Séance 4 :'), 'الحصة 4 :');
assert.strictEqual(tr('Période : 2'), 'الفترة : 2');
assert.strictEqual(tr('Lundi, 08h - 09h'), 'الإثنين، 08h - 09h');
assert.strictEqual(tr('Supprimer la liste « 3APIC-2 » ?'), 'هل تريد حذف اللائحة «3APIC-2»؟');
assert.strictEqual(tr('Fiche enregistrée : C:\\Docs\\a.pdf'), 'تم حفظ البطاقة : \u200EC:\\Docs\\a.pdf');
assert.deepStrictEqual(['2 classe(s)', '3 note(s)', '1 fichier(s)'].map(tr), ['2 قسم(أقسام)', '3 ملاحظة(ات)', '1 ملف(ات)'], 'the parts of the restore message (the screen joins them)');
assert.strictEqual(tr('Massar : Enregistré. Il sera rempli automatiquement.'), 'مسار : تم الحفظ. ستُملأ البيانات تلقائياً.');
assert.strictEqual(tr('Aucun identifiant n’est enregistré pour Massar, ou cette page n’appartient pas au site.'), 'لا يوجد معرّف محفوظ لموقع مسار، أو أن هذه الصفحة لا تنتمي إلى الموقع.');
assert.strictEqual(tr('releve notes.pdf (cliquez pour ouvrir)'), 'releve notes.pdf (انقر للفتح)');

// ---- nothing is translated twice, and the table has no hole on the screens
for (const v of Object.values(data.dict)) assert.strictEqual(tr(v), v, 'Arabic text must be stable: ' + v);
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
const texts = new Set();
for (const m of html.matchAll(/>([^<>]+)</g)) texts.add(m[1].replace(/\s+/g, ' ').trim());
for (const m of html.matchAll(/(?:placeholder|title)="([^"]+)"/g)) texts.add(m[1]);
const KEEP = new Set(['Madrassa', 'Word', 'PowerPoint', 'PDF', 'Langue / اللغة', 'العربية', 'Français', 'KAISS BOUDOUASEL', 'boudouasel12@gmail.com', '0671677162']);
const holes = [...texts].filter((t) => t && /[A-Za-zÀ-ÿ]{2}/.test(t) && !KEEP.has(t) && !/^[\u0600-\u06FF\s.،:()؟!]+$/.test(t) && tr(t) === t);
assert.deepStrictEqual(holes, [], 'French texts of the screens without Arabic: ' + JSON.stringify(holes));
// the texts the screens write with code
const js = ['classes', 'notes', 'timetable', 'cahier', 'calendar', 'backup', 'auth', 'logins', 'files', 'seating', 'books', 'settings'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'renderer', f + '.js'), 'utf8')).join('\n');
const fixed = [...js.matchAll(/(?:textContent = |, |\(|msg\(|\? )'([^'\\]{6,}?)'/g)].map((m) => m[1]).filter((t) => /[ ]/.test(t) && /^[A-ZÀ-Ý+←✖…•]/.test(t) && !/[=<>{}\/#.\[]/.test(t.replace(/…|\.$/g, '')));
const jsHoles = [...new Set(fixed)].filter((t) => tr(t) === t);
assert.deepStrictEqual(jsHoles, [], 'French texts written by the screens, without Arabic: ' + JSON.stringify(jsHoles));

// ---- Arabic spelling of the directorate and school
const names = new ArabicNames({});
assert.strictEqual(names.lookup('Nador'), 'الناظور');
assert.strictEqual(names.lookup('  FÈS '), 'فاس');
assert.strictEqual(names.lookup('الدار البيضاء'), 'الدار البيضاء', 'already Arabic');
assert.strictEqual(names.lookup('Ville inconnue'), null);
assert.deepStrictEqual(names.missing(['Nador', 'Ville inconnue', '', 'Ville inconnue']), ['Ville inconnue']);
assert.strictEqual(names.forPdf('Ville inconnue'), 'Ville inconnue');
names.save('Ville inconnue', 'مدينة'); assert.strictEqual(names.forPdf('ville  inconnue'), 'مدينة'); assert.deepStrictEqual(names.missing(['Ville inconnue']), []);

// ---- the Arabic tracking sheet is the mirror image of the French one
const cl = { name: '3APIC-2', year: '2026/2027', subjectLabel: 'الرياضيات', school: 'إعدادية الريف', direction: 'الناظور', header: ['Nom'],
  rows: [['AMRANI Yassine'], ['العلوي ليلى']], track: [['++-', '+', 'Participe'], ['', '-', '']] };
const labels = {}; for (const [k, v] of Object.entries(suivi.FR)) labels[k] = tr(v);
const fr = suivi.buildHtml(cl, 'data:image/png;base64,AAAA');
const ar = suivi.buildHtml(cl, 'data:image/png;base64,AAAA', labels, { rtl: true });
const left = (h, cls) => { const m = new RegExp('class="' + cls + '[^"]*" style="left:(\\d+)px').exec(h); return m && +m[1]; };
assert.ok(fr.includes('lang="fr"') && !fr.includes('dir="rtl"'));
assert.ok(ar.includes('lang="ar" dir="rtl"') && ar.includes('بطاقة المتابعة') && ar.includes('المديرية الإقليمية') && ar.includes('الناظور') && ar.includes('الرياضيات'));
assert.strictEqual(/class="logo" src="[^"]*" style="left:(\d+)px/.exec(fr)[1], '110');
assert.strictEqual(/class="logo" src="[^"]*" style="left:(\d+)px/.exec(ar)[1], String(1080 - 110 - 195), 'the logo moves to the right');
const numCell = (h) => +/<div class="cell " style="left:(\d+)px[^>]*><div class="num">1<\/div>/.exec(h)[1];
assert.strictEqual(numCell(fr), 65); assert.strictEqual(numCell(ar), 1080 - 104, 'the number column is on the right');
assert.ok(ar.includes('class="marks rtl"') && !fr.includes('marks rtl'));
assert.ok(ar.includes('class="rem" dir="rtl"') && fr.includes('class="rem" dir="auto"'));
const widths = (h) => [...h.matchAll(/class="cell [^"]*" style="left:(\d+)px;top:\d+(?:\.\d+)?px;width:(\d+)px/g)].map((m) => [+m[1], +m[2]]);
for (const [l, w] of widths(ar)) assert.ok(l >= 43 && l + w <= 1037, 'inside the frame');
console.log('I18N TESTS PASSED');
