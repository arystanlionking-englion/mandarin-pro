/* Живая проверка ИИ-ассистентов внутри server.js: scratch-БД, реальный админ-логин, API без провайдера. */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const ROOT = __dirname;
const PORT = 3211;
const BASE = 'http://127.0.0.1:' + PORT;
const DB_PATH = path.join(ROOT, 'database.json');
const BAK_PATH = path.join(ROOT, 'database.json.asstcheck.bak');
let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; console.log('PASS — ' + name); }
    else { failed++; console.log('FAIL — ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function j(method, url, body, headers) {
    return fetch(url, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
        body: body ? JSON.stringify(body) : undefined
    }).then(async r => {
        let d = null; try { d = await r.json(); } catch (e) { d = null; }
        return { status: r.status, data: d };
    });
}

function adminLogin(pin) {
    return new Promise((resolve, reject) => {
        const s = io(BASE, { transports: ['websocket'], reconnection: false });
        const to = setTimeout(() => { s.close(); reject(new Error('admin login timeout')); }, 8000);
        s.on('connect_error', e => { clearTimeout(to); reject(e); });
        s.on('admin:authenticated', d => { clearTimeout(to); resolve({ socket: s, token: d.adminToken }); });
        s.on('connect', () => s.emit('admin:login', { pin }));
    });
}

async function waitServer(child) {
    for (let i = 0; i < 60; i++) {
        if (child.exitCode !== null) throw new Error('сервер завершился при старте');
        try { const r = await fetch(BASE + '/'); if (r.status < 500) return true; } catch (e) { }
        await sleep(500);
    }
    throw new Error('сервер не поднялся за 30 с');
}

(async () => {
    const hadDb = fs.existsSync(DB_PATH);
    if (hadDb) fs.renameSync(DB_PATH, BAK_PATH);
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [] }), 'utf8');
    let child = null;
    try {
        child = spawn(process.execPath, ['server.js'], {
            cwd: ROOT,
            env: Object.assign({}, process.env, { PORT: String(PORT) }),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let log = '';
        child.stdout.on('data', d => log += d.toString());
        child.stderr.on('data', d => log += d.toString());
        await waitServer(child);
        console.log('— ИИ-ассистенты: живая проверка —');

        // 1) анонимно всё закрыто
        let r = await j('GET', BASE + '/api/assistants/state');
        ok('GET /state анонимно → 403', r.status === 403, r.status);
        r = await j('POST', BASE + '/api/assistants/chat', { id: 'admin', message: 'x' });
        ok('POST /chat анонимно → 403', r.status === 403, r.status);

        // 2) админ: socket-логин → токен работает
        const admin = await adminLogin('123456');
        ok('админ-логин выдаёт токен', !!admin.token, !!admin.token);
        const H = { 'X-Admin-Token': admin.token };
        r = await j('GET', BASE + '/api/assistants/state', null, H);
        ok('GET /state c админ-токеном → 200', r.status === 200 && r.data.ok, r.status);
        ok('в state ровно 4 ассистента', r.data.assistants && r.data.assistants.length === 4, r.data.assistants && r.data.assistants.length);
        ok('id ассистентов admin/method/finance/writer', JSON.stringify(r.data.assistants.map(a => a.id)) === '["admin","method","finance","writer"]', r.data.assistants.map(a => a.id));

        // 3) конфиг: ключ не утекает, маска есть
        r = await j('POST', BASE + '/api/assistants/config', { id: 'admin', provider: 'dify', baseUrl: 'https://api.dify.ai/v1', apiKey: 'sk-live-secret-abcdef', system: 'Тест' }, H);
        ok('POST /config → 200', r.status === 200 && r.data.ok, r.status);
        ok('hasKey=true, keyMask без полного ключа', r.data.assistant.hasKey === true && r.data.assistant.keyMask.indexOf('sk-live-secret-abcdef') === -1, r.data.assistant);
        r = await j('GET', BASE + '/api/assistants/state', null, H);
        const raw = JSON.stringify(r.data);
        ok('state не содержит полного ключа', raw.indexOf('sk-live-secret-abcdef') === -1);

        // 4) сохранение переживает рестарт (scratch-файл, saveDB с дебаунсом — ждём флеш)
        let flushed = false;
        for (let i = 0; i < 20; i++) {
            if (fs.existsSync(DB_PATH) && fs.readFileSync(DB_PATH, 'utf8').indexOf('sk-live-secret-abcdef') !== -1) { flushed = true; break; }
            await sleep(500);
        }
        ok('ключ записан в database.json (после дебаунса)', flushed);

        // 5) chat без ключа у другого ассистента → понятная 400
        r = await j('POST', BASE + '/api/assistants/chat', { id: 'method', message: 'привет' }, H);
        ok('chat без ключа → 400 про ключ', r.status === 400 && /ключ/i.test((r.data && r.data.error) || ''), r.data);

        // 6) clear и чужой id
        r = await j('POST', BASE + '/api/assistants/clear', { id: 'admin' }, H);
        ok('POST /clear → 200', r.status === 200, r.status);
        r = await j('POST', BASE + '/api/assistants/chat', { id: 'nope', message: 'x' }, H);
        ok('POST /chat с чужим id → 404', r.status === 404, r.status);

        // 7) страница админки видит оверлей ассистентов
        const page = await fetch(BASE + '/').then(x => x.text());
        ok('index.html содержит оверлей asstOverlay', page.indexOf('id="asstOverlay"') !== -1);
        ok('index.html содержит кнопку openAssistants', page.indexOf('openAssistants()') !== -1);

        console.log('\nИтог: ' + passed + ' OK, ' + failed + ' FAIL');
    } finally {
        if (child && child.exitCode === null) { try { child.kill('SIGKILL'); } catch (e) { } await sleep(400); }
        try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch (e) { }
        if (hadDb) { try { fs.renameSync(BAK_PATH, DB_PATH); } catch (e) { } }
    }
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
