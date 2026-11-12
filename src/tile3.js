'use strict';
// « Espace 3 fenêtres » : Word on the left (full height), PowerPoint top right, the Desktop folder bottom right.
// The real Word, PowerPoint and Explorer windows are placed by a small PowerShell script (copy and paste between them is the normal one of Windows).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const TOOLBAR_HEIGHT = 46;
const OPEN_EXT = { word: /\.(docx?|dotx?|rtf|odt)$/i, ppt: /\.(pptx?|ppsx?|potx?|odp)$/i };

/** The three zones inside an area ({x, y, width, height}); a strip at the top is kept for the toolbar. Same unit as the area. */
function layout(area, barHeight = TOOLBAR_HEIGHT) {
  const x = Math.round(area.x); const y = Math.round(area.y + barHeight);
  const w = Math.round(area.width); const h = Math.round(area.height - barHeight);
  const lw = Math.floor(w / 2); const rw = w - lw; const th = Math.floor(h / 2); const bh = h - th;
  return {
    toolbar: { x: Math.round(area.x), y: Math.round(area.y), width: w, height: barHeight },
    word: { x, y, width: lw, height: h },
    ppt: { x: x + lw, y, width: rw, height: th },
    desk: { x: x + lw, y: y + th, width: rw, height: bh }
  };
}

const rectArg = (r) => [r.x, r.y, r.width, r.height].map((n) => Math.round(Number(n)) | 0).join(',');

const SCRIPT = String.raw`param([string]$Mode,[string]$Word,[string]$Ppt,[string]$Desk,[string]$Open,[string]$Kind,[string]$State)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
[void][W32]::SetProcessDPIAware()
$state = @{}
if ($State -and (Test-Path $State)) { try { $o = Get-Content $State -Raw | ConvertFrom-Json; foreach ($p in $o.PSObject.Properties) { $state[$p.Name] = [int64]$p.Value } } catch {} }
function Alive($v) { return ($v -and [W32]::IsWindow([IntPtr][int64]$v)) }
function FindProc($name) { $p = Get-Process -Name $name | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { return [int64]$p.MainWindowHandle } return 0 }
function FindDesk() {
  $desk = [Environment]::GetFolderPath('Desktop')
  $sh = New-Object -ComObject Shell.Application
  foreach ($w in $sh.Windows()) { try { $path = $w.Document.Folder.Self.Path; if ($path -and ($path -ieq $desk)) { return [int64]$w.HWND } } catch {} }
  return 0
}
function Wait-For($finder, $seconds) { for ($i = 0; $i -lt ($seconds * 4); $i++) { $h = & $finder; if ($h) { return $h }; Start-Sleep -Milliseconds 250 } return 0 }
function Place($h, $rect) {
  if (-not $h -or -not $rect) { return }
  $n = $rect.Split(',') | ForEach-Object { [int]$_ }
  $ptr = [IntPtr][int64]$h
  if ([W32]::IsIconic($ptr) -or [W32]::IsZoomed($ptr)) { [void][W32]::ShowWindow($ptr, 9) }
  [void][W32]::SetWindowPos($ptr, [IntPtr]::Zero, $n[0], $n[1], $n[2], $n[3], 0x0054)
  # the invisible borders of Windows 10/11 windows are taken off so that the three windows touch each other
  $a = New-Object W32+RECT; $b = New-Object W32+RECT
  if ([W32]::GetWindowRect($ptr, [ref]$a) -eq $true -and [W32]::DwmGetWindowAttribute($ptr, 9, [ref]$b, 16) -eq 0) {
    $l = $b.L - $a.L; $r = $a.R - $b.R; $bo = $a.B - $b.B; $t = $b.T - $a.T
    if ($l -gt 0 -or $r -gt 0 -or $bo -gt 0) { [void][W32]::SetWindowPos($ptr, [IntPtr]::Zero, $n[0] - $l, $n[1] - $t, $n[2] + $l + $r, $n[3] + $t + $bo, 0x0054) }
  }
}
$missing = @()
$wh = if (Alive $state.word) { $state.word } else { FindProc 'WINWORD' }
$ph = if (Alive $state.ppt) { $state.ppt } else { FindProc 'POWERPNT' }
$dh = if (Alive $state.desk) { $state.desk } else { FindDesk }
if ($Mode -ne 'tile') {
  if ($Open -and $Kind -eq 'word') { try { Start-Process 'winword.exe' -ArgumentList ('"' + $Open + '"') | Out-Null } catch { $missing += 'word' }; $wh = Wait-For { FindProc 'WINWORD' } 25 }
  elseif (-not $wh) { try { Start-Process 'winword.exe' | Out-Null } catch { $missing += 'word' }; $wh = Wait-For { FindProc 'WINWORD' } 25 }
  if ($Open -and $Kind -eq 'ppt') { try { Start-Process 'powerpnt.exe' -ArgumentList ('"' + $Open + '"') | Out-Null } catch { $missing += 'ppt' }; $ph = Wait-For { FindProc 'POWERPNT' } 25 }
  elseif (-not $ph) { try { Start-Process 'powerpnt.exe' | Out-Null } catch { $missing += 'ppt' }; $ph = Wait-For { FindProc 'POWERPNT' } 25 }
  if (-not $dh) { Start-Process 'explorer.exe' -ArgumentList 'shell:Desktop' | Out-Null; $dh = Wait-For { FindDesk } 10 }
}
Place $wh $Word; Place $ph $Ppt; Place $dh $Desk
if ($State) { try { (@{ word = [int64]$wh; ppt = [int64]$ph; desk = [int64]$dh } | ConvertTo-Json -Compress) | Set-Content -Path $State -Encoding UTF8 } catch {} }
$res = @{ word = [bool]$wh; ppt = [bool]$ph; desk = [bool]$dh }
Write-Output ($res | ConvertTo-Json -Compress)
`;

let scriptFile = null;
function writeScript() {
  if (scriptFile && fs.existsSync(scriptFile)) return scriptFile;
  scriptFile = path.join(os.tmpdir(), 'madrassa-espace3.ps1');
  fs.writeFileSync(scriptFile, '\uFEFF' + SCRIPT, 'utf8'); // the BOM keeps PowerShell 5 reading UTF-8
  return scriptFile;
}

/** Arguments of the script. Only numbers and a file name checked here reach PowerShell. */
function argsFor(mode, rects, opts = {}) {
  const m = ['start', 'tile', 'open'].includes(mode) ? mode : 'tile';
  const a = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', opts.script || writeScript(), '-Mode', m,
    '-Word', rectArg(rects.word), '-Ppt', rectArg(rects.ppt), '-Desk', rectArg(rects.desk)];
  if (opts.statePath) a.push('-State', String(opts.statePath));
  if (m === 'open') {
    const kind = opts.kind === 'ppt' ? 'ppt' : 'word';
    if (!opts.file || !OPEN_EXT[kind].test(opts.file) || /["\r\n]/.test(opts.file)) throw new Error('bad file');
    a.push('-Kind', kind, '-Open', String(opts.file));
  }
  return a;
}

/** Runs the script. Resolves { ok, word, ppt, desk } (true = the window was found and placed). */
function run(mode, rects, opts = {}) {
  return new Promise((resolve) => {
    let args;
    try { args = argsFor(mode, rects, opts); } catch (e) { resolve({ ok: false, error: 'Ce fichier ne peut pas être ouvert ici.' }); return; }
    const sp = opts.spawn || spawn;
    let out = ''; let done = false; let t = null;
    const finish = (r) => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    let child;
    try { child = sp('powershell.exe', args, { windowsHide: true }); } catch (e) { finish({ ok: false, error: 'PowerShell n’a pas pu être lancé.' }); return; }
    t = setTimeout(() => { try { child.kill(); } catch (e) { /* gone */ } finish({ ok: false, error: 'Les fenêtres ont mis trop de temps à s’ouvrir.' }); }, 90000);
    if (child.stdout) child.stdout.on('data', (d) => { out += String(d); });
    child.on('error', () => finish({ ok: false, error: 'PowerShell n’a pas pu être lancé.' }));
    child.on('close', () => {
      const line = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
      try { const j = JSON.parse(line); finish({ ok: true, word: !!j.word, ppt: !!j.ppt, desk: !!j.desk }); } catch (e) { finish({ ok: false, error: 'Les fenêtres n’ont pas pu être placées.' }); }
    });
  });
}

module.exports = { TOOLBAR_HEIGHT, OPEN_EXT, layout, rectArg, argsFor, run, SCRIPT };
