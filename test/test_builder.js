'use strict';
// The fiche builder of the Android app (v75), checked on one lesson of each kind.
// Every expectation was read in the Kotlin code (FicheBuilder.kt) and checked by hand against it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { makePptx } = require('./make_pptx');
const ppt = require('../src/ppt');
const B = require('../src/builder');
const docx = require('../src/docx');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bld-'));
const byText = (s) => { const t = s.paras; return t.includes('T') ? 'T' : t.includes('R') ? 'R' : t.includes('L') ? 'L' : t.includes('Collective') ? 'C' : t.includes('Autonome') ? 'A' : t.includes('En binôme') ? 'B' : null; };
function run(name, file, slides) {
  const f = path.join(dir, name + '.pptx');
  fs.writeFileSync(f, makePptx(slides));
  const deck = ppt.read(f, file);
  const fields = B.detect(deck);
  const res = B.build(deck, fields, byText);
  docx.toBuffer(res.data); // the Word file must be producible
  const lines = (label) => { const out = []; for (const b of res.data.blocs) for (const r of b.rows) if (!label || r.label.startsWith(label)) r.paras.forEach((p) => out.push(p.text)); return out; };
  return { fields, res, lines };
}
const head = (n, comp, obj, dur, lvl = '3AC') => [
  { shapes: [['Voyages et expériences'], ['Séance ' + n], [lvl]] },
  { shapes: [['Structure de la séance'], ['Ouverture de la séance', '05:00 min'], [comp, dur], ['Clôture de la séance', '05:00 min']] },
  { shapes: [['Repérage dans l’unité didactique'], ['SÉANCE ' + n], [comp + ' : ' + obj]] },
  { shapes: [['Ouverture de la séance', '05:00 min']] }
];
const tail = [{ shapes: [['Clôture de la séance', '05:00 min']] }, { shapes: [['Travail à la maison'], ['Activité 2, page 14']] }];

// ---- the words of the consignes
assert.strictEqual(B.actionize('Maintenant, observez l’image.'), 'Observer l’image.');
assert.strictEqual(B.actionize('Avant de commencer le cours, relevez les mots.'), 'Relever les mots.');
assert.strictEqual(B.actionize('Résume le texte en trois phrases.'), 'Résumer le texte en trois phrases.');
assert.strictEqual(B.actionize('Je complète le tableau.'), null);
assert.strictEqual(B.actionizeAny('Voici la lettre Observez le texte et répondez aux questions.'), 'Observer le texte et répondez aux questions.');
assert.strictEqual(B.polishConsigne('Lisez les phrases suivantes, entourez les verbes et répondez aux questions.', true), 'Lire des phrases, d’entourer les verbes et de répondre aux questions.');
assert.strictEqual(B.polishConsigne('Lisez ces phrases, entourez vos réponses.', false), 'Lire des phrases, entourer leurs réponses.');
assert.strictEqual(B.polishConsigne('Dites ce que vous voyez.', false), 'Dire ce que vous voyez.');
assert.strictEqual(B.fromFirstPerson('Je complète par les marqueurs, puis j’écris des phrases.'), 'Compléter par les marqueurs, puis écrire des phrases');
assert.strictEqual(B.fromFirstPerson('Je lis le texte, et je les corrige avec ma carte.'), 'Lire le texte, et les corriger avec leur carte');
assert.strictEqual(B.fromFirstPerson('Je me demande pourquoi.'), 'Se demander pourquoi');
assert.strictEqual(B.sentencesToInfinitive('Je cherche d’abord le nom. Ensuite, j’observe leur ordre.'), 'Chercher d’abord le nom. Ensuite, observer leur ordre.');
assert.deepStrictEqual(['lisez', 'déduisez', 'finissez', 'écrivez', 'prenez', 'répondez', 'faites', 'dites', 'nez', 'avez'].map(B.imperativeToInfinitive),
  ['lire', 'déduire', 'finir', 'écrire', 'prendre', 'répondre', 'faire', 'dire', null, null]);
assert.strictEqual(B.repairOcr('I’accord du verbe et l ’adjectif, ’orthographe'), 'l’accord du verbe et l’adjectif, l’orthographe');
assert.deepStrictEqual(B.dedupeLines(['-Demander de lire le texte (activité 1, page 12).', '-Lire le texte.', '-Souligner les verbes.']),
  ['-Demander de lire le texte (activité 1, page 12).', '-Souligner les verbes.'], 'the shorter echo is dropped, the line with the activity and page is kept');
assert.deepStrictEqual(B.cdSpeech('Penser à voix haute : « Je repère les mots-clés du titre. Je les classe par thème. » Ne pas relever les autres lieux.'),
  { said: 'Je repère les mots-clés du titre. Je les classe par thème.', limit: 'Ne pas relever les autres lieux.' });
assert.strictEqual(B.cdStepName('Je repère les mots-clés : les mots qui portent le sens.'), 'repérer les mots-clés');
assert.deepStrictEqual(B.parseDurations([{ paras: ['Ouverture de la séance', '05:00 min', 'Vocabulaire', '20:00 min', 'Compréhension détaillée', '45 min'] }]),
  [{ kind: 'open', minutes: 5 }, { kind: 'comp:Vocabulaire', minutes: 20 }, { kind: 'comp:Compréhension détaillée', minutes: 45 }]);

// ---- Vocabulaire (1AC): fixed lines, objective, hook question, title and pages from the book
const voc = run('voc', '1AC_UD1_S1.pptx', [
  { shapes: [['Ambiances du quotidien'], ['Séance 1'], ['1AC']] },
  { shapes: [['Structure de la séance'], ['Ouverture de la séance', '05:00 min'], ['Vocabulaire', '20:00 min'], ['Clôture de la séance', '05:00 min']] },
  { shapes: [['Repérage dans l’unité didactique'], ['SÉANCE 1'], ['Vocabulaire : Employer un vocabulaire varié et adapté pour décrire une ambiance du quotidien.']] },
  { shapes: [['Ouverture de la séance', '05:00 min']] },
  { shapes: [['Pour commencer, parlez de votre ambiance préférée à la maison.']] },
  { shapes: [['Vocabulaire', '20:00 min']] },
  { shapes: [['Voici l’objectif de la séance'], ['Employer un vocabulaire varié et adapté pour décrire une ambiance du quotidien.']] },
  { shapes: [['Avant de commencer, je me pose une question.'], ['Quelle est votre ambiance préférée ?']] },
  { shapes: [['Pratiques guidées'], ['Collective'], ['Complétez les phrases avec les mots de la liste.']] },
  { shapes: [['Clôture de la séance', '05:00 min']] },
  { shapes: [['Travail à la maison'], ['Activité 2, page 7']] }
]);
assert.deepStrictEqual([voc.fields.titre, voc.fields.pages, voc.fields.periode, voc.fields.semestre], ['Une ambiance qui fait plaisir !', '6', '1', '1']);
assert.deepStrictEqual(voc.lines('Modelage'), [
  '-Déclaration de l’objectif : Employer un vocabulaire varié et adapté pour décrire une ambiance du quotidien.',
  '-Question d’accroche : Quelle est votre ambiance préférée ?', '-Observer plusieurs images.', '-Expliquer les expressions.', '-Choisir 2 ou 3 élèves pour lire les phrases.']);
assert.ok(voc.res.data.ouverture.includes('-Parler de leur ambiance préférée à la maison pour commencer.'));
assert.deepStrictEqual([voc.res.data.dureeOuverture, voc.res.data.blocs[0].duree, voc.res.data.dureeCloture], ['5 min', '20 min', '5 min']);
assert.ok(voc.lines('Pratiques').includes('Collective :'));

// ---- Compréhension détaillée: steps, what is said aloud, one line per activity, the correction
const cd = run('cd', '3AC_UD1_S4.pptx', head(4, 'Compréhension détaillée', 'Relever des indices et déduire l’idée générale d’un texte.', '45:00 min').concat([
  { shapes: [['Compréhension détaillée', '45:00 min']] },
  { shapes: [['Voici l’objectif de la séance'], ['Relever des indices et déduire l’idée générale d’un texte.']], notes: ['Accorder aux élèves 4 à 5 minutes pour lire silencieusement le texte p. 10.'] },
  { shapes: [['La situation : vous voulez raconter un voyage à un ami.'], ['Notre tâche'], ['Rédiger une lettre.']], notes: ['Présenter la situation et la tâche.', 'Expliquer pourquoi la lecture est utile.'] },
  { shapes: [['Quatre étapes pour comprendre un texte'], ['1 Repérer'], ['2 Classer'], ['3 Relever'], ['4 Déduire']], notes: ['Penser à voix haute : « Je repère les mots-clés du titre. Je les classe par thème. » Ne pas relever les autres lieux.'] },
  { shapes: [['Activité 3, p. 12. Étape 1 : relevez les mots du titre.'], ['Collective'], ['1- Quel est le titre du texte ?'], ['2- Pourquoi l’auteur a-t-il choisi ce titre ?']] },
  { shapes: [['Voici les réponses complétées'], ['Collective'], ['Activité 3, p. 12'], ['Le titre est Entre mer et soleil.']], notes: ['Demander aux élèves de justifier leurs réponses.'] },
  { shapes: [['Activité 4, p. 13. Étapes 2 et 3 : travaillez en binôme. Classez les mots puis déduisez l’idée générale.'], ['En binôme'], ['1- Classez les mots du texte']] }
]).concat(tail));
assert.deepStrictEqual([cd.fields.titre, cd.fields.pages], ['Entre mer et soleil', '12']);
const cdMod = cd.lines('Modelage');
assert.ok(cdMod.includes('-Présenter les 4 étapes à suivre pour relever des indices et déduire l’idée générale d’un texte : repérer, classer, relever, déduire.'));
assert.ok(cdMod.includes('-Expliquer la situation et la tâche : vous voulez raconter un voyage à un ami.'));
const cdPra = cd.lines('Pratiques');
assert.ok(cdPra.includes('Collective :') && cdPra.includes('En binôme :'));
assert.ok(cdPra.some((l) => l.startsWith('-Étape 1 (activité 3, page 12) : Demander de relever les mots du titre ; questions : 1) Quel est le titre du texte ? 2) Pourquoi') && l.includes('justifier leurs réponses.') && l.endsWith('Vérifier ensemble les réponses et corriger.')));
assert.ok(cdPra.some((l) => l.startsWith('-Étapes 2-3 (activité 4, page 13) : Demander de classer les mots puis de déduire l’idée générale')));
assert.ok(cd.res.data.cloture.includes('-Demander aux apprenants d’effectuer à la maison l’activité 2, p. 14 du livret. Elle sera corrigée au début de la prochaine séance.'));

// ---- Actes de parole: the speech acts are read from the boxes ending with « … »
const ap = run('ap', '1AC_UD1_S3.pptx', head(3, 'Actes de parole', 'Décrire une ambiance avec « Je vois… ».', '20:00 min', '1AC').concat([
  { shapes: [['Nous passons à un exercice. On va désigner quelques uns pour lire le texte.']] },
  { shapes: [['Actes de parole', '20:00 min']] },
  { shapes: [['Voici l’objectif de la séance'], ['Décrire une ambiance avec « Je vois… ».']] },
  { shapes: [['Avant de commencer, je me pose une question.'], ['Que voyez-vous sur la vignette ?']] },
  { shapes: [['Il y a beaucoup de …'], ['Je vois …'], ['Je sens …'], ['Image 3']] },
  { shapes: [['Je retiens'], ['Il y a beaucoup de gens.']] }
]).concat(tail));
assert.ok(ap.lines('Modelage').includes('-Lire chaque vignette et dégager les actes de parole : Il y a beaucoup de… ; Je vois… ; Je sens…'));
assert.ok(ap.lines('Modelage').includes('-Observer la vignette et lire la situation.'));
assert.ok(ap.res.data.ouverture.includes('-Désigner quelques élèves pour lire le texte.'));

// ---- Compréhension de l’oral: numbered steps and a « Rappel » with its steps
const co = run('co', '1AC_UD1_S2.pptx', head(2, 'Compréhension de l’oral', 'Identifier les mots-clés dans un support audio.', '20:00 min', '1AC').concat([
  { shapes: [['Compréhension de l’oral', '20:00 min']] },
  { shapes: [['Voici l’objectif de la séance'], ['Identifier les mots-clés dans un support audio.']] },
  { shapes: [['Six étapes pour une bonne première écoute'], ['1'], ['2'], ['3'], ['Je lis le titre et les sous-titres.'], ['J’écoute le document en entier.'], ['Je note les mots-clés avant de répondre à la question.']] },
  { shapes: [['Rappel (séance 4) : pour relever les mots-clés, je suis ces étapes.'], ['Lire les colonnes : les mots importants'], ['Classer les mots : par thème']] },
  { shapes: [['Pratiques guidées'], ['En binôme'], ['Activité 1, page 7. Écoutez le document et répondez aux questions.']] }
]).concat(tail));
const coMod = co.lines('Modelage');
assert.ok(coMod.includes('-Présenter les six étapes pour une bonne première écoute : 1) lire le titre et les sous-titres ; 2) écouter le document en entier ; 3) noter les mots-clés.'));
assert.ok(coMod.includes('-Rappeler (séance 4) les étapes à suivre pour relever les mots-clés : lire les colonnes, classer les mots.'));

// ---- Lecture fluence / Outils de langue / Production de l’écrit
const lf = run('lf', '3AC_UD1_S5.pptx', head(5, 'Lecture fluence', 'Lire un texte à haute voix.', '15:00 min').concat([
  { shapes: [['Lecture fluence', '15:00 min']] },
  { shapes: [['Rappel : pour lire avec expression, je respecte la ponctuation et je marque des pauses.']] },
  { shapes: [['Pratiques guidées'], ['Collective'], ['Lisez le texte à haute voix.']] }
]).concat(tail));
assert.ok(lf.lines('Modelage').some((l) => l.startsWith('-Rappel : pour lire avec expression')));
assert.ok(lf.lines('Pratiques').includes('-Demander de lire le texte à haute voix.'));
assert.strictEqual(lf.fields.pages, '10-11');

const ol = run('ol', '3AC_UD1_S7.pptx', head(7, 'Outils de langue', 'Utiliser le pronom relatif dans une phrase.', '30:00 min').concat([
  { shapes: [['Outils de langue', '30:00 min']] },
  { shapes: [['Voici l’objectif de la séance'], ['Utiliser le pronom relatif dans une phrase.']] },
  { shapes: [['Pratiques guidées'], ['Collective'], ['Reliez les deux phrases avec « qui » ou « que ».'], ['Justifier']], notes: ['Laisser un temps de réflexion aux élèves avant de répondre.'] },
  { shapes: [['Pratiques guidées'], ['Autonome'], ['Complétez les phrases avec le pronom relatif.']] }
]).concat(tail));
assert.ok(ol.lines('Pratiques').includes('-Demander de relier les deux phrases avec « qui » ou « que » et de justifier.'));
assert.ok(ol.lines('Pratiques').includes('-Laisser un temps de réflexion aux élèves avant de répondre.'), 'notes of a practice slide (Outils de langue)');

const pe = run('pe', '3AC_UD2_S9.pptx', head(9, 'Production de l’écrit', 'Rédiger un paragraphe descriptif.', '40:00 min').concat([
  { shapes: [['Production de l’écrit', '40:00 min']] },
  { shapes: [['Voici l’objectif de la séance'], ['Rédiger un paragraphe descriptif.']] },
  { shapes: [['MASQUÉE : texte caché']], hidden: true },
  { shapes: [['Au tableau'], ['T']] },
  { shapes: [['Ardoises'], ['R']] },
  { shapes: [['Pratiques guidées'], ['Collective'], ['Lisez le texte à haute voix. Entourez les verbes (activité 1, page 18).']] },
  { shapes: [['Pratiques guidées'], ['Collective'], ['Entourez les verbes du texte.']] },
  { shapes: [['Écoutez le modèle'], ['L']] },
  { shapes: [['Pratiques guidées'], ['Autonome'], ['Rédigez votre paragraphe.']] }
]).concat(tail));
const peMod = pe.lines('Modelage');
assert.ok(peMod.includes('-Faire passer quelques élèves au tableau.') && peMod.includes('-Les élèves utilisent leurs ardoises.'));
assert.ok(!JSON.stringify(pe.res.data).includes('texte caché'), 'hidden slides are ignored');
const pePra = pe.lines('Pratiques');
assert.ok(pePra.includes('-Demander de lire le texte à haute voix et d’entourer les verbes (activité 1, page 18)'));
assert.ok(!pePra.includes('-Demander d’entourer les verbes du texte.'), 'the same instruction written twice is kept once');
assert.ok(pePra.includes('-Demander aux élèves d’écouter le modèle.'), 'an ear slide after the practices belongs to the practices');
assert.ok(pe.res.notes.some((n) => n.startsWith('Consignes semblables regroupées')));
assert.strictEqual(pe.fields.tache, 'Rédiger un paragraphe descriptif.'); // no « tâche finale » anywhere: the production objective is used

// ---- « Pratique pédagogique efficace » is the structure slide in some decks (the times are in it)
const ppe = run('ppe', '1AC_UD3_S1.pptx', [
  { shapes: [['Mon unité'], ['Séance 1'], ['1AC']] },
  { shapes: [['Pratique pédagogique efficace de la semaine'], ['Ouverture de la séance', '5 min'], ['Vocabulaire', '15 min'], ['Clôture de la séance', '10 min']] },
  { shapes: [['Vocabulaire', '15 min']] },
  { shapes: [['Voici l’objectif de la séance'], ['Employer des mots pour décrire.']] }
]);
assert.deepStrictEqual([ppe.res.data.dureeOuverture, ppe.res.data.blocs[0].duree, ppe.res.data.dureeCloture], ['5 min', '15 min', '10 min']);

console.log('BUILDER TESTS PASSED');
