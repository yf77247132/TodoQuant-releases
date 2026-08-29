import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serverFile = path.join(__dirname, '..', 'dist-server', 'server.cjs');
if (!fs.existsSync(serverFile)) {
  console.error('server.cjs not found, skipping');
  process.exit(0);
}

let content = fs.readFileSync(serverFile, 'utf-8');
content = content.replace(/console\.log\s*\(\s*\)/g, 'void 0');
content = content.replace(/console\.log\(/g, 'void (');
fs.writeFileSync(serverFile, content);
console.log('Console.log stripped from: ' + serverFile);
