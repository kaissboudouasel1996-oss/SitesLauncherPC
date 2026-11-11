'use strict';
// Builds a small synthetic lesson PowerPoint for the tests (no real lesson data).
const { writeZip } = require('../src/zip');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function slideXml(shapes, hidden) {
  const sp = shapes.map((paras, i) => {
    const ps = (Array.isArray(paras) ? paras : [paras]).map((t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`).join('');
    return `<p:sp><p:nvSpPr><p:cNvPr id="${i + 2}" name="Box ${i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="${1000 + i * 500000}"/><a:ext cx="5000000" cy="400000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/>${ps}</p:txBody></p:sp>`;
  }).join('');
  return `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"${hidden ? ' show="0"' : ''}><p:cSld><p:spTree><p:nvGrpSpPr/>${sp}</p:spTree></p:cSld></p:sld>`;
}
const notesXml = (lines) => `<?xml version="1.0"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="n"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${lines.map((t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;

function makePptx(slides) { // slides: [{shapes:[...], notes:[...], hidden}]
  const files = [];
  const ct = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>';
  files.push(['[Content_Types].xml', ct]);
  const sldIds = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('');
  files.push(['ppt/presentation.xml', `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`]);
  files.push(['ppt/_rels/presentation.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`]);
  slides.forEach((s, i) => {
    files.push([`ppt/slides/slide${i + 1}.xml`, slideXml(s.shapes, s.hidden)]);
    if (s.notes) {
      files.push([`ppt/notesSlides/notesSlide${i + 1}.xml`, notesXml(s.notes)]);
      files.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${i + 1}.xml"/></Relationships>`]);
    }
  });
  return writeZip(files);
}

function lessonSlides(extraLines = 0) {
  const longNotes = [];
  for (let i = 0; i < extraLines; i++) longNotes.push('Lire attentivement la consigne numéro ' + (i + 1) + ' et demander aux élèves de la reformuler avec leurs propres mots devant la classe.');
  return [
    { shapes: [['Voyages et expériences'], ['Séance 4'], ['3AC']] },
    { shapes: [['Structure de la séance'], ['Ouverture de la séance', '05:00 min'], ['Compréhension détaillée', '45:00 min'], ['Clôture de la séance', '05:00 min']] },
    { shapes: [['Repérage dans l’unité didactique'], ['SÉANCE 4'], ['Compréhension détaillée : Relever des indices et déduire l’idée générale et les idées principales d’un texte.'], ['Tâche finale : Rédiger une lettre pour raconter une expérience de voyage.']] },
    { shapes: [['Ouverture de la séance', '05:00 min']] },
    { shapes: [['Contrôle', 'des devoirs']] },
    { shapes: [['La séance dernière, vous avez été chargés de vous entraîner à lire le texte à la maison. On va désigner quelques uns pour le lire. Je lis le texte en marquant des pauses appropriées :'], ['Rappel'], ['Je marque une pause courte après une virgule']] },
    { shapes: [['Compréhension détaillée', '45:00 min']] },
    { shapes: [['Voici l’objectif de la séance'], ['Relever des indices et déduire l’idée générale et les idées principales d’un texte.']],
      notes: ['Modelage : Like vocabulaire.', 'Attirer l’attention des élèves avant de communiquer l’objectif. Expliquer brièvement les termes de l’objectif.', 'Accorder aux élèves 4 à 5 minutes pour lire silencieusement le texte P.10.', 'Rappeler la lecture silencieuse.'].concat(longNotes) },
    { shapes: [['Pratiques guidées'], ['Collective'], ['Réalisez l’activité 1 page 12.']] },
    { shapes: [['Pratiques guidées'], ['En binôme'], ['Réalisez l’activité 3 page 12.']] },
    { shapes: [['Pratiques guidées'], ['Autonome'], ['Travaillez seuls. Activité 4, page 12']] },
    { shapes: [['Clôture de la séance', '05:00 min']] },
    { shapes: [['Travail à la maison'], ['Activité 1, page 10']] }
  ];
}

module.exports = { makePptx, lessonSlides };
