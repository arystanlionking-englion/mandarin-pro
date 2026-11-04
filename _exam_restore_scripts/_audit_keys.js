const fs = require('fs');
const files = [
  'C:/Users/狮子/qwerty/данные за 29 число.json',
  'C:/Users/狮子/qwerty/данные за 30 число.json',
  'C:/Users/狮子/qwerty/данные за 4 число.json',
  'C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/database.json'
];
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const keys = new Set();
  function walk(o) {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) { keys.add(k); walk(o[k]); }
    }
  }
  walk(d);
  const arr = [...keys].sort();
  console.log('===', f.split('/').pop(), '| unique keys:', arr.length);
  console.log(arr.join(', '));
  console.log();
}
