const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

function resolveSpec(file, spec) {
  if (!spec) return null;
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null;
  const base = spec.startsWith('@/')
    ? path.join(SRC, spec.slice(2))
    : path.resolve(path.dirname(file), spec);
  const candidates = [
    base,
    base + '.ts',
    base + '.tsx',
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function importsOf(file) {
  const src = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  const statics = [];
  const dynamics = [];
  let m;

  const staticRe = /(?:import|export)\s+(?:type\s+)?[^'";]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
  while ((m = staticRe.exec(src))) {
    if (/^import\s+type|^export\s+type/.test(m[0])) continue;
    const resolved = resolveSpec(file, m[1] || m[2]);
    if (resolved) statics.push(resolved);
  }

  const dynamicRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)(?!\s*\.\s*[A-Z])/g;
  while ((m = dynamicRe.exec(src))) {
    const resolved = resolveSpec(file, m[1]);
    if (resolved) dynamics.push(resolved);
  }

  return { statics, dynamics };
}

const files = walk(SRC);
const fileSet = new Set(files);
const staticGraph = new Map();
const dynamicRefs = [];
const dynamicSeen = new Set();

for (const f of files) {
  const { statics, dynamics } = importsOf(f);
  staticGraph.set(f, statics.filter(v => fileSet.has(v)));
  for (const d of dynamics) {
    if (!fileSet.has(d)) continue;
    const key = f + '\u0000' + d;
    if (dynamicSeen.has(key)) continue;
    dynamicSeen.add(key);
    dynamicRefs.push({ from: f, to: d });
  }
}

const idOf = new Map(files.map((f, i) => [f, i]));
const adj = files.map(f => (staticGraph.get(f) || []).map(v => idOf.get(v)));
let counter = 0;
const index = new Array(files.length).fill(-1);
const low = new Array(files.length).fill(0);
const onStack = new Array(files.length).fill(false);
const stack = [];
const sccs = [];
(function run() {
  const strongconnect = (v) => {
    index[v] = low[v] = counter++;
    stack.push(v);
    onStack[v] = true;
    for (const w of adj[v]) {
      if (index[w] === -1) {
        strongconnect(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (onStack[w]) {
        low[v] = Math.min(low[v], index[w]);
      }
    }
    if (low[v] === index[v]) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack[w] = false;
        comp.push(w);
      } while (w !== v);
      sccs.push(comp);
    }
  };
  for (let i = 0; i < files.length; i++) {
    if (index[i] === -1) strongconnect(i);
  }
})();

const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');
const cycles = sccs.filter(c => c.length > 1).sort((a, b) => a.length - b.length);

const out = [];
out.push(`扫描 ${files.length} 个 .ts/.tsx（src/） · 静态环分量 ${cycles.length} 个`);
if (cycles.length > 0) {
  for (const comp of cycles) {
    const inComp = new Set(comp);
    out.push('');
    out.push(`[${comp.length} 文件]`);
    for (const v of comp) out.push(`  ${rel(files[v])}`);
    for (const v of comp) {
      const to = adj[v].filter(w => inComp.has(w));
      if (to.length) out.push(`    ${rel(files[v])} -> ${to.map(w => rel(files[w])).join(', ')}`);
    }
  }
} else {
  out.push('静态 import 无环 ✅');
}
if (dynamicRefs.length > 0) {
  out.push('');
  out.push(`动态 import() 引用 ${dynamicRefs.length} 处（运行时按需加载，无 TDZ 风险，不计入环）`);
  for (const r of dynamicRefs) out.push(`  ${rel(r.from)} -> ${rel(r.to)}`);
}
console.log(out.join('\n'));

process.exitCode = cycles.length > 0 ? 1 : 0;
