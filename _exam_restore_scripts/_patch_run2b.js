const fs = require('fs');
const p = 'C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/_e2e_exam_check/_run2.js';
let s = fs.readFileSync(p, 'utf8');
// show all server output
s = s.replace("server.stdout.on('data', d => { const s = String(d); if (/ready|listen/i.test(s)) process.stdout.write('[srv] ' + s); });",
  "server.stdout.on('data', d => process.stdout.write('[srv] ' + d));");
// guaranteed cleanup
s = s.replace("main().catch(e => { console.error('E2E ERROR:', e.message); process.exitCode = 1; });",
  "main().catch(e => { console.error('E2E ERROR:', e.message); process.exitCode = 1; setTimeout(() => process.exit(1), 500); });");
fs.writeFileSync(p, s, 'utf8');
console.log('patched2');
