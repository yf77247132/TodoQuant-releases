const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const outFile = path.join(__dirname, '..', 'dist-server', 'server.cjs');

if (!fs.existsSync(outFile)) {
  console.error('server.cjs not found, run build first');
  process.exit(1);
}

const hashContent = fs.readFileSync(outFile);
const hashHex = crypto.createHash('sha256').update(hashContent).digest('hex');
fs.writeFileSync(outFile + '.hash', hashHex);
console.log('Hash written: ' + hashHex);
