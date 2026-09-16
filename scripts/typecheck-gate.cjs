
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASELINE_FILE = path.join(__dirname, 'tsconfig-baseline.txt');
const IS_UPDATE = process.argv.includes('--update');

const TSC_BIN = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

const CRASH_MARKERS = [
  'RangeError: Maximum call stack size exceeded',
  'JavaScript heap out of memory',
  'FATAL ERROR',
];

function runTsc() {
  const res = spawnSync(process.execPath, [TSC_BIN, '--noEmit', '-p', 'tsconfig.json'], {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    output: String(res.stdout || '') + String(res.stderr || ''),
    status: res.status,
    error: res.error,
  };
}

function tailOf(output, n = 15) {
  const lines = output.split(/\r?\n/).filter(Boolean);
  return lines.slice(-n).join('\n');
}

function isTscBroken(tsc, parsedCount) {
  if (tsc.error) return true;
  if (tsc.status === 0) return false;
  const crashHit = CRASH_MARKERS.some((mk) => tsc.output.includes(mk));
  return crashHit || parsedCount === 0;
}

function parseErrors(output) {
  const counts = new Map();
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^(.+?)\(\d+,\d+\):\s+error\s+(TS\d+):\s+(.*)$/);
    if (!m) continue;
    const rel = path.relative(ROOT, path.resolve(ROOT, m[1])).split(path.sep).join('/');
    const fp = `${rel}|${m[2]}|${m[3]}`;
    counts.set(fp, (counts.get(fp) || 0) + 1);
  }
  return counts;
}

function multisetDiff(current, baseline) {
  const added = [];
  const removed = [];
  const keys = new Set([...current.keys(), ...baseline.keys()]);
  for (const k of keys) {
    const c = current.get(k) || 0;
    const b = baseline.get(k) || 0;
    for (let i = 0; i < c - b; i++) added.push(k);
    for (let i = 0; i < b - c; i++) removed.push(k);
  }
  return { added, removed };
}

const tsc = runTsc();
const output = tsc.output;
const current = parseErrors(output);

if (isTscBroken(tsc, current.size)) {
  if (tsc.error) {
    console.error(`[typecheck-gate] ❌ tsc 进程无法启动（闸口拦截，exit 2）：${tsc.error}`);
  } else {
    console.error('[typecheck-gate] ❌ tsc 异常退出但解析不到类型错误 —— 疑似进程崩溃（假绿防线拦截）：');
    console.error(tailOf(output));
    console.error('\n请根据上方原始输出定位崩溃原因（典型：allowJs 扫描到超大/混淆的 JS 产物导致栈溢出，检查 tsconfig.json exclude 是否覆盖新增的产物目录）。');
  }
  process.exit(tsc.error ? 2 : 1);
}

if (IS_UPDATE) {
  const lines = [];
  for (const [k, n] of [...current.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (let i = 0; i < n; i++) lines.push(k);
  }
  fs.writeFileSync(BASELINE_FILE, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
  console.log(`[typecheck-gate] 基线已更新：${lines.length} 条错误指纹（唯一 ${current.size}） → ${path.relative(ROOT, BASELINE_FILE)}`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_FILE)) {
  console.error('[typecheck-gate] 基线文件不存在，请先运行: node scripts/typecheck-gate.cjs --update');
  process.exit(2);
}

const baseline = new Map();
for (const line of fs.readFileSync(BASELINE_FILE, 'utf-8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  baseline.set(line, (baseline.get(line) || 0) + 1);
}

const { added, removed } = multisetDiff(current, baseline);

if (added.length > 0) {
  console.error(`\n[typecheck-gate] ❌ 检测到 ${added.length} 条【新增】类型错误（闸口拦截）：\n`);
  for (const fp of added) console.error('  ' + fp.replace(/\|/g, ' | '));
  console.error('\n修复新增错误后再提交；若属预期内的存量重构，请单独说明并 --update 基线。');
  process.exit(1);
}

console.log(`[typecheck-gate] ✅ 无新增类型错误（基线 ${baseline.size ? [...baseline.values()].reduce((a, b) => a + b, 0) : 0} 条存量，当前 ${[...current.values()].reduce((a, b) => a + b, 0)} 条）`);
if (removed.length > 0) {
  console.log(`[typecheck-gate] 💡 相比基线已修复 ${removed.length} 条，可运行 --update 收紧基线`);
}
process.exit(0);
