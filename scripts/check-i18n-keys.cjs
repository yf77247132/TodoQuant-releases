const fs = require('fs');
const zh = JSON.parse(fs.readFileSync('src/i18n/locales/zh-CN.json', 'utf8'));
const en = JSON.parse(fs.readFileSync('src/i18n/locales/en-US.json', 'utf8'));

const namespaces = ['amend', 'apiKeys', 'log', 'config', 'app', 'tradingview', 'strategy', 'condition', 'cancel', 'close', 'margin', 'system', 'diy', 'design', 'position', 'order', 'account'];

namespaces.forEach(ns => {
  const zhKeys = zh[ns] ? Object.keys(zh[ns]).length : 0;
  const enKeys = en[ns] ? Object.keys(en[ns]).length : 0;
  const mismatch = zhKeys !== enKeys ? ' MISMATCH' : '';
  console.log(ns + ': zh=' + zhKeys + ' en=' + enKeys + mismatch);
});

console.log('\n--- Missing en keys ---');
namespaces.forEach(ns => {
  if (!zh[ns]) return;
  const missing = Object.keys(zh[ns]).filter(k => !en[ns] || !(k in en[ns]));
  if (missing.length > 0) {
    console.log(ns + ': ' + missing.join(', '));
  }
});

console.log('\n--- Missing zh keys ---');
namespaces.forEach(ns => {
  if (!en[ns]) return;
  const missing = Object.keys(en[ns]).filter(k => !zh[ns] || !(k in zh[ns]));
  if (missing.length > 0) {
    console.log(ns + ': ' + missing.join(', '));
  }
});

console.log('\n--- Empty en values ---');
namespaces.forEach(ns => {
  if (!en[ns]) return;
  const empty = Object.entries(en[ns]).filter(([k, v]) => !v || v === '').map(([k]) => k);
  if (empty.length > 0) {
    console.log(ns + ': ' + empty.join(', '));
  }
});
