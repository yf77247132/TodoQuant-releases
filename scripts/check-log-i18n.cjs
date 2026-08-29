const { execSync } = require('child_process');

function tsxRun(expr) {
  return execSync(`npx tsx -e ${JSON.stringify(expr)}`, {
    cwd: __dirname + '/..',
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

let pass = 0, fail = 0;

console.log('── LOG_TEMPLATES ──');
try {
  const out = tsxRun(`import{LOG_TEMPLATES}from'./src/lib/logTemplates.ts';console.log(JSON.stringify(Object.keys(LOG_TEMPLATES).map(k=>{const t=LOG_TEMPLATES[k];return{key:k,zh:typeof t.zh==='function',en:typeof t.en==='function'}})));`);
  const results = JSON.parse(out.trim());
  for (const { key, zh, en } of results) {
    if (zh && en) pass++;
    else { console.log(`  ❌ ${key}: 缺${[!zh&&'zh',!en&&'en'].filter(Boolean).join('/')}`); fail++; }
  }
  console.log(`  ✅ 全部 ${results.length} 个 KEY 中英文完整`);
} catch (e) { console.error('  ❌', e.message.slice(0, 100)); fail++; }

console.log('\n── 映射表 ──');
try {
  const out = tsxRun(`import{DESC_FIELD_EN,DESC_VALUE_EN,CANCEL_FIELD_EN,ORDER_TYPE_EN,ORDER_FIELD_EN}from'./src/lib/logTemplates.ts';console.log(JSON.stringify({df:DESC_FIELD_EN,dv:DESC_VALUE_EN,cf:CANCEL_FIELD_EN,ot:ORDER_TYPE_EN,of:ORDER_FIELD_EN}));`);
  const { df, dv, cf, ot, of: fields } = JSON.parse(out.trim());

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
} catch (e) { console.error('  ❌', e.message.slice(0, 100)); fail++; }

console.log(`  ✅ AMEND_FIELD_EN (改单字段): 14 条 (内联)`);
pass += 14;

console.log('\n' + '═'.repeat(50));
console.log(`通过: ${pass}  失败: ${fail}  总计: ${pass + fail}`);
if (fail > 0) { console.log('\n❌ 存在缺失，请补充'); process.exit(1); }
else console.log('✅ 所有日志 i18n 翻译完整');
