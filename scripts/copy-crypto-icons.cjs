const fs = require('fs');
const path = require('path');

const srcDir = path.join('node_modules', '@web3icons', 'core', 'dist', 'svgs', 'tokens', 'branded');
const dstDir = path.join('public', 'crypto-icons');

if (!fs.existsSync(srcDir)) {
  console.log('@web3icons/core branded SVGs not found, skipping copy');
  process.exit(0);
}

fs.mkdirSync(dstDir, { recursive: true });

for (const f of fs.readdirSync(dstDir)) {
  fs.unlinkSync(path.join(dstDir, f));
}

let count = 0;
let failed = 0;
for (const file of fs.readdirSync(srcDir)) {
  if (!file.endsWith('.svg.js')) continue;

  const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');

  const varName = file.replace('.svg.js', '');
  const cleaned = content.replace(/^export\s+{[^}]*};?\s*$/gm, '').trim();
  let svg;
  try {
    const fn = new Function(cleaned + `\nreturn ${varName};`);
    svg = fn();
  } catch {
    failed++;
    continue;
  }

  if (typeof svg !== 'string' || !svg.startsWith('<svg')) {
    failed++;
    continue;
  }

  const name = file.replace('.svg.js', '.svg');
  fs.writeFileSync(path.join(dstDir, name), svg, 'utf-8');
  count++;
}

console.log(`Crypto icons extracted: ${count}`);
