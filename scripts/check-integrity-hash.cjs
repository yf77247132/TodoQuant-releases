#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const errors = [];
const notes = [];

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function checkPair(artifactPath, hashPath, label) {
  if (!fs.existsSync(artifactPath)) {
    notes.push(`跳过（产物不存在，可能未构建）: ${rel(artifactPath)}`);
    return;
  }
  if (!fs.existsSync(hashPath)) {
    errors.push(
      `缺失 hash 文件: ${rel(artifactPath)} 应有 ${rel(hashPath)}（${label}）——` +
      `打包后主进程会抛 Integrity hash file missing 导致启动失败`
    );
    return;
  }
  const expected = fs.readFileSync(hashPath, 'utf-8').trim();
  const actual = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
  if (expected !== actual) {
    errors.push(
      `hash 不一致: ${rel(hashPath)}\n` +
      `    期望(文件记录)=${expected}\n    实际(重新计算)=${actual}\n` +
      `    → 产物被改过但 hash 没重写，请重新执行构建（write-hash / electron:compile）`
    );
    return;
  }
  notes.push(`校验通过: ${rel(artifactPath)} ↔ ${rel(hashPath)}`);
}

const mainTsPath = path.join(ROOT, 'electron', 'main.ts');
const mainTs = fs.readFileSync(mainTsPath, 'utf-8');

const entryRe = /\{\s*path:\s*path\.join\(([\w$]+)\s*,\s*'([^']+)'\)\s*,\s*hash:\s*path\.join\(([\w$]+)\s*,\s*'([^']+)'\)\s*\}/g;

let m;
let entryCount = 0;
const pairs = [];
while ((m = entryRe.exec(mainTs)) !== null) {
  entryCount++;
  const artifactName = m[2];
  const hashName = m[4];
  if (hashName !== artifactName + '.hash') {
    errors.push(
      `完整性校验文件名不匹配（electron/main.ts）: 产物 '${artifactName}' 却去找 hash 文件 '${hashName}'，` +
      `应为 '${artifactName}.hash'（与 scripts/write-hash.cjs 的落盘规则一致）`
    );
  } else {
    notes.push(`命名契约 OK: '${artifactName}' → '${hashName}'`);
  }
  if (artifactName === 'server.cjs') {
    pairs.push({
      artifactPath: path.join(ROOT, 'dist-server', 'server.cjs'),
      hashPath: path.join(ROOT, 'dist-server', hashName),
      label: 'dist-server',
    });
  } else if (artifactName === 'main.js') {
    pairs.push({
      artifactPath: path.join(ROOT, 'electron', 'main.js'),
      hashPath: path.join(ROOT, 'electron', hashName),
      label: 'electron',
    });
  }
}

if (entryCount === 0) {
  errors.push(
    'electron/main.ts 中未解析到任何完整性校验项（integrityFiles 结构可能已变），' +
    '请同步更新 scripts/check-integrity-hash.cjs 的正则'
  );
}

const writeHashPath = path.join(ROOT, 'scripts', 'write-hash.cjs');
const writeHash = fs.readFileSync(writeHashPath, 'utf-8');
if (!/writeFileSync\(outFile\s*\+\s*'\.hash'/.test(writeHash)) {
  errors.push(
    'scripts/write-hash.cjs 的落盘规则已变更（不再是 outFile + \'.hash\'），' +
    '请确认 electron/main.ts 的 hash 文件名同步更新，并更新本脚本'
  );
} else {
  notes.push("落盘规则 OK: write-hash.cjs → outFile + '.hash'");
}

for (const p of pairs) {
  checkPair(p.artifactPath, p.hashPath, p.label);
}

for (const n of notes) console.log(`  · ${n}`);

if (errors.length > 0) {
  console.error('\n❌ 完整性校验「文件名契约」检查未通过：');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('\n✅ 完整性校验文件名契约检查通过');
