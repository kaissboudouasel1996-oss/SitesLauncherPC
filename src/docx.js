'use strict';
// Writes the "Fiche technique" as a real .docx (Word) file. Port of FicheDocx.kt, with automatic one-page fitting.
const { writeZip } = require('./zip');

const NS = "xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main' xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'";
const DECL = "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>";
const W1 = [2614, 1850, 1750, 2300, 1942];
const W2 = [2547, 6804, 1134];
const PAGE_H = 16838, MARGIN = 720;

/** French typography: curly apostrophe, « guillemets » with non-breaking spaces. */
function typo(s) {
  let t = s.replace(/‿/g, '').replace(/'/g, '’').replace(/“/g, '«').replace(/”/g, '»');
  t = t.replace(/«\s*/g, '« ').replace(/\s*»/g, ' »');
  return t;
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rpr = (bold, sz) => (bold ? '<w:b/><w:bCs/>' : '') + `<w:sz w:val='${sz}'/><w:szCs w:val='${sz}'/>`;

function para(text, bold, sz, jc, bullet) {
  let ppr = '';
  if (bullet === 'obj') ppr += "<w:numPr><w:ilvl w:val='0'/><w:numId w:val='1'/></w:numPr><w:ind w:left='103' w:hanging='141'/>";
  else if (bullet === 'mode') ppr += "<w:numPr><w:ilvl w:val='0'/><w:numId w:val='2'/></w:numPr><w:ind w:left='132' w:hanging='142'/>";
  if (jc) ppr += `<w:jc w:val='${jc}'/>`;
  const run = text ? `<w:r><w:rPr>${rpr(bold, sz)}</w:rPr><w:t xml:space='preserve'>${esc(typo(text))}</w:t></w:r>` : '';
  return `<w:p><w:pPr>${ppr}<w:rPr>${rpr(bold, sz)}</w:rPr></w:pPr>${run}</w:p>`;
}

function cell(width, paras, span = 1, vmerge = null) {
  let pr = `<w:tcW w:w='${width}' w:type='dxa'/>`;
  if (span > 1) pr += `<w:gridSpan w:val='${span}'/>`;
  if (vmerge === 'restart') pr += "<w:vMerge w:val='restart'/>";
  if (vmerge === 'cont') pr += '<w:vMerge/>';
  return `<w:tc><w:tcPr>${pr}</w:tcPr>${paras.join('')}</w:tc>`;
}

const border = (name, value) => `<w:${name} w:val='${value}' w:sz='4' w:space='0' w:color='auto'/>`;

function table(widths, rows, outer) {
  const borders = '<w:tblBorders>' + border('top', outer) + border('left', outer) + border('bottom', outer) + border('right', outer) +
    border('insideH', 'single') + border('insideV', 'single') + '</w:tblBorders>';
  const sum = widths.reduce((a, b) => a + b, 0);
  const pr = `<w:tblPr><w:tblW w:w='${sum}' w:type='dxa'/>${borders}<w:tblLayout w:type='fixed'/>` +
    "<w:tblCellMar><w:top w:w='0' w:type='dxa'/><w:left w:w='108' w:type='dxa'/><w:bottom w:w='0' w:type='dxa'/><w:right w:w='108' w:type='dxa'/></w:tblCellMar>" +
    "<w:tblLook w:val='04A0' w:firstRow='1' w:lastRow='0' w:firstColumn='1' w:lastColumn='0' w:noHBand='0' w:noVBand='1'/></w:tblPr>";
  const grid = '<w:tblGrid>' + widths.map((w) => `<w:gridCol w:w='${w}'/>`).join('') + '</w:tblGrid>';
  return '<w:tbl>' + pr + grid + rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r}</w:tr>`).join('') + '</w:tbl>';
}

// ---------- one page: the font size follows the amount of text ----------

/** Estimated height (in twips) of paragraphs wrapped in a column widthTw wide, at halfPt half-points. */
function textHeight(paras, widthTw, halfPt, bold = false, indentTw = 0) {
  const pt = halfPt / 2;
  const avail = (widthTw - 216 - indentTw) / 20;
  const charW = pt * (bold ? 0.56 : 0.53); // Calibri average, with a safety margin for justified text
  const perLine = Math.max(1, avail / charW);
  let lines = 0;
  for (const p of paras) lines += Math.max(1, Math.ceil([...typo(p)].length / perLine));
  return lines * pt * 1.25 * 20;
}

function estimate(d, body, head) {
  const rest = W1.slice(1).reduce((a, b) => a + b, 0);
  let h = 0;
  h += textHeight(['x'], W1[0], head, true) * 3; // title, first header row, « Déroulement »
  h += textHeight([d.uniteTitre || 'x'], W1[1] + W1[2], head);
  h += textHeight([d.tache || 'x'], rest, head);
  h += textHeight([d.titre || 'x'], rest, head);
  h += textHeight(d.objectifs.length ? d.objectifs : ['x'], rest, head, false, 141);
  h += textHeight(['x'], W2[0], body, true); // table header
  const rowH = (label, lines) => Math.max(textHeight([label], W2[0], body, true), textHeight(lines.length ? lines : ['x'], W2[1], body));
  h += rowH('Ouverture de la séance', d.ouverture);
  for (const b of d.blocs) {
    let blockH = 0;
    for (const r of b.rows) blockH += rowH(r.label, r.paras.map((p) => p.text));
    h += Math.max(blockH, textHeight([b.duree || 'x'], W2[2], body));
  }
  h += rowH('Clôture de la séance', d.cloture);
  return h;
}

/** The biggest size (14 pt down to 6 pt) for which the whole fiche fits in one A4 page. */
function fit(d) {
  const usable = (PAGE_H - 2 * MARGIN - 160) * 0.97;
  let body = 28;
  while (body > 12 && estimate(d, body, Math.min(24, body)) > usable) body--;
  return { body, head: Math.min(24, body) };
}

function documentXml(d, sz) {
  const { body: B, head: H } = sz;
  const headerRows = () => {
    const c = (t) => para(t, true, H, 'center');
    const first = [`Niveau : ${d.niveau}`, `Semestre : ${d.semestre}`, `Séance : ${d.seance}`, 'Durée : 1 heure', d.pages ? `Page : ${d.pages}` : 'Page :']
      .map((t, i) => cell(W1[i], [c(t)])).join('');
    const kv = (k, v) => cell(W1[0], [para(k, true, H, null)]) + cell(W1.slice(1).reduce((a, b) => a + b, 0), v, 4);
    const obj = d.objectifs.length ? d.objectifs.map((o) => para(o, false, H, null, 'obj')) : [para('', false, H, null)];
    // Second line: « Unité N : », the unit title, « Période : » and, in its own cell, the number of the période (from the Sommaire)
    const second = cell(W1[0], [para(`Unité ${d.unite} :`, true, H, null)]) + cell(W1[1] + W1[2], [para(d.uniteTitre, false, H, null)], 2) +
      cell(W1[3], [para('Période :', true, H, 'center')]) + cell(W1[4], [para(d.periode || '', true, H, 'center')]);
    return [first, second, kv('Tâche finale :', [para(d.tache, false, H, null)]),
      kv('Titre :', [para(d.titre, false, H, null)]), kv('Objectifs :', obj)];
  };
  const bodyParas = (paras) => (paras.length ? paras.map((p) => para(p.text, false, B, 'both', p.mode ? 'mode' : null)) : [para('', false, B, 'both')]);
  const row = (label, paras, dur, vmerge) => cell(W2[0], [para(label, true, B, 'center')]) + cell(W2[1], bodyParas(paras)) +
    cell(W2[2], [dur != null ? para(dur, false, B, 'center') : para('', false, B, null)], 1, vmerge);
  const rows = [cell(W2[0], [para('Étapes de la séance', true, B, 'center')]) + cell(W2[1], [para('Descriptif et déroulement', true, B, 'center')]) + cell(W2[2], [para('Durée', false, B, 'center')])];
  rows.push(row('Ouverture de la séance', d.ouverture.map((t) => ({ text: t, mode: false })), d.dureeOuverture));
  for (const b of d.blocs) b.rows.forEach((r, i) => rows.push(row(r.label, r.paras, i === 0 ? b.duree : null, i === 0 ? 'restart' : 'cont')));
  rows.push(row('Clôture de la séance', d.cloture.map((t) => ({ text: t, mode: false })), d.dureeCloture));

  const bodyXml = para('Fiche technique | Collège Rif', true, H, 'center') + table(W1, headerRows(), 'dashSmallGap') +
    para('Déroulement de la séance :', true, H, 'center') + table(W2, rows, 'single');
  const sect = `<w:sectPr><w:pgSz w:w='11906' w:h='${PAGE_H}'/><w:pgMar w:top='${MARGIN}' w:right='${MARGIN}' w:bottom='${MARGIN}' w:left='${MARGIN}' w:header='708' w:footer='708' w:gutter='0'/>` +
    "<w:pgBorders w:offsetFrom='page'><w:top w:val='single' w:sz='4' w:space='24' w:color='auto'/><w:left w:val='single' w:sz='4' w:space='24' w:color='auto'/>" +
    "<w:bottom w:val='single' w:sz='4' w:space='24' w:color='auto'/><w:right w:val='single' w:sz='4' w:space='24' w:color='auto'/></w:pgBorders><w:cols w:space='708'/></w:sectPr>";
  return `${DECL}<w:document ${NS}><w:body>${bodyXml}${sect}</w:body></w:document>`;
}

const STYLES = `${DECL}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii='Calibri' w:hAnsi='Calibri' w:eastAsia='Calibri' w:cs='Calibri'/>` +
  "<w:sz w:val='24'/><w:szCs w:val='24'/><w:lang w:val='fr-FR' w:eastAsia='en-US' w:bidi='ar-SA'/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after='0' w:line='240' w:lineRule='auto'/></w:pPr></w:pPrDefault></w:docDefaults>" +
  "<w:style w:type='paragraph' w:default='1' w:styleId='Normal'><w:name w:val='Normal'/><w:qFormat/></w:style>" +
  "<w:style w:type='table' w:default='1' w:styleId='TableNormal'><w:name w:val='Normal Table'/><w:uiPriority w:val='99'/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w='0' w:type='dxa'/>" +
  "<w:tblCellMar><w:top w:w='0' w:type='dxa'/><w:left w:w='108' w:type='dxa'/><w:bottom w:w='0' w:type='dxa'/><w:right w:w='108' w:type='dxa'/></w:tblCellMar></w:tblPr></w:style></w:styles>";

const abstractNum = (i) => `<w:abstractNum w:abstractNumId='${i}'><w:multiLevelType w:val='hybridMultilevel'/><w:lvl w:ilvl='0'><w:start w:val='1'/><w:numFmt w:val='bullet'/><w:lvlText w:val='•'/>` +
  "<w:lvlJc w:val='left'/><w:pPr><w:ind w:left='720' w:hanging='360'/></w:pPr><w:rPr><w:rFonts w:ascii='Calibri' w:hAnsi='Calibri' w:cs='Calibri' w:hint='default'/></w:rPr></w:lvl></w:abstractNum>";
const NUMBERING = `${DECL}<w:numbering ${NS}>${abstractNum(1)}${abstractNum(2)}<w:num w:numId='1'><w:abstractNumId w:val='1'/></w:num><w:num w:numId='2'><w:abstractNumId w:val='2'/></w:num></w:numbering>`;
const CONTENT_TYPES = `${DECL}<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'><Default Extension='rels' ContentType='application/vnd.openxmlformats-package.relationships+xml'/><Default Extension='xml' ContentType='application/xml'/>` +
  "<Override PartName='/word/document.xml' ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'/>" +
  "<Override PartName='/word/styles.xml' ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'/>" +
  "<Override PartName='/word/numbering.xml' ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'/></Types>";
const RELS = `${DECL}<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='rId1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument' Target='word/document.xml'/></Relationships>`;
const DOC_RELS = `${DECL}<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='rId1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles' Target='styles.xml'/><Relationship Id='rId2' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering' Target='numbering.xml'/></Relationships>`;

/** Returns a Buffer holding the .docx file. */
function toBuffer(d) {
  const sz = fit(d);
  return { buffer: writeZip([
    ['[Content_Types].xml', CONTENT_TYPES], ['_rels/.rels', RELS], ['word/document.xml', documentXml(d, sz)],
    ['word/styles.xml', STYLES], ['word/numbering.xml', NUMBERING], ['word/_rels/document.xml.rels', DOC_RELS]
  ]), fontPt: sz.body / 2 };
}

/** "Fiche_technique_S6_1AC_UD1.docx" */
function fileName(d) {
  const cl = (s) => s.replace(/[^A-Za-z0-9]+/g, '');
  const num = (s) => { const m = /\d+/.exec(s); return m ? m[0] : null; };
  const s = num(d.seance) || cl(d.seance) || 'X';
  const n = cl(d.niveau) || 'X';
  const u = num(d.unite) || cl(d.unite) || 'X';
  return `Fiche_technique_S${s}_${n}_UD${u}.docx`;
}

module.exports = { toBuffer, fileName, typo, fit, _estimate: estimate };
