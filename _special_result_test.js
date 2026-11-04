// E2E: спецрезультаты — создание, правка, удаление, начисление/возврат баллов кошелька
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const io = require('socket.io-client');

const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'database.json');
const BAK_PATH = DB_PATH + '.spectestbak';
const PORT = 3998;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const results = [];
function ok(name, cond, extra) {
    results.push({ name, pass: !!cond });
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
}

function connect() {
    return new Promise((resolve, reject) => {
        const s = io('http://localhost:' + PORT, { transports: ['websocket'], reconnection: false });
        const to = setTimeout(() => reject(new Error('connect timeout')), 8000);
        s.on('connect', () => { clearTimeout(to); resolve(s); });
        s.on('connect_error', (e) => { clearTimeout(to); reject(e); });
    });
}
function once(s, ev, ms = 6000, pred) {
    return new Promise((resolve, reject) => {
        const to = setTimeout(() => { s.off(ev, h); reject(new Error('timeout ' + ev)); }, ms);
        function h(d) { if (pred && !pred(d)) return; clearTimeout(to); s.off(ev, h); resolve(d); }
        s.on(ev, h);
    });
}
function readDb() { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }

function minimalUser(id, name, balance) {
    return {
        id, name, balance,
        salt: null, title: null, groupId: null, isAdmin: false,
        pinHash: null, archived: false, nickname: null,
        createdAt: Date.now(), neonColor: null, nickColor: null,
        adminLevel: null, lastActive: Date.now(), profileIcon: null,
        passwordHash: null, passwordSalt: null, profileColor: null, profilePhoto: null
    };
}

async function main() {
    // --- prepare DB snapshot ---
    const backup = fs.readFileSync(DB_PATH);
    fs.writeFileSync(BAK_PATH, backup);
    const db = JSON.parse(backup.toString('utf8'));

    db.users = db.users.filter(u => u && u.id !== 'spec-user-a' && u.id !== 'spec-user-b');
    db.users.push(minimalUser('spec-user-a', 'SpecStudA', 1000));
    db.users.push(minimalUser('spec-user-b', 'SpecStudB', 500));
    if (!db.journal || typeof db.journal !== 'object') db.journal = { students: [], groups: [], records: [], attendance: [], awards: {} };
    if (!Array.isArray(db.journal.students)) db.journal.students = [];
    db.journal.students = db.journal.students.filter(s => s && s.id !== 'spec-stud-a' && s.id !== 'spec-stud-b');
    db.journal.students.push({ id: 'spec-stud-a', name: 'SpecStudA', userId: 'spec-user-a', groupId: '' });
    db.journal.students.push({ id: 'spec-stud-b', name: 'SpecStudB', userId: 'spec-user-b', groupId: '' });
    db.exams = db.exams || { exams: [], attempts: [] };
    db.exams.attempts = [];
    // regular exam to prove the usual flow still works
    db.exams.exams = [{
        id: 'spec-exam-1', title: 'Обычный экзамен', description: '', instruction: '',
        subject: 'Китайский язык', level: '', state: 'Открыт', open: '', close: '',
        minutes: 20, limit: 3, pass: 60, reveal: 'after', navigate: true,
        access: [], groupIds: [], forAll: true,
        questions: [{ id: 'spec-q-1', text: 'Вопрос?', options: ['A1', 'B1', 'C1', 'D1'], answer: 'B', points: 10, explanation: '' }]
    }];
    // fresh admin PIN so test can log in
    db.adminPinHash = null;
    db.adminSalt = null;
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

    // --- start server ---
    const cleanEnv = { ...process.env, PORT: String(PORT) };
    for (const k of ['DATABASE_URL', 'database_url', 'DB_URL', 'db_url', 'POSTGRES_URL', 'postgres_url', 'POSTGRESQL_URL', 'postgresql_url', 'SUPABASE_DB_URL', 'SUPABASE_DATABASE_URL', 'PG_CONNECTION_STRING', 'PGURI', 'PG_URI', 'DB_CONNECTION_STRING', 'DATABASE_URI']) {
        cleanEnv[k] = '';
    }
    const server = spawn('node', ['server.js'], {
        cwd: ROOT, env: cleanEnv,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', d => process.stdout.write('[srv] ' + d));
    server.stderr.on('data', d => process.stdout.write('[srv-err] ' + d));
    await sleep(1800);

    const admin = await connect();
    try {
        // --- admin login ---
        const authP = once(admin, 'admin:authenticated', 6000);
        admin.emit('admin:login', { pin: '1234' });
        await authP;
        ok('admin login', true);

        // --- create special result for student A ---
        const savedP = once(admin, 'exams:specialSaved', 6000);
        admin.emit('exams:saveSpecialResult', {
            studentId: 'spec-stud-a', title: 'Спец-экзамен',
            correctCount: 7, score: 42, maxScore: 50, status: 'Сдан', walletPoints: 100
        });
        const saved = await savedP;
        ok('create special result ok', saved.ok && saved.created === true, saved.error);
        const spId = saved.attempt && saved.attempt.id;
        ok('attempt id returned', !!spId, spId);
        ok('percent computed 84%', saved.attempt && saved.attempt.percent === 84, saved.attempt && saved.attempt.percent);
        ok('status passes through', saved.attempt && saved.attempt.status === 'Сдан');

        // --- admin general list contains it (raw attempts via exams:updated) ---
        const updP = once(admin, 'exams:updated', 6000);
        admin.emit('exams:get');
        const upd = await updP;
        const adminAtt = (upd.attempts || []).find(a => a && a.id === spId);
        ok('admin list has special result', !!adminAtt);
        ok('admin list marks isSpecial', adminAtt && adminAtt.isSpecial === true);
        ok('no fake answers/questions', adminAtt && !(adminAtt.answers && Object.keys(adminAtt.answers).length) && !(adminAtt.grades && Object.keys(adminAtt.grades).length) && !(adminAtt.examSnapshot.questions || []).length);
        ok('correctCount stored', adminAtt && adminAtt.correctCount === 7, adminAtt && adminAtt.correctCount);

        // --- student side visibility ---
        const stu = await connect();
        try {
            const loggedP = once(stu, 'user:logged_in', 6000);
            stu.emit('user:set_pin', { userId: 'spec-user-a', pin: '2222' });
            await loggedP;
            const suP = once(stu, 'exams:updated', 6000);
            stu.emit('exams:get');
            const su = await suP;
            ok('student update is not admin', su.isAdmin === false);
            const stuAtt = (su.attempts || []).find(a => a && a.id === spId);
            ok('student sees special result', !!stuAtt);
            ok('student sees isSpecial flag', stuAtt && stuAtt.isSpecial === true);
            ok('student sees walletPoints', stuAtt && stuAtt.walletPoints === 100);
            ok('student sees no questions/answers', stuAtt && !(stuAtt.examSnapshot.questions || []).length && !(stuAtt.answers && Object.keys(stuAtt.answers).length));
            ok('student does not see creditedPoints', stuAtt && stuAtt.creditedPoints === undefined);
        } finally {
            stu.close();
        }

        // --- wallet credited once ---
        await sleep(1200);
        let snap = readDb();
        let ua = snap.users.find(u => u.id === 'spec-user-a');
        ok('wallet credited +100', ua && ua.balance === 1100, ua && ua.balance);
        let rawAtt = snap.exams.attempts.find(a => a && a.id === spId);
        ok('creditedPoints recorded', rawAtt && rawAtt.creditedPoints === 100, rawAtt && rawAtt.creditedPoints);
        ok('wallet tx recorded', snap.history.some(t => t && t.type === 'exam_special_reward' && t.amount === 100));

        // --- re-save same result (idempotent, e.g. page refresh cannot re-credit) ---
        const saved2P = once(admin, 'exams:specialSaved', 6000);
        admin.emit('exams:saveSpecialResult', {
            id: spId, studentId: 'spec-stud-a', title: 'Спец-экзамен',
            correctCount: 7, score: 42, maxScore: 50, status: 'Сдан', walletPoints: 100
        });
        const saved2 = await saved2P;
        ok('re-save same id ok', saved2.ok && saved2.created === false);
        await sleep(1200);
        snap = readDb();
        ua = snap.users.find(u => u.id === 'spec-user-a');
        ok('no double-credit on re-save', ua && ua.balance === 1100, ua && ua.balance);

        // --- edit raises walletPoints 100 -> 150: only +50 delta ---
        const saved3P = once(admin, 'exams:specialSaved', 6000);
        admin.emit('exams:saveSpecialResult', {
            id: spId, studentId: 'spec-stud-a', title: 'Спец-экзамен',
            correctCount: 8, score: 45, maxScore: 50, status: 'Сдан', walletPoints: 150
        });
        const saved3 = await saved3P;
        ok('edit ok', saved3.ok);
        await sleep(1200);
        snap = readDb();
        ua = snap.users.find(u => u.id === 'spec-user-a');
        rawAtt = snap.exams.attempts.find(a => a && a.id === spId);
        ok('edit credits only delta (+50)', ua && ua.balance === 1150, ua && ua.balance);
        ok('creditedPoints updated', rawAtt && rawAtt.creditedPoints === 150, rawAtt && rawAtt.creditedPoints);

        // --- edit switching student A -> B reverses A and credits B ---
        const saved4P = once(admin, 'exams:specialSaved', 6000);
        admin.emit('exams:saveSpecialResult', {
            id: spId, studentId: 'spec-stud-b', title: 'Спец-экзамен',
            correctCount: 8, score: 45, maxScore: 50, status: 'Сдан', walletPoints: 150
        });
        const saved4 = await saved4P;
        ok('switch student ok', saved4.ok);
        await sleep(1200);
        snap = readDb();
        ua = snap.users.find(u => u.id === 'spec-user-a');
        const ub = snap.users.find(u => u.id === 'spec-user-b');
        rawAtt = snap.exams.attempts.find(a => a && a.id === spId);
        ok('old student got points back', ua && ua.balance === 1000, ua && ua.balance);
        ok('new student credited', ub && ub.balance === 650, ub && ub.balance);
        ok('creditedPoints follows new student', rawAtt && rawAtt.creditedPoints === 150 && rawAtt.userId === 'spec-user-b');

        // --- delete reverses the credit ---
        const delP = once(admin, 'exams:specialDeleted', 6000);
        admin.emit('exams:deleteSpecialResult', { id: spId });
        const del = await delP;
        ok('delete ok', del.ok && del.id === spId, del.error);
        await sleep(1200);
        snap = readDb();
        const ub2 = snap.users.find(u => u.id === 'spec-user-b');
        ok('delete reverses wallet', ub2 && ub2.balance === 500, ub2 && ub2.balance);
        ok('attempt removed from storage', !snap.exams.attempts.some(a => a && a.id === spId));

        // --- ordinary exam flow still works and cannot overwrite special ---
        const regP = once(admin, 'exams:resultSaved', 6000);
        admin.emit('exams:saveResult', {
            id: 'spec-attempt-regular', examId: 'spec-exam-1', studentId: 'spec-stud-a',
            studentName: 'SpecStudA', userId: 'spec-user-a',
            start: Date.now() - 60000, end: Date.now(), answers: { 'spec-q-1': 'B' },
            final: true
        });
        const reg = await regP;
        ok('regular saveResult still works', reg.ok === true, reg.error);
        await sleep(1200);
        snap = readDb();
        const regAtt = snap.exams.attempts.find(a => a && a.id === 'spec-attempt-regular');
        ok('regular attempt stored without isSpecial', regAtt && !regAtt.isSpecial && regAtt.status === 'Сдан' && regAtt.score === 10);

        // guard: regular submit cannot overwrite a special result
        const savedG = await (async () => {
            const p = once(admin, 'exams:specialSaved', 6000);
            admin.emit('exams:saveSpecialResult', {
                studentId: 'spec-stud-a', title: 'Охраняемый',
                correctCount: 1, score: 1, maxScore: 10, status: 'Сдан', walletPoints: 0
            });
            return p;
        })();
        const guardId = savedG.attempt && savedG.attempt.id;
        const reg2P = once(admin, 'exams:resultSaved', 6000);
        admin.emit('exams:saveResult', {
            id: guardId, examId: 'spec-exam-1', userId: 'spec-user-a', studentId: 'spec-stud-a',
            studentName: 'SpecStudA', start: Date.now(), end: Date.now(), answers: {}, final: true
        });
        const reg2 = await reg2P;
        ok('special result protected from regular overwrite', reg2.ok === false, reg2);
        await sleep(1200);
        snap = readDb();
        const guardAtt = snap.exams.attempts.find(a => a && a.id === guardId);
        ok('special attempt survived overwrite attempt', guardAtt && guardAtt.isSpecial === true);
    } finally {
        admin.close();
        server.kill();
    }

    // --- restore original DB ---
    fs.writeFileSync(DB_PATH, fs.readFileSync(BAK_PATH));
    fs.unlinkSync(BAK_PATH);

    const failed = results.filter(r => !r.pass);
    console.log('\n=== ' + (results.length - failed.length) + '/' + results.length + ' passed ===');
    if (failed.length) {
        console.log('FAILED:', failed.map(f => f.name).join(' | '));
        process.exit(1);
    }
    process.exit(0);
}

main().catch(e => {
    console.error('TEST ERROR:', e);
    try { if (fs.existsSync(BAK_PATH)) { fs.writeFileSync(DB_PATH, fs.readFileSync(BAK_PATH)); fs.unlinkSync(BAK_PATH); } } catch (e2) { }
    process.exit(1);
});
