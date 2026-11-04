const fs = require('fs');
const path = require('path');

const roots = [
  'C:/Users/狮子/Desktop/Флешка Арыстана',
  'C:/Users/狮子/БАНК',
  'C:/Users/狮子/qwerty'
];

let scanned = 0;
function walkDir(dir, depth) {
  if (depth > 7) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walkDir(p, depth + 1);
    } else if (/\.json$/i.test(e.name)) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        if (raw.length > 20 * 1024 * 1024) continue;
        scanned++;
        const d = JSON.parse(raw);
        if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
        // standalone exams format: version===1 + exams/attempts/students/ledger/audit arrays
        const keys = Object.keys(d);
        const isStandalone = d.version === 1 && Array.isArray(d.exams) && Array.isArray(d.attempts);
        const hasAttempts = Array.isArray(d.attempts) && d.attempts.length > 0;
        const hasExamsArr = Array.isArray(d.exams) && d.exams.length > 0;
        const hasLedger = Array.isArray(d.ledger) && d.ledger.length > 0;
        // any attempt-like arrays anywhere top-level
        const attemptLike = keys.filter(k => /attempt|result|grade|score|exam/i.test(k));
        if (isStandalone || hasAttempts || hasExamsArr || hasLedger || (attemptLike.length && keys.some(k => /exam|attempt/i.test(k)))) {
          console.log('HIT:', p);
          console.log('   keys:', keys.join(','));
          console.log('   standalone:', isStandalone, '| attempts:', hasAttempts, '| exams:', hasExamsArr, '| ledger:', hasLedger);
        }
      } catch (err) { /* skip */ }
    }
  }
}
for (const r of roots) walkDir(r, 0);
console.log('\nscanned json files:', scanned);
