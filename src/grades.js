'use strict';
// Marks sheet (.xlsx): student list, one column per continuous-assessment mark (CC), average. Port of GradesExport.kt.
const { writeZip } = require('./zip');

const colName = (index) => { let n = index; let s = ''; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

function build(header, rows, cc, avgLabel = 'Moyenne', classLabel = 'Moyenne de la classe') {
  const idCols = header.length;
  const lastRow = rows.length + 1;
  const filled = header.concat(...rows).filter(Boolean);
  const arabic = filled.length > 0 && filled.filter((c) => /[\u0600-\u06FF]/.test(c)).length * 2 > filled.length;
  const firstMark = colName(idCols), lastMark = colName(idCols + cc - 1), avgCol = colName(idCols + cc), totalCols = idCols + cc + 1;
  const text = (ref, style, v) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  const avg = (c, a, b) => `IF(COUNT(${c}${a}:${c}${b})=0,"",ROUND(AVERAGE(${c}${a}:${c}${b}),2))`;

  let s = `${HEAD}<worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0"${arabic ? ' rightToLeft="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  s += `<cols><col min="1" max="${idCols}" width="22" customWidth="1"/><col min="${idCols + 1}" max="${idCols + cc}" width="9" customWidth="1"/><col min="${totalCols}" max="${totalCols}" width="12" customWidth="1"/></cols><sheetData>`;
  s += '<row r="1" ht="24" customHeight="1">';
  header.forEach((h, c) => { s += text(colName(c) + '1', 1, h); });
  for (let k = 1; k <= cc; k++) s += text(colName(idCols + k - 1) + '1', 1, 'CC' + k);
  s += text(avgCol + '1', 1, avgLabel) + '</row>';
  rows.forEach((row, i) => {
    const r = i + 2;
    s += `<row r="${r}">`;
    for (let c = 0; c < idCols; c++) s += text(colName(c) + r, 2, row[c] || '');
    for (let k = 0; k < cc; k++) s += `<c r="${colName(idCols + k)}${r}" s="3"/>`;
    s += `<c r="${avgCol}${r}" s="4"><f>IF(COUNT(${firstMark}${r}:${lastMark}${r})=0,"",ROUND(AVERAGE(${firstMark}${r}:${lastMark}${r}),2))</f></c></row>`;
  });
  const sum = lastRow + 1;
  s += `<row r="${sum}">${text('A' + sum, 5, classLabel)}`;
  for (let c = 1; c < idCols; c++) s += `<c r="${colName(c)}${sum}" s="5"/>`;
  for (let k = 0; k <= cc; k++) { const col = colName(idCols + k); s += `<c r="${col}${sum}" s="4"><f>${avg(col, 2, lastRow)}</f></c>`; }
  s += '</row></sheetData>';
  s += `<dataValidations count="1"><dataValidation type="decimal" operator="between" allowBlank="1" showErrorMessage="1" sqref="${firstMark}2:${lastMark}${lastRow}"><formula1>0</formula1><formula2>20</formula2></dataValidation></dataValidations></worksheet>`;

  const border = (c) => `<color rgb="${c}"/>`;
  const styles = `${HEAD}<styleSheet xmlns="${MAIN}"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E8C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E1"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin">${border('FFB0B8C4')}</left><right style="thin">${border('FFB0B8C4')}</right><top style="thin">${border('FFB0B8C4')}</top><bottom style="thin">${border('FFB0B8C4')}</bottom><diagonal/></border></borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="2" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/></cellXfs></styleSheet>';

  return writeZip([
    ['[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `${HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="Notes" sheetId="1" r:id="rId1"/></sheets><calcPr fullCalcOnLoad="1"/></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles],
    ['xl/worksheets/sheet1.xml', s]
  ]);
}

module.exports = { build, colName };
