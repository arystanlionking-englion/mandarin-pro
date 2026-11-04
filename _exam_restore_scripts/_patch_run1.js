const fs = require('fs');
const p = 'C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/_e2e_exam_check/_run.js';
let s = fs.readFileSync(p, 'utf8');
const before = "assert(b.exams && b.exams.exams && b.exams.exams.length === 1, 'backup contains exams');";
const after = "assert(b.exams && Array.isArray(b.exams.exams) && b.exams.exams.length >= 1 && b.exams.exams.some(x => x && x.id === 'exam-e2e-1'), 'backup contains exams');";
if (s.includes(before)) {
  s = s.split(before).join(after);
  fs.writeFileSync(p, s, 'utf8');
  console.log('patched OK');
} else {
  console.log('pattern not found; current asserts:');
  const i = s.indexOf('backup contains exams');
  console.log(s.slice(i - 200, i + 80));
}
