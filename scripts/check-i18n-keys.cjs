const fs = require('fs');
const zh = JSON.parse(fs.readFileSync('src/i18n/locales/zh-CN.json', 'utf8'));
const en = JSON.parse(fs.readFileSync('src/i18n/locales/en-US.json', 'utf8'));

const namespaces = ['amend', 'apiKeys', 'log', 'config', 'app', 'tradingview', 'strategy', 'condition', 'cancel', 'close', 'margin', 'system', 'diy', 'design', 'position', 'order', 'account'];

let failCount = 0;

namespaces.forEach(ns => {
  const zhKeys = zh[ns] ? Object.keys(zh[ns]).length : 0;
  const enKeys = en[ns] ? Object.keys(en[ns]).length : 0;
  if (zhKeys !== enKeys) failCount++;
  const mismatch = zhKeys !== enKeys ? ' MISMATCH' : '';
  console.log(ns + ': zh=' + zhKeys + ' en=' + enKeys + mismatch);
});

console.log('\n--- Missing en keys ---');
namespaces.forEach(ns => {
  if (!zh[ns]) return;
  const missing = Object.keys(zh[ns]).filter(k => !en[ns] || !(k in en[ns]));
  if (missing.length > 0) {
    failCount += missing.length;
    console.log(ns + ': ' + missing.join(', '));
  }
});

console.log('\n--- Missing zh keys ---');
namespaces.forEach(ns => {
  if (!en[ns]) return;
  const missing = Object.keys(en[ns]).filter(k => !zh[ns] || !(k in zh[ns]));
  if (missing.length > 0) {
    failCount += missing.length;
    console.log(ns + ': ' + missing.join(', '));
  }
});

console.log('\n--- Empty en values ---');
namespaces.forEach(ns => {
  if (!en[ns]) return;
  const empty = Object.entries(en[ns]).filter(([, v]) => !v || v === '').map(([k]) => k);
  if (empty.length > 0) {
    failCount += empty.length;
    console.log(ns + ': ' + empty.join(', '));
  }
});

console.log('');
if (failCount > 0) {
  console.log(`❌ i18n 键校验未通过：共 ${failCount} 处问题（键数不一致 / 缺失键 / 空值）`);
  process.exit(1);
}
console.log('✅ i18n 键校验通过：中英对齐、无缺失、无空值');
