const javascriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist', 'assets');
if (!fs.existsSync(distDir)) {
  console.error('[obfuscate-frontend] dist/assets not found — aborting (run vite build first)');
  process.exit(1);
}

const jsFiles = fs.readdirSync(distDir)
  .filter(f => f.endsWith('.js') && !f.startsWith('vendor-'));

console.log(`Obfuscating ${jsFiles.length} frontend JS files...`);

jsFiles.forEach(file => {
  const filePath = path.join(distDir, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  const result = javascriptObfuscator.obfuscate(content, {
    compact: true,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    identifierNamesGenerator: 'hexadecimal',
    controlFlowFlattening: false,
    deadCodeInjection: false,
    renameGlobals: false,
    renameProperties: false,
    splitStrings: true,
    splitStringsChunkLength: 5,
    transformObjectKeys: true,
    numbersToExpressions: true,
  });
  
  fs.writeFileSync(filePath, result.getObfuscatedCode());
  console.log(`  ✓ ${file}`);
});

console.log('Frontend obfuscation complete.');
