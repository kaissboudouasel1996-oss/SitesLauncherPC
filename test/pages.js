'use strict';
// Builds a deliberately huge fiche and checks (with LibreOffice) that it stays on one page.
const fs = require('fs'), os = require('os'), path = require('path'), { execSync } = require('child_process');
const docx = require('../src/docx');
const { data } = require('./fixture');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
let ok = true;
for (const [nb, nl] of [[1, 3], [2, 6], [4, 8], [5, 12]]) {
  const out = docx.toBuffer(data(nb, nl));
  const f = path.join(dir, `t${nb}_${nl}.docx`);
  fs.writeFileSync(f, out.buffer);
  execSync(`soffice --headless --convert-to pdf --outdir ${dir} ${f}`, { stdio: 'ignore', timeout: 120000 });
  const info = execSync(`pdfinfo ${f.replace('.docx', '.pdf')}`).toString();
  const pages = parseInt(/Pages:\s+(\d+)/.exec(info)[1], 10);
  console.log(`blocs=${nb} lines=${nl} font=${out.fontPt}pt pages=${pages}`);
  if (pages !== 1) ok = false;
}
console.log(ok ? 'ONE PAGE OK' : 'OVERFLOW');
process.exit(ok ? 0 : 1);
