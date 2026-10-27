const fs = require('fs');
const base = 'C:/Users/狮子/qwerty/personal-bank 60 18,09,2026/';
const server = fs.readFileSync(base + 'server.js', 'utf8');
const exams = fs.readFileSync(base + 'exams.js', 'utf8');

// syntax check
try { new Function(exams); console.log('exams.js syntax OK'); } catch (e) { console.error('exams.js syntax FAIL', e.message); process.exit(1); }

// extract and test isExamVisibleToStudent
const m = server.match(/function isExamVisibleToStudent\([\s\S]*?\n\}/);
if (!m) { console.error('isExamVisibleToStudent not found'); process.exit(1); }
eval(m[0]);

const cases = [
    // draft never visible
    [{ state: 'Черновик', forAll: true }, 'u1', null, false],
    [{ state: 'Черновик', groupIds: ['g1'] }, 'u1', { id: 's1', groupId: 'g1' }, false],
    // published + forAll
    [{ state: 'Опубликован', forAll: true }, 'u1', null, true],
    [{ state: 'Открыт', forAll: true }, 'u1', null, true],
    // published + group match
    [{ state: 'Опубликован', forAll: false, groupIds: ['g1'] }, 'u1', { id: 's1', groupId: 'g1' }, true],
    [{ state: 'Опубликован', forAll: false, groupIds: ['g1'] }, 'u1', { id: 's2', groupId: 'g2' }, false],
    [{ state: 'Опубликован', forAll: false, groupIds: ['g1', 'g2'] }, 'u1', { id: 's2', groupId: 'g2' }, true],
    // published + access ids
    [{ state: 'Опубликован', forAll: false, access: ['u1'] }, 'u1', null, true],
    [{ state: 'Опубликован', forAll: false, access: ['s9'] }, 'u1', { id: 's9' }, true],
    [{ state: 'Опубликован', forAll: false, access: ['other'] }, 'u1', { id: 's1' }, false],
    // published no assignment → all
    [{ state: 'Опубликован' }, 'u1', null, true],
    [{ state: 'Опубликован', forAll: true, groupIds: [], access: [] }, 'u1', null, true],
    // empty assignment = all students (exam must not disappear)
    [{ state: 'Опубликован', forAll: false, groupIds: [], access: [] }, 'u1', null, true],
    // closed/archived not listed
    [{ state: 'Закрыт', forAll: true }, 'u1', null, false],
    [{ state: 'Архив', forAll: true }, 'u1', null, false],
    // student.userId in access
    [{ state: 'Опубликован', forAll: false, access: ['uid-9'] }, 'uid-9', { id: 's1', userId: 'uid-9' }, true],
];

let fail = 0;
for (const [e, uid, st, expect] of cases) {
    const got = isExamVisibleToStudent(e, uid, st);
    if (got !== expect) {
        console.error('FAIL', JSON.stringify(e), 'user', uid, 'st', st, 'expected', expect, 'got', got);
        fail++;
    }
}
console.log(fail ? fail + ' failures' : 'visibility tests OK (' + cases.length + ')');

// ensure sanitizeExam has groupIds/forAll
if (!server.includes('groupIds: Array.isArray(data.groupIds)')) { console.error('sanitizeExam missing groupIds'); fail++; }
if (!server.includes('forAll: data.forAll')) { console.error('sanitizeExam missing forAll'); fail++; }
if (!exams.includes('assignExam')) { console.error('exams.js missing assignExam'); fail++; }
if (!exams.includes('exForAll')) { console.error('exams.js missing forAll UI'); fail++; }
if (!exams.includes('exGroup')) { console.error('exams.js missing group UI'); fail++; }

// ensure student filters use isExamVisibleToStudent
const visUses = (server.match(/isExamVisibleToStudent\(/g) || []).length;
console.log('isExamVisibleToStudent call sites:', visUses);
if (visUses < 3) { console.error('expected definition + 2 filter uses'); fail++; }

process.exit(fail ? 1 : 0);
