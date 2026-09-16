
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FT_PORTABLE_DIR = path.join(ROOT, 'freqtrade-portable');

function findFreqtradeDir() {
  const ftDir = process.env.FT_DIR;
  if (ftDir && fs.existsSync(path.join(ftDir, '.venv'))) {
    console.log(`[build-ft-portable] Using FT_DIR: ${ftDir}`);
    return ftDir;
  }

  const userHome = process.env.USERPROFILE || process.env.HOME || '';
  const defaultPath = path.join(userHome, 'freqtrade');
  if (fs.existsSync(path.join(defaultPath, '.venv'))) {
    console.log(`[build-ft-portable] Using default path: ${defaultPath}`);
    return defaultPath;
  }

  console.error('[build-ft-portable] ERROR: Cannot find freqtrade installation.');
  process.exit(1);
}

function findPythonHome(ftDir) {
  const cfgPath = path.join(ftDir, '.venv', 'pyvenv.cfg');
  if (!fs.existsSync(cfgPath)) return null;

  const content = fs.readFileSync(cfgPath, 'utf-8');
  const match = content.match(/^home = (.+)$/m);
  if (!match) return null;

  const home = match[1].trim();
  if (fs.existsSync(home)) return home;

  console.error(`[build-ft-portable] ERROR: Python home not found: ${home}`);
  return null;
}

function copyDir(src, dest, skipNames, skipExts) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (skipNames && skipNames.has(entry.name)) continue;
    if (skipExts && skipExts.some(ext => entry.name.endsWith(ext))) continue;

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, skipNames, skipExts);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('[build-ft-portable] Building freqtrade portable package...');

const ftDir = findFreqtradeDir();
const pyHome = findPythonHome(ftDir);

if (!pyHome) {
  console.error('[build-ft-portable] ERROR: Cannot find Python home from pyvenv.cfg');
  process.exit(1);
}

if (fs.existsSync(FT_PORTABLE_DIR)) {
  console.log('[build-ft-portable] Removing old portable directory...');
  try { fs.rmSync(FT_PORTABLE_DIR, { recursive: true, force: true }); } catch {
    try { execSync(`powershell -Command "Remove-Item '${FT_PORTABLE_DIR}' -Recurse -Force -ErrorAction SilentlyContinue"`, { stdio: 'ignore' }); } catch {}
  }
}

fs.mkdirSync(FT_PORTABLE_DIR, { recursive: true });

console.log('[build-ft-portable] Copying Python runtime...');

const pyExes = ['python.exe', 'pythonw.exe', 'python3.dll', 'python313.dll'];
for (const f of pyExes) {
  const sp = path.join(pyHome, f);
  if (fs.existsSync(sp)) {
    fs.copyFileSync(sp, path.join(FT_PORTABLE_DIR, f));
  }
}

const vcruntime = path.join(pyHome, 'vcruntime140.dll');
if (fs.existsSync(vcruntime)) {
  fs.copyFileSync(vcruntime, path.join(FT_PORTABLE_DIR, 'vcruntime140.dll'));
}
const vcruntimeAlt = path.join(pyHome, '..', 'vcruntime140.dll');
if (!fs.existsSync(path.join(FT_PORTABLE_DIR, 'vcruntime140.dll')) && fs.existsSync(vcruntimeAlt)) {
  fs.copyFileSync(vcruntimeAlt, path.join(FT_PORTABLE_DIR, 'vcruntime140.dll'));
}

console.log('[build-ft-portable] Python runtime copied');

console.log('[build-ft-portable] Copying Python stdlib...');

const pyLibSrc = path.join(pyHome, 'Lib');
const pyLibDest = path.join(FT_PORTABLE_DIR, 'Lib');

const stdlibSkipDirs = new Set([
  'idlelib', 'turtledemo', 'tkinter', 'ensurepip',
  'site-packages', 'msilib', 'test', 'unittest',
  'pydoc_data', 'distutils',
]);

if (fs.existsSync(pyLibSrc)) {
  copyDir(pyLibSrc, pyLibDest, stdlibSkipDirs, ['.pyc']);
  console.log('[build-ft-portable] Python stdlib copied');
}

console.log('[build-ft-portable] Copying site-packages...');

const spSrc = path.join(ftDir, '.venv', 'Lib', 'site-packages');
const spDest = path.join(pyLibDest, 'site-packages');

const skipPkgs = new Set(['pip', 'setuptools', 'wheel', 'pygments', 'telegram']);
const spEntries = fs.readdirSync(spSrc, { withFileTypes: true });
let spCopied = 0, spSkipped = 0;

for (const entry of spEntries) {
  const pkgName = entry.name.replace(/-[\d.]+.*$/, '');
  if (skipPkgs.has(pkgName)) { spSkipped++; continue; }
  if (skipPkgs.has(entry.name)) { spSkipped++; continue; }

  const srcPath = path.join(spSrc, entry.name);
  const destPath = path.join(spDest, entry.name);

  if (entry.isDirectory()) {
    copyDir(srcPath, destPath, new Set(['__pycache__', 'tests', 'test']), ['.pyc']);
  } else if (!entry.name.endsWith('.pyc')) {
    fs.mkdirSync(spDest, { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }
  spCopied++;
}

console.log(`[build-ft-portable] site-packages: ${spCopied} copied, ${spSkipped} skipped`);

const pyDllsSrc = path.join(pyHome, 'DLLs');
const pyDllsDest = path.join(FT_PORTABLE_DIR, 'DLLs');
if (fs.existsSync(pyDllsSrc)) {
  copyDir(pyDllsSrc, pyDllsDest, null, ['.pdb']);
  console.log('[build-ft-portable] Python DLLs copied');
}

console.log('[build-ft-portable] Copying freqtrade source...');

const ftSrc = path.join(ftDir, 'freqtrade');
const ftDest = path.join(FT_PORTABLE_DIR, 'freqtrade');
const ftSkipDirs = new Set(['tests', 'docker', 'docs', 'scripts', '.git']);
copyDir(ftSrc, ftDest, ftSkipDirs, ['.pyc']);

if (!fs.existsSync(path.join(ftDest, '__main__.py'))) {
}
const ftCmd = path.join(FT_PORTABLE_DIR, 'freqtrade.cmd');
fs.writeFileSync(ftCmd, '@"%~dp0python.exe" -m freqtrade %*\r\n');
console.log('[build-ft-portable] freqtrade.cmd entry point created');

console.log('[build-ft-portable] freqtrade source copied');

const pthContent = [
  'Lib',
  'Lib/site-packages',
  'freqtrade',
  'DLLs',
  '',
  'import site',
  '',
].join('\n');

fs.writeFileSync(path.join(FT_PORTABLE_DIR, 'python313._pth'), pthContent);
console.log('[build-ft-portable] python313._pth written (portable mode)');

function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else try { total += fs.statSync(p).size; } catch {}
  }
  return total;
}

const portableSize = dirSize(FT_PORTABLE_DIR);
console.log(`\n[build-ft-portable] Done! Size: ${(portableSize / 1024 / 1024).toFixed(0)} MB`);
console.log(`[build-ft-portable] Output: ${FT_PORTABLE_DIR}`);
