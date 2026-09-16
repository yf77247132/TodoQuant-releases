const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const tmpDir = path.join(__dirname, '..', '.tmp-crypto-icons');
const iconsDir = path.join(distDir, 'crypto-icons');

let hadIcons = false;
if (fs.existsSync(iconsDir)) {
  hadIcons = true;
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.cpSync(iconsDir, tmpDir, { recursive: true });
  fs.rmSync(iconsDir, { recursive: true, force: true });
  console.log('[build] 临时移出 crypto-icons (1774 个文件)');
}

try {
  execSync('npx vite build', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
} finally {
  if (hadIcons && fs.existsSync(tmpDir)) {
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
    if (fs.existsSync(iconsDir)) fs.rmSync(iconsDir, { recursive: true, force: true });
    fs.cpSync(tmpDir, iconsDir, { recursive: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('[build] 移回 crypto-icons');
  }
}
