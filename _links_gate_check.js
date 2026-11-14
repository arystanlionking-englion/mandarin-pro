// Быстрая проверка: прямые ссылки /my-notes/ и /ai-office/ → PIN-гейт, вход → модуль
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const ROOT = 'C:/Users/狮子/qwerty/personal-bank 81';
const BASE = 'http://127.0.0.1:3000';
const srv = spawn('node', ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
srv.stdout.on('data', d => out += d);
srv.stderr.on('data', d => out += d);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (x !== undefined ? ' :: ' + JSON.stringify(x).slice(0, 120) : '')); c ? pass++ : fail++; };

(async () => {
  try {
    // ждём сервер
    let up = false;
    for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/'); up = true; break; } catch (e) { await sleep(500); } }
    ok('server started', up);

    // 1. Без cookie — гейт
    let r = await fetch(BASE + '/my-notes/', { redirect: 'manual' });
    let t = await r.text();
    ok('/my-notes/ без cookie → 403', r.status === 403, r.status);
    ok('гейт My Notes: PIN-форма', t.includes('moduleGatePage') === false && t.includes('PIN') && t.includes('/api/my-notes/auth'));

    r = await fetch(BASE + '/ai-office/', { redirect: 'manual' });
    t = await r.text();
    ok('/ai-office/ без cookie → 403', r.status === 403, r.status);
    ok('гейт AI Office: PIN-форма', t.includes('PIN') && t.includes('/api/ai-office/auth'));

    // 2. Вход по PIN → cookie → модуль открывается
    const token = await new Promise((res, rej) => {
      const s = io(BASE, { transports: ['websocket'] });
      const to = setTimeout(() => { s.close(); rej(new Error('login timeout')); }, 8000);
      s.on('admin:authenticated', d => { clearTimeout(to); s.close(); res(d.adminToken); });
      s.on('connect', () => s.emit('admin:login', { pin: '1234' }));
    });
    ok('admin:login по PIN → token', !!token);

    let a = await fetch(BASE + '/api/my-notes/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminToken: token }) });
    const cookieNotes = (a.headers.get('set-cookie') || '').split(';')[0];
    ok('POST /api/my-notes/auth → cookie', a.status === 200 && !!cookieNotes, a.status);

    a = await fetch(BASE + '/api/ai-office/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminToken: token }) });
    const cookieOffice = (a.headers.get('set-cookie') || '').split(';')[0];
    ok('POST /api/ai-office/auth → cookie', a.status === 200 && !!cookieOffice, a.status);

    r = await fetch(BASE + '/my-notes/', { headers: { Cookie: cookieNotes } });
    t = await r.text();
    ok('/my-notes/ с cookie → 200 и модуль', r.status === 200 && t.includes('My Notes AI') && t.includes('aiInput'));

    r = await fetch(BASE + '/ai-office/', { headers: { Cookie: cookieOffice } });
    t = await r.text();
    ok('/ai-office/ с cookie → 200 и приложение', r.status === 200 && t.includes('main.js'));
    r = await fetch(BASE + '/ai-office/main.js', { headers: { Cookie: cookieOffice } });
    t = await r.text();
    ok('main.js содержит объединённый UI', r.status === 200 && t.includes('asstBarHTML') && t.includes('inferWorkflow'));

    // 3. Ассистенты доступны с cookie
    r = await fetch(BASE + '/api/assistants/state', { headers: { Cookie: cookieOffice } });
    const sd = await r.json();
    ok('/api/assistants/state → 4 ассистента', r.status === 200 && sd.assistants && sd.assistants.length === 4, sd.assistants && sd.assistants.map(a => a.id));

    console.log('--- RESULT: ' + pass + ' pass, ' + fail + ' fail ---');
  } catch (e) {
    console.error('TEST ERROR:', e.message);
    console.log('LOG TAIL:', out.split('\n').slice(-10).join('\n'));
    fail++;
  } finally {
    srv.kill();
    setTimeout(() => process.exit(fail ? 1 : 0), 400);
  }
})();
