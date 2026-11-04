const fs = require('fs');
const path = require('path');

const roots = [
  'C:/Users/狮子/Desktop/Флешка Арыстана',
  'C:/Users/狮子/БАНК',
  'C:/Users/狮子/qwerty'
];

const found = [];
function walkDir(dir, depth) {
  if (depth > 6) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walkDir(p, depth + 1);
    } else if (/\.json$/i.test(e.name)) {
      const low = e.name.toLowerCase();
      if (low.includes('database') || low.includes('backup') || low.includes('данные') || low.includes('exam') || low.includes('result')) {
        try {
          const raw = fs.readFileSync(p, 'utf8');
          if (raw.length > 50 * 1024 * 1024) continue;
          const d = JSON.parse(raw);
          let ex = null, tr = null;
          if (d && typeof d === 'object') {
            if (d.exams && typeof d.exams === 'object') {
              ex = { exams: (d.exams.exams || []).length, attempts: (d.exams.attempts || []).length };
            }
            if (Array.isArray(d.testResults)) tr = d.testResults.length;
            // also check standalone format
            if (Array.isArray(d.attempts) && Array.isArray(d.exams)) ex = { exams: d.exams.length, attempts: d.attempts.length, fmt: 'standalone' };
          }
          const interesting = (ex && (ex.exams > 0 || ex.attempts > 0)) || (tr && tr > 0);
          found.push({ p, size: raw.length, ex, tr, interesting });
        } catch (err) { /* not json or parse error */ }
      }
    }
  }
}
for (const r of roots) walkDir(r, 0);
found.sort((a, b) => (b.interesting ? 1 : 0) - (a.interesting ? 1 : 0));
for (const f of found) {
  console.log((f.interesting ? '*** ' : '    ') + f.p, '| size:', f.size, '| exams:', JSON.stringify(f.ex), '| testResults:', f.tr);
}
console.log('\ntotal files scanned:', found.length, '| interesting:', found.filter(f => f.interesting).length);
