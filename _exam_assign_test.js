const fs = require('fs');
const base = 'C:/Users/狮子/qwerty/personal-bank 60 18,09,2026/';
const server = fs.readFileSync(base + 'server.js', 'utf8');

function grab(name) {
    const re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}', 'm');
    const m = server.match(re);
    if (!m) throw new Error('not found: ' + name);
    return m[0];
}

const code = [
    grab('sanitizeQuestion'),
    grab('sanitizeExam'),
    grab('isExamVisibleToStudent')
].join('\n');
eval('function genId(){return "x"}\n' + code);

const student = { id: 's_mvmdaj62', userId: '0e8d610f-e912-4eff-ae2e-a4858a067ec1', groupId: 'g_mvmdaj62' };

// BUG REGRESSION: access with empty strings used to hide exam from everyone
const exam1 = sanitizeExam({
    title: 'T', state: 'Опубликован', minutes: 10, limit: 1, pass: 50,
    access: ['', null], groupIds: [], forAll: true,
    questions: [{ text: 'q', options: ['a', 'b'], answer: 'A' }]
});
if (exam1.access.length !== 0) { console.error('empty access not cleaned', exam1.access); process.exit(1); }
if (!isExamVisibleToStudent(exam1, student.userId, student)) { console.error('published+forAll not visible'); process.exit(1); }

// draft not visible
const exam2 = sanitizeExam({ title: 'T', state: 'Черновик', minutes: 10, limit: 1, pass: 50, forAll: true, questions: [{ text: 'q', options: ['a', 'b'], answer: 'A' }] });
if (isExamVisibleToStudent(exam2, student.userId, student)) { console.error('draft visible'); process.exit(1); }

// group assignment
const exam3 = sanitizeExam({
    title: 'T', state: 'Опубликован', minutes: 10, limit: 1, pass: 50,
    forAll: false, groupIds: ['g_mvmdaj62', ''],
    questions: [{ text: 'q', options: ['a', 'b'], answer: 'A' }]
});
if (exam3.groupIds.length !== 1) { console.error('groupIds not cleaned', exam3.groupIds); process.exit(1); }
if (!isExamVisibleToStudent(exam3, student.userId, student)) { console.error('group member should see'); process.exit(1); }
if (isExamVisibleToStudent(exam3, 'other-user', { id: 's2', groupId: 'g_other' })) { console.error('other group should NOT see'); process.exit(1); }

// multi-group
const exam4 = sanitizeExam({
    title: 'T', state: 'Опубликован', minutes: 10, limit: 1, pass: 50,
    forAll: false, groupIds: ['g_a', 'g_b'],
    questions: [{ text: 'q', options: ['a', 'b'], answer: 'A' }]
});
if (!isExamVisibleToStudent(exam4, 'u', { id: 's', groupId: 'g_b' })) { console.error('g_b should see'); process.exit(1); }

console.log('assignment/publish regression OK');
