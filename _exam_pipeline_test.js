// End-to-end-ish test of exam sanitize + validate + grade pipeline
const fs = require('fs');
const src = fs.readFileSync('C:/Users/狮子/qwerty/personal-bank 60 18,09,2026/server.js', 'utf8');

// Extract helper functions by eval in a sandbox-ish way
function grab(name) {
    const re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}', 'm');
    const m = src.match(re);
    if (!m) throw new Error('not found: ' + name);
    return m[0];
}
const code = [
    grab('genId'),
    grab('sanitizeQuestion'),
    grab('sanitizeExam'),
    grab('validateExam'),
    grab('gradeExamAnswers')
].join('\n');
const sandbox = { crypto: require('crypto'), genId: () => require('crypto').randomUUID() };
// genId in server uses crypto.randomUUID — provide it
eval(code.replace('function genId() { return crypto.randomUUID(); }', 'function genId() { return require("crypto").randomUUID(); }'));

// CSV-like import payload
const data = {
    title: 'HSK4 Урок 1',
    description: 'Тест',
    instruction: 'Ответьте на вопросы',
    minutes: 30,
    limit: 2,
    pass: 60,
    state: 'Открыт',
    questions: [
        { text: '法律', options: ['журналистика', 'право', 'характер', 'причина'], answer: 'B', points: 1 },
        { text: '俩', options: ['двое', 'один раз', 'все', 'половина'], answer: 'A', points: 1 },
        { text: '印象', options: ['привычка', 'впечатление', 'интерес', 'свадьба'], answer: 'впечатление', points: 1 },
        { text: 'Как переводится 你好?', options: ['Здравствуйте', 'Спасибо', 'До свидания', 'Пока'], answer: 'A', points: 1 }
    ]
};

const err = validateExam(data);
console.log('validate errors:', err);
if (err.length) process.exit(1);

const exam = sanitizeExam(data);
console.log('sanitized title:', exam.title, '| questions:', exam.questions.length, '| answers:', exam.questions.map(q => q.answer).join(','));

const r = gradeExamAnswers(exam, { [exam.questions[0].id]: 'B', [exam.questions[1].id]: 'A', [exam.questions[2].id]: 'B', [exam.questions[3].id]: 'A' });
console.log('score', r.score, '/', r.maxScore);
if (r.score !== 4) { console.error('expected 4'); process.exit(1); }

const r2 = gradeExamAnswers(exam, { [exam.questions[0].id]: 'A', [exam.questions[1].id]: 'B', [exam.questions[2].id]: 'C', [exam.questions[3].id]: 'D' });
console.log('wrong all score', r2.score);
if (r2.score !== 0) { console.error('expected 0'); process.exit(1); }

const r3 = gradeExamAnswers(exam, {});
console.log('empty score', r3.score, 'statuses', Object.values(r3.grades).map(g => g.status).join(','));
if (r3.score !== 0) process.exit(1);

// pass/fail
const percent = Math.round(r.score / r.maxScore * 1000) / 10;
console.log('percent', percent, percent >= 60 ? 'Сдан' : 'Не сдан');

console.log('PIPELINE OK');
