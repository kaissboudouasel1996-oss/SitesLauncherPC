'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { makePptx, lessonSlides } = require('./make_pptx');
const ppt = require('../src/ppt');
const builder = require('../src/builder');
const docx = require('../src/docx');
const { ZipReader } = require('../src/zip');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fiche-'));
function run(name, extra) {
  const f = path.join(dir, name + '.pptx');
  fs.writeFileSync(f, makePptx(lessonSlides(extra)));
  const deck = ppt.read(f, '3AC_UD1Voyages_S4.pptx');
  const fields = builder.detect(deck);
  const res = builder.build(deck, fields, (s) => (s.iconKey ? deck.iconModes[s.iconKey] : null));
  const out = docx.toBuffer(res.data);
  const outFile = path.join(dir, name + '.docx');
  fs.writeFileSync(outFile, out.buffer);
  return { deck, fields, res, outFile, fontPt: out.fontPt };
}

const a = run('normal', 0);
console.log('slides:', a.deck.slides.length);
console.log('fields:', JSON.stringify(a.fields, null, 1));
console.log('OUVERTURE:', a.res.data.ouverture);
console.log('CLOTURE:', a.res.data.cloture);
console.log('MODELAGE:', a.res.data.blocs[0].rows[0].paras.map((p) => p.text));
console.log('PRATIQUES:', a.res.data.blocs[0].rows[1].paras.map((p) => p.text));
console.log('notes:', a.res.notes);
assert.strictEqual(a.fields.uniteTitre, 'Voyages et expériences');
assert.ok(a.res.data.ouverture.some((l) => l.startsWith('-Contrôle des devoirs : Désigner quelques élèves pour lire le texte')), 'contrôle des devoirs');
assert.deepStrictEqual(a.res.data.cloture.slice(0, 2), ['-Demander aux élèves de rappeler ce qu’ils ont appris.', '-Faire la synthèse de la séance.']);
const all = JSON.stringify(a.res.data);
assert.ok(!/Like vocabulaire/.test(all) && !/Attirer l/.test(all), 'unwanted lines are gone');
assert.ok(/activité 1, p\. 10/.test(all));

// a very long fiche gets a smaller font so that it still fits one page
const b = run('long', 0);
for (let i = 0; i < 40; i++) b.res.data.cloture.push('-Une ligne en plus pour allonger la fiche technique et vérifier la taille de la police.');
const longOut = docx.toBuffer(b.res.data);
console.log('font normal:', a.fontPt, ' font long:', longOut.fontPt);
assert.ok(longOut.fontPt < a.fontPt, 'long fiche gets a smaller font');
const z = new ZipReader(a.outFile);
const xmlDoc = z.readText('word/document.xml');
assert.ok(xmlDoc.includes('Fiche technique'));
assert.ok(xmlDoc.includes('Étapes de la séance') && xmlDoc.includes('Période :') && xmlDoc.includes('Page : '), 'header of v75: period and pages');
z.close();
console.log('OUT_DIR=' + dir);
console.log('ALL TESTS PASSED');
