const javascriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, '..', 'dist-server', 'server.cjs');
if (!fs.existsSync(serverFile)) {
  console.error('[obfuscate-core] server.cjs not found — aborting (run build-server.cjs first)');
  process.exit(1);
}

const content = fs.readFileSync(serverFile, 'utf-8');
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

fs.writeFileSync(serverFile, result.getObfuscatedCode());
console.log('Obfuscation complete: ' + serverFile);
