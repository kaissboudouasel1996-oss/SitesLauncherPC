'use strict';
// Text recognition. On Windows it uses the recognition built into Windows 10/11 (Windows.Media.Ocr, through PowerShell): nothing to install,
// it works offline, and it knows the languages that are installed on the PC (French, Arabic...). Elsewhere (development) it uses Tesseract if present.
// The result is the words with their position; toLines() groups them into text boxes like the phone's reader does.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

class OcrError extends Error { constructor(message, code) { super(message); this.code = code || 'OCR_FAILED'; } }

const PS_SCRIPT = `param([string]$Path, [string]$Lang = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Foundation.IAsyncOperation\`1, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [WindowsRuntimeSystemExtensions]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$engine = $null; $used = ''
foreach ($tag in @($Lang, ($Lang -split '-')[0])) {
  if (-not $tag -or $engine) { continue }
  try { $l = New-Object Windows.Globalization.Language($tag); if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($l)) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($l); $used = $tag } } catch { }
}
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages(); $used = 'profile' }
if (-not $engine) { Write-Output '{"error":"no-language"}'; exit 0 }
if ($bitmap.PixelWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $bitmap.PixelHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) { Write-Output '{"error":"too-large"}'; exit 0 }

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$words = New-Object System.Collections.ArrayList
$li = 0
foreach ($line in $result.Lines) {
  foreach ($w in $line.Words) {
    $r = $w.BoundingRect
    [void]$words.Add([pscustomobject]@{ t = $w.Text; x = [math]::Round($r.X, 1); y = [math]::Round($r.Y, 1); w = [math]::Round($r.Width, 1); h = [math]::Round($r.Height, 1); l = $li })
  }
  $li++
}
$out = [pscustomobject]@{ width = $bitmap.PixelWidth; height = $bitmap.PixelHeight; lang = $used; words = @($words) }
Write-Output ($out | ConvertTo-Json -Depth 4 -Compress)
`;

const run = (cmd, args, opts) => new Promise((resolve, reject) => {
  execFile(cmd, args, Object.assign({ windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, opts), (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
});

function parseWindowsResult(stdout) {
  const text = String(stdout).replace(/^\uFEFF/, '').trim();
  let o;
  try { o = JSON.parse(text.slice(text.indexOf('{'))); } catch (e) { throw new OcrError('The Windows text recognition returned something unreadable.', 'OCR_FAILED'); }
  if (o.error === 'no-language') throw new OcrError('No language for text recognition is installed in Windows.', 'OCR_NO_LANGUAGE');
  if (o.error === 'too-large') throw new OcrError('The picture is too large for Windows text recognition.', 'OCR_TOO_LARGE');
  const list = Array.isArray(o.words) ? o.words : (o.words ? [o.words] : []);
  return { width: o.width, height: o.height, lang: o.lang, words: list.map((w) => ({ text: String(w.t), left: w.x, top: w.y, right: w.x + w.w, bottom: w.y + w.h, line: w.l })) };
}

function parseTesseractTsv(tsv, imagePath) {
  const rows = String(tsv).split(/\r?\n/).slice(1); const words = [];
  for (const r of rows) {
    const c = r.split('\t'); if (c.length < 12 || c[0] !== '5') continue;
    const text = c.slice(11).join('\t').trim(); if (!text || parseFloat(c[10]) < 0) continue;
    const [l, t, w, h] = [c[6], c[7], c[8], c[9]].map(Number);
    words.push({ text, left: l, top: t, right: l + w, bottom: t + h, line: `${c[2]}-${c[3]}-${c[4]}` });
  }
  return { width: 0, height: 0, lang: 'tesseract', words, imagePath };
}

/**
 * Reads the text of a picture file (png, jpg...). lang: « fr », « fr-FR », « ar », « en-US ».
 * Returns { width, height, lang, words: [{ text, left, top, right, bottom, line }] }.
 */
async function recognize(imagePath, { lang = 'fr', platform = process.platform, timeoutMs = 90000, tesseractLang = 'eng' } = {}) {
  if (platform === 'win32') {
    const script = path.join(os.tmpdir(), `sl-ocr-${process.pid}.ps1`);
    fs.writeFileSync(script, '\uFEFF' + PS_SCRIPT, 'utf8'); // with a BOM: Windows PowerShell 5 reads it as UTF-8
    try {
      const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', imagePath, '-Lang', lang], { timeout: timeoutMs });
      return parseWindowsResult(out);
    } catch (e) {
      if (e instanceof OcrError) throw e;
      if (e.code === 'ENOENT') throw new OcrError('PowerShell is not available.', 'OCR_UNAVAILABLE');
      throw new OcrError('The Windows text recognition failed: ' + String(e.stderr || e.message).slice(0, 300), 'OCR_FAILED');
    } finally { try { fs.unlinkSync(script); } catch (e) { /* ignore */ } }
  }
  try {
    const out = await run('tesseract', [imagePath, 'stdout', '-l', tesseractLang, '--psm', '11', 'tsv'], { timeout: timeoutMs });
    return parseTesseractTsv(out, imagePath);
  } catch (e) {
    throw new OcrError('No text recognition is available on this system.', 'OCR_UNAVAILABLE');
  }
}

const isArabic = (s) => /[\u0600-\u06FF]/.test(s);

/**
 * Groups the words into text boxes: the words the engine puts in one line, cut where there is a wide gap
 * (two cells of a table side by side are not one text). Arabic is read from right to left.
 */
function toLines(words, gapFactor = 2.4) {
  const byLine = new Map();
  for (const w of words) { if (!byLine.has(w.line)) byLine.set(w.line, []); byLine.get(w.line).push(w); }
  const out = [];
  for (const ws of byLine.values()) {
    ws.sort((a, b) => a.left - b.left);
    const groups = []; let cur = [ws[0]];
    for (let i = 1; i < ws.length; i++) {
      const prev = ws[i - 1]; const h = Math.max(prev.bottom - prev.top, ws[i].bottom - ws[i].top);
      if (ws[i].left - prev.right > h * gapFactor) { groups.push(cur); cur = [ws[i]]; } else cur.push(ws[i]);
    }
    groups.push(cur);
    for (const g of groups) {
      const arabic = g.filter((w) => isArabic(w.text)).length * 2 > g.length;
      const ordered = arabic ? g.slice().reverse() : g;
      out.push({ text: ordered.map((w) => w.text).join(' '), left: Math.min(...g.map((w) => w.left)), top: Math.min(...g.map((w) => w.top)), right: Math.max(...g.map((w) => w.right)), bottom: Math.max(...g.map((w) => w.bottom)) });
    }
  }
  return out.sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom) || a.left - b.left);
}

module.exports = { recognize, toLines, OcrError, parseWindowsResult, parseTesseractTsv, PS_SCRIPT };
