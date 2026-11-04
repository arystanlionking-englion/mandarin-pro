const fs = require('fs');
const p = 'C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/_e2e_exam_check/_ui_check2.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  "  await cdpEval(ws, `(window.Exams.go('exams'), 'ok')`);\n  await sleep(1200);\n  const admTabs",
  "  await cdpEval(ws, `(window.go('exams'), 'ok')`);\n  await sleep(2000);\n  const admTabs"
);
fs.writeFileSync(p, s, 'utf8');
console.log('patched:', s.includes("window.go('exams'), 'ok')`);\n  await sleep(2000);\n  const admTabs"));
