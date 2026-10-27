const fs = require('fs');
const base = 'C:/Users/狮子/qwerty/personal-bank 60 18,09,2026/';
const checks = [
    ['server.js', ["socket.on('exams:get'", "socket.on('exams:save'", "socket.on('exams:delete'", "socket.on('exams:saveResult'", "socket.on('exams:saveAnswer'", 'function getExamsData', 'function gradeExamAnswers', 'function emitExamsUpdate', 'function sanitizeExam', 'function validateExam']],
    ['exams.js', ['window.Exams', 'downloadTemplate', 'chooseImport', 'renderDiaryBlock', 'openDiaryResults', 'CSV_COLS', 'Question']],
    ['index.html', ['id="secExams"', 'src="exams.js"', 'exams:saveResult', 'examsSaveAnswer', 'onExamsUpdate', 'onExamsResultSaved']],
    ['journal.js', ['Exams.renderDiaryBlock']]
];
let ok = true;
for (const [file, pats] of checks) {
    const src = fs.readFileSync(base + file, 'utf8');
    for (const p of pats) {
        if (!src.includes(p)) { console.error('MISSING', file, '->', p); ok = false; }
    }
}
console.log(ok ? 'ALL INTEGRATION CHECKS OK' : 'FAILED');
process.exit(ok ? 0 : 1);
