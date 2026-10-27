// Smoke test for exam grading + CSV parse logic
function gradeExamAnswers(exam, answers) {
    const grades = {};
    let score = 0;
    let maxScore = 0;
    for (const q of (exam.questions || [])) {
        const pts = Number(q.points) > 0 ? Number(q.points) : 1;
        maxScore += pts;
        const v = answers ? answers[q.id] : undefined;
        const raw = Array.isArray(v) ? (v[0] || '') : (v == null ? '' : v);
        const letter = String(raw).trim().toUpperCase();
        const opts = (q.options || []).map(o => String(o || '').trim());
        const letterIdx = /^[A-D]$/.test(letter) ? letter.charCodeAt(0) - 65 : -1;
        const selectedText = letterIdx >= 0 ? (opts[letterIdx] || '') : String(raw).trim();

        const ansRaw = String(q.answer || '').trim();
        let correctLetter = '';
        let correctText = '';
        if (/^[A-Da-d]$/.test(ansRaw)) {
            correctLetter = ansRaw.toUpperCase();
            const ci = correctLetter.charCodeAt(0) - 65;
            correctText = opts[ci] || '';
        } else {
            const m = ansRaw.match(/^([A-Da-d])[.)]\s*(.*)$/);
            if (m) {
                correctLetter = m[1].toUpperCase();
                const ci = correctLetter.charCodeAt(0) - 65;
                correctText = opts[ci] || m[2] || '';
            } else {
                const ix = opts.findIndex(o => o === ansRaw);
                correctLetter = ix >= 0 ? 'ABCD'.charAt(ix) : '';
                correctText = ix >= 0 ? opts[ix] : ansRaw;
            }
        }

        let ok = false;
        if (letter && correctLetter && letter === correctLetter) ok = true;
        else if (selectedText && correctText && selectedText === correctText) ok = true;
        else if (selectedText && ansRaw && selectedText === ansRaw) ok = true;

        if (!letter && !selectedText) {
            grades[q.id] = { score: 0, status: 'Пропущено', answer: '', answerText: '', correct: correctText || correctLetter };
        } else {
            grades[q.id] = {
                score: ok ? pts : 0,
                status: ok ? 'Правильно' : 'Неправильно',
                answer: letter || selectedText,
                answerText: selectedText || letter,
                correct: correctText || correctLetter
            };
            if (ok) score += pts;
        }
    }
    return { grades, score, maxScore };
}

const exam = {
    questions: [
        { id: 'q1', text: '法律', options: ['журналистика', 'право', 'характер', 'причина'], answer: 'B', points: 1 },
        { id: 'q2', text: '俩', options: ['двое', 'один раз', 'все', 'половина'], answer: 'A', points: 1 },
        { id: 'q3', text: '印象', options: ['привычка', 'впечатление', 'интерес', 'свадьба'], answer: 'впечатление', points: 2 },
        { id: 'q4', text: '你好?', options: ['Здравствуйте', 'Спасибо', 'До свидания', 'Пока'], answer: 'A', points: 1 }
    ]
};

let r = gradeExamAnswers(exam, { q1: 'B', q2: 'C', q3: 'B', q4: 'A' });
console.log('test1', r.score, r.maxScore, r.grades.q1.status, r.grades.q2.status, r.grades.q3.status, r.grades.q4.status);
console.assert(r.score === 4 && r.maxScore === 5, 'score should be 4/5');
console.assert(r.grades.q1.status === 'Правильно', 'q1 correct');
console.assert(r.grades.q2.status === 'Неправильно', 'q2 wrong');
console.assert(r.grades.q3.status === 'Правильно', 'q3 correct by text answer');
console.assert(r.grades.q4.status === 'Правильно', 'q4 correct');

r = gradeExamAnswers(exam, {});
console.log('test2 empty', r.score, r.grades.q1.status);
console.assert(r.score === 0 && r.grades.q1.status === 'Пропущено', 'empty = skipped');

// percent + pass
const percent = Math.round(r.score / r.maxScore * 1000) / 10;
const status = percent >= 60 ? 'Сдан' : 'Не сдан';
console.log('test3', percent, status);
console.assert(status === 'Не сдан', 'fail on 0%');

console.log('ALL OK');
