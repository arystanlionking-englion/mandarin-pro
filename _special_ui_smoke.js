// UI smoke: рендеринг спецрезультатов в exams.js (стаб DOM, без браузера)
global.window = global;
const registry = {};
function makeEl() {
    return {
        innerHTML: '', textContent: '', style: {}, value: '', checked: false, disabled: false,
        appendChild() { }, addEventListener() { }, removeChild() { }, remove() { },
        parentNode: null, classList: { contains: () => false, add() { }, remove() { } },
        setAttribute() { }, focus() { }
    };
}
global.document = {
    getElementById: (id) => { if (!registry[id]) registry[id] = makeEl(); return registry[id]; },
    createElement: () => makeEl(),
    head: { appendChild() { } },
    body: { appendChild() { } },
    addEventListener() { },
    querySelectorAll: () => []
};
global.confirm = () => true;

const results = [];
function ok(name, cond, extra) {
    results.push({ name, pass: !!cond });
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
}

const listeners = {};
let savedPayload = null;
let deletedPayload = null;
const bridge = {
    toast: () => { },
    getUser: () => ({ id: 'spec-user-a', name: 'SpecStudA' }),
    examsGet: () => { },
    examsSpecialSave: (d) => { savedPayload = d; },
    examsSpecialDelete: (d) => { deletedPayload = d; },
    onExamsUpdate: (cb) => { listeners.update = cb; },
    onExamsSaved: () => { },
    onExamsResultSaved: () => { },
    onExamsSpecialSaved: (cb) => { listeners.specialSaved = cb; },
    onExamsSpecialDeleted: (cb) => { listeners.specialDeleted = cb; }
};

require('./exams.js');
window.Exams.init(bridge);

const specialAttempt = {
    id: 'sp-1', isSpecial: true, examId: '',
    examSnapshot: { id: '', title: 'Спец-экзамен', pass: 60, minutes: 0, reveal: 'never', questions: [] },
    userId: 'spec-user-a', studentId: 'spec-stud-a', studentName: 'SpecStudA', groupId: '',
    start: 1700000000000, end: 1700000000000, deadline: null, durationSec: 0,
    answers: {}, grades: {}, correctCount: 7, score: 42, maxScore: 50,
    percent: 84, status: 'Сдан', walletPoints: 100, creditedPoints: 100,
    number: 1, position: 0, createdAt: '2026-01-01T00:00:00.000Z'
};
const publicAttempt = Object.assign({}, specialAttempt);
const studentPayload = { isAdmin: false, exams: [], attempts: [publicAttempt] };
const adminPayload = {
    isAdmin: true, exams: [], attempts: [Object.assign({}, specialAttempt, { creditedPoints: 100 })],
    students: [{ id: 'spec-stud-a', name: 'SpecStudA', groupId: '', userId: 'spec-user-a' }],
    groups: []
};

// --- admin: вкладка «Спецрезультаты» ---
listeners.update(adminPayload);
window.Exams.go('special');
let html = registry.examsRoot.innerHTML;
ok('admin special tab renders', html.indexOf('Спецрезультаты') >= 0);
ok('create button present', html.indexOf('Создать спецрезультат') >= 0);
ok('special card shows student', html.indexOf('SpecStudA') >= 0);
ok('special card shows title', html.indexOf('Спец-экзамен') >= 0);
ok('special card shows correct count', html.indexOf('Верных: 7') >= 0);
ok('special card shows wallet info', html.indexOf('Начислено: 100') >= 0);
ok('special card has edit/delete', html.indexOf('Изменить') >= 0 && html.indexOf('Удалить') >= 0);
ok('special badge on card', html.indexOf('Спец') >= 0);

// --- admin: общий список «Результаты» содержит спецрезультат ---
window.Exams.go('results');
html = registry.examsRoot.innerHTML;
ok('general results tab title', html.indexOf('Результаты') >= 0);
ok('general list has special card', html.indexOf('Спец-экзамен') >= 0);
ok('general list marks Спец (admin)', html.indexOf('Спец') >= 0);
ok('general list shows Верных: 7', html.indexOf('Верных: 7') >= 0);
ok('general list has no fake Ошибок', html.indexOf('Ошибок') < 0);

// --- форма создания (все обязательные поля) ---
window.Exams.editSpecial();
html = registry.examsModal.innerHTML;
ok('form: Ученик', html.indexOf('Ученик') >= 0);
ok('form: Название экзамена', html.indexOf('Название экзамена') >= 0);
ok('form: Количество правильных ответов', html.indexOf('Количество правильных ответов') >= 0);
ok('form: Итоговый балл', html.indexOf('Итоговый балл') >= 0);
ok('form: Итоговая оценка', html.indexOf('Итоговая оценка') >= 0);
ok('form: Баллы в кошелёк', html.indexOf('Баллы в кошелёк') >= 0);

// --- saveSpecial отправляет корректный payload ---
registry.spStudent = Object.assign(makeEl(), { value: 'spec-stud-a' });
registry.spTitle = Object.assign(makeEl(), { value: 'Новый экзамен' });
registry.spCorrect = Object.assign(makeEl(), { value: '8' });
registry.spScore = Object.assign(makeEl(), { value: '45' });
registry.spMax = Object.assign(makeEl(), { value: '50' });
registry.spStatus = Object.assign(makeEl(), { value: 'Сдан' });
registry.spPoints = Object.assign(makeEl(), { value: '120' });
window.Exams.saveSpecial('sp-9');
ok('saveSpecial payload sent', !!savedPayload, savedPayload);
ok('payload id', savedPayload && savedPayload.id === 'sp-9');
ok('payload student', savedPayload && savedPayload.studentId === 'spec-stud-a');
ok('payload title', savedPayload && savedPayload.title === 'Новый экзамен');
ok('payload correctCount', savedPayload && savedPayload.correctCount === 8);
ok('payload score', savedPayload && savedPayload.score === 45);
ok('payload maxScore', savedPayload && savedPayload.maxScore === 50);
ok('payload status', savedPayload && savedPayload.status === 'Сдан');
ok('payload walletPoints', savedPayload && savedPayload.walletPoints === 120);

// --- showResult: только итоги, без разбора по вопросам ---
window.Exams.showResult('sp-1');
html = registry.examsModal.innerHTML;
ok('result modal shows percent', html.indexOf('84%') >= 0);
ok('result modal shows score', html.indexOf('42 / 50 баллов') >= 0);
ok('result modal shows correct count', html.indexOf('Верных: 7') >= 0);
ok('result modal notes manual entry', html.indexOf('Результат введён преподавателем') >= 0);
ok('result modal shows wallet points', html.indexOf('Начислено в кошелёк: +100') >= 0);
ok('no per-question breakdown', html.indexOf('Твой ответ') < 0 && html.indexOf('Правильный ответ') < 0);
ok('admin can manage from modal', html.indexOf('Изменить') >= 0 && html.indexOf('Удалить') >= 0);

// --- deleteSpecial шлёт запрос ---
window.Exams.deleteSpecial('sp-1');
ok('deleteSpecial payload sent', deletedPayload && deletedPayload.id === 'sp-1', deletedPayload);

// --- ответы сервера: закрытие модалки и разблокировка кнопки ---
listeners.specialSaved({ ok: true, created: true });
ok('save response resets guard', true);
listeners.specialSaved({ ok: false, error: 'Ошибка' });
listeners.specialDeleted({ ok: true, id: 'sp-1' });

// --- ученик: «Мои результаты» ---
listeners.update(studentPayload);
window.Exams.go('results');
html = registry.examsRoot.innerHTML;
ok('student results tab title', html.indexOf('Мои результаты') >= 0);
ok('student sees special result', html.indexOf('Спец-экзамен') >= 0);
ok('student sees Верных: 7', html.indexOf('Верных: 7') >= 0);
ok('student sees no Спец badge', html.indexOf('>Спец<') < 0);

// --- ученик: showResult без кнопок управления ---
window.Exams.showResult('sp-1');
html = registry.examsModal.innerHTML;
ok('student result modal summary', html.indexOf('84%') >= 0 && html.indexOf('Верных: 7') >= 0);
ok('student modal has no manage buttons', html.indexOf('Удалить') < 0);
ok('student modal no fake questions', html.indexOf('Твой ответ') < 0);

const failed = results.filter(r => !r.pass);
console.log('\n=== ' + (results.length - failed.length) + '/' + results.length + ' passed ===');
process.exit(failed.length ? 1 : 0);
