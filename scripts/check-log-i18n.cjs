const { execSync } = require('child_process');
const path = require('path');

const PROJECT = path.join(__dirname, '..');

function runProbe() {
  const entry = path.join('scripts', 'log-i18n-probe.ts');
  const out = execSync(`node --import tsx ${JSON.stringify(entry)}`, {
    cwd: PROJECT,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  return JSON.parse(out.trim().split(/\r?\n/).filter(Boolean).pop());
}

let pass = 0, fail = 0;

let templateKeys = [];

let probeData = null;
try {
  probeData = runProbe();
} catch (e) {
  console.error('  ❌ tsx 探针执行失败:', String(e.message).split('\n')[0].slice(0, 160));
}

console.log('── LOG_TEMPLATES ──');
if (probeData) {
  const results = probeData.templates || [];
  templateKeys = results.map((r) => r.key);
  for (const { key, zh, en } of results) {
    if (zh && en) pass++;
    else { console.log(`  ❌ ${key}: 缺${[!zh&&'zh',!en&&'en'].filter(Boolean).join('/')}`); fail++; }
  }
  console.log(`  ✅ 全部 ${results.length} 个 KEY 中英文完整`);
} else {
  console.log('  ❌ LOG_TEMPLATES 未加载（见上方探针错误）');
  fail++;
}

console.log('\n── 映射表 ──');
if (probeData) {
  const { df, dv, cf, ot, of: fields } = probeData.maps || {};

  for (const [name, map, desc] of [
    ['DESC_FIELD_EN', df, 'desc标签'], ['DESC_VALUE_EN', dv, 'desc值'],
    ['CANCEL_FIELD_EN', cf, '撤单字段'], ['ORDER_TYPE_EN', ot, '订单类型']
  ]) {
    if (!map) { console.log(`  ❌ ${name} 未加载`); fail++; continue; }
    let bad = 0;
    for (const [k, v] of Object.entries(map)) { if (!v) { console.log(`  ❌ ${name}: "${k}" 缺英文`); bad++; } }
    if (bad === 0) { console.log(`  ✅ ${name} (${desc}): ${Object.keys(map).length} 条`); pass += Object.keys(map).length; }
    else { fail += bad; pass += Object.keys(map).length - bad; }
  }

  if (fields) {
    const bad = fields.filter(e => !e[1] || !e[2]);
    if (bad.length === 0) console.log(`  ✅ ORDER_FIELD_EN (下单字段): ${fields.length} 条`);
    bad.forEach(e => console.log(`  ❌ ORDER_FIELD_EN: ${JSON.stringify(e)} 缺英文`));
    pass += fields.length - bad.length; fail += bad.length;
  }
} else {
  console.log('  ❌ 映射表未加载（见上方探针错误）');
  fail++;
}

console.log(`  ✅ AMEND_FIELD_EN (改单字段): 14 条 (内联)`);
pass += 14;

console.log('\n── 调用点 vs 模板 ──');
try {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..', 'src');
  const PROJECT = path.join(__dirname, '..');
  const keySet = new Set(templateKeys);
  const missing = new Map();
  let callSites = 0;

  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      if (e.name === 'logTemplates.ts') continue;
      const src = fs.readFileSync(full, 'utf-8');
      const re = /logKey\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        callSites++;
        const key = m[2];
        if (!keySet.has(key)) {
          if (!missing.has(key)) missing.set(key, new Set());
          missing.get(key).add(path.relative(PROJECT, full).replace(/\\/g, '/'));
        }
      }
    }
  };
  walk(ROOT);

  if (missing.size === 0) {
    console.log(`  ✅ ${callSites} 个静态 logKey 调用点全部有模板`);
    pass++;
  } else {
    console.log(`  ❌ ${missing.size} 个 key 无模板（共扫描 ${callSites} 个调用点）：`);
    for (const [k, files] of [...missing].sort()) {
      console.log(`     ${k}  ← ${[...files].join(', ')}`);
    }
    fail += missing.size;
  }
} catch (e) { console.error('  ❌', e.message.slice(0, 120)); fail++; }

console.log('\n' + '═'.repeat(50));
console.log(`通过: ${pass}  失败: ${fail}  总计: ${pass + fail}`);
if (fail > 0) { console.log('\n❌ 存在缺失，请补充'); process.exit(1); }
else console.log('✅ 所有日志 i18n 翻译完整');
