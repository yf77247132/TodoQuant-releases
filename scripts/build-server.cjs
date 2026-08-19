const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const outDir = path.join(__dirname, '..', 'dist-server');
const outFile = path.join(outDir, 'server.cjs');

if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}
fs.mkdirSync(outDir, { recursive: true });

esbuild.build({
  entryPoints: [path.join(__dirname, '..', 'server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: outFile,
  external: [
    'better-sqlite3',
    'electron',
    'vite',
    'lightningcss',
    'esbuild',
  ],
  minify: false,
  sourcemap: false,
}).then(() => {
  console.log('Server build complete: ' + outFile);
}).catch((err) => {
  console.error('Server build failed:', err);
  process.exit(1);
});
