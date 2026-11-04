// E2E: student submits finished exam -> must persist to database.json
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const io = require('socket.io-client');

const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'database.json');
const PORT = 3999;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    const backup = fs.readFileSync(DB_PATH);
    fs.writeFileSync(DB_PATH + '.e2ebak', backup);
    const db = JSON.parse(backup.toString('utf8'));

    // seed a published exam
    const examId = 'e2e-exam-1';
    const qid = 'e2e-q-1';
    db.exams = db.exams || { exams: [], attempts: [] };
    db.exams.exams = [{
        id: examId,
        title: 'E2E Тест',
        description: '', instruction: '',
        subject: 'Китайский язык', level: '', state: 'Открыт',
        open: '', close: '', minutes: 20, limit: 3, pass: 60,
        reveal: 'after', navigate: true, access: [], groupIds: [], forAll: true,
        questions: [
            { id: qid, text: '法律 ?', options: ['журналистика', 'право', 'характер', 'причина'], answer: 'B', points: 1, explanation: 'право = law' }
        ]
    }];
    db.exams.attempts = [];
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

    // start server
    const server = spawn('node', ['server.js'], {
        cwd: ROOT, env: { ...process.env, PORT: String(PORT) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', d => process.stdout.write('[srv] ' + d));
    server.stderr.on('data', d => process.stdout.write('[srv-err] ' + d));
    await sleep(1500);

    const socket = io('http://localhost:' + PORT, { transports: ['websocket'] });
    const waitEvent = (ev, timeout = 5000) => new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout waiting ' + ev)), timeout);
        socket.once(ev, d => { clearTimeout(t); res(d); });
    });

    try {
        await waitEvent('connect');
        // pick a creds-less user and set pin
        const user = db.users.find(u => !u.pinHash && !u.passwordHash);
        if (!user) throw new Error('no creds-less user for test');
        socket.emit('user:set_pin', { userId: user.id, pin: '1234' });
        const logged = await waitEvent('user:logged_in');
        console.log('logged in as', logged.user && logged.user.name, logged.user && logged.user.id);

        socket.emit('exams:get');
        const upd = await waitEvent('exams:updated');
        console.log('exams:updated isAdmin=', upd.isAdmin, 'exams=', (upd.exams || []).length, 'attempts=', (upd.attempts || []).length);

        // start in-progress attempt
        const attemptId = 'e2e-attempt-1';
        const start = Date.now();
        socket.emit('exams:saveResult', {
            id: attemptId, examId, start, deadline: start + 20 * 60000,
            answers: {}, status: 'В процессе', final: false, number: 1, studentName: user.name
        });
        const reg = await waitEvent('exams:resultSaved');
        console.log('in-progress saved ok=', reg.ok, 'status=', reg.attempt && reg.attempt.status, 'userId=', reg.attempt && reg.attempt.userId);

        // save an answer
        socket.emit('exams:saveAnswer', { attemptId, examId, answers: { [qid]: 'B' }, position: 0, start, deadline: start + 20 * 60000 });

        // finish
        socket.emit('exams:saveResult', {
            id: attemptId, examId, start, end: Date.now(), deadline: start + 20 * 60000,
            answers: { [qid]: 'B' }, status: 'Завершён', final: true, number: 1,
            studentName: user.name, userId: user.id
        });
        const fin = await waitEvent('exams:resultSaved');
        console.log('final saved ok=', fin.ok);
        console.log('final attempt:', JSON.stringify({
            id: fin.attempt && fin.attempt.id,
            status: fin.attempt && fin.attempt.status,
            score: fin.attempt && fin.attempt.score,
            maxScore: fin.attempt && fin.attempt.maxScore,
            percent: fin.attempt && fin.attempt.percent,
            userId: fin.attempt && fin.attempt.userId,
            studentName: fin.attempt && fin.attempt.studentName,
            grades: fin.attempt && fin.attempt.grades
        }, null, 2));

        await sleep(900); // allow debounced save
        const after = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        const att = (after.exams && after.exams.attempts || []).find(a => a.id === attemptId);
        console.log('DB persisted attempt:', att ? {
            id: att.id, status: att.status, score: att.score, percent: att.percent,
            userId: att.userId, hasGrades: !!(att.grades && Object.keys(att.grades).length)
        } : null);
        if (!att) throw new Error('ATTEMPT NOT PERSISTED');
        if (att.status !== 'Сдан') throw new Error('BAD STATUS ' + att.status);
        if (!att.grades || !att.grades[qid]) throw new Error('NO GRADES PERSISTED');

        // --- restart survival: exams/results must NOT be wiped by a server restart ---
        socket.close();
        server.kill();
        await sleep(400);
        const server2 = spawn('node', ['server.js'], {
            cwd: ROOT, env: { ...process.env, PORT: String(PORT) },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        await sleep(1500);
        const socket2 = io('http://localhost:' + PORT, { transports: ['websocket'] });
        const wait2 = (ev, timeout = 5000) => new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error('timeout waiting ' + ev)), timeout);
            socket2.once(ev, d => { clearTimeout(t); res(d); });
        });
        await wait2('connect');
        socket2.emit('user:login_with_pin', { userId: user.id, pin: '1234' });
        await wait2('user:logged_in'); // login triggers saveDB
        await sleep(900);
        socket2.emit('exams:get');
        const upd2 = await wait2('exams:updated');
        const att2 = (upd2.attempts || []).find(a => a.id === attemptId);
        console.log('after restart: exams=', (upd2.exams || []).length, 'attempt visible=', !!att2,
            'userId=', att2 && att2.userId, 'studentName=', att2 && att2.studentName, 'status=', att2 && att2.status);
        socket2.close();
        server2.kill();
        if (!(upd2.exams || []).length) throw new Error('EXAMS LOST AFTER RESTART');
        if (!att2) throw new Error('ATTEMPT LOST AFTER RESTART');
        if (att2.status !== 'Сдан') throw new Error('BAD STATUS AFTER RESTART ' + att2.status);
        if (att2.userId !== user.id) throw new Error('userId MISSING IN STUDENT PAYLOAD');
        const after2 = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        if (!(after2.exams && after2.exams.attempts || []).find(a => a.id === attemptId)) throw new Error('DB WIPED AFTER RESTART SAVE');
        console.log('E2E SAVE: PASS');
    } catch (e) {
        console.error('E2E SAVE: FAIL —', e.message);
        process.exitCode = 1;
    } finally {
        socket.close();
        server.kill();
        // restore db
        fs.writeFileSync(DB_PATH, fs.readFileSync(DB_PATH + '.e2ebak'));
        fs.unlinkSync(DB_PATH + '.e2ebak');
    }
}
main();
