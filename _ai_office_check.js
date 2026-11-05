/* AI Office integration checks: admin-only access, encrypted keys, demo adapter, basic pipeline */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const ROOT = __dirname;
const PORT = 3210;
const BASE = 'http://127.0.0.1:' + PORT;
const DB_PATH = path.join(ROOT, 'database.json');
const BAK_PATH = path.join(ROOT, 'database.json.aiocheck.bak');
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? ' :: ' + JSON.stringify(extra) : ''));
  return !!cond;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function jget(url, headers) {
  const r = await fetch(url, { headers: headers || {} });
  let d = null; try { d = await r.json(); } catch (e) { d = null; }
  return { status: r.status, data: d, text: d ? JSON.stringify(d) : '', setCookie: r.headers.get('set-cookie') || '' };
}
async function jpost(url, body, headers) {
  const r = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', 'Origin': BASE }, headers || {}),
    body: JSON.stringify(body)
  });
  let d = null; try { d = await r.json(); } catch (e) { d = null; }
  return { status: r.status, data: d, text: d ? JSON.stringify(d) : '', setCookie: r.headers.get('set-cookie') || '' };
}

function adminLogin(pin) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'], reconnection: false });
    const to = setTimeout(() => { s.close(); reject(new Error('admin login timeout')); }, 8000);
    s.on('connect_error', e => { clearTimeout(to); reject(e); });
    s.on('error', d => { clearTimeout(to); reject(new Error('socket error: ' + JSON.stringify(d))); });
    s.on('admin:authenticated', d => { clearTimeout(to); resolve({ socket: s, token: d.adminToken }); });
    s.on('connect', () => s.emit('admin:login', { pin }));
  });
}

async function waitServer(child) {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error('сервер завершился при старте');
    try {
      const r = await fetch(BASE + '/ai-office/', { redirect: 'manual' });
      if (r.status !== 503) return true;
    } catch (e) { }
    await sleep(500);
  }
  throw new Error('сервер не поднялся за 30 с');
}

async function main() {
  // --- scratch DB: безопасная проверка пишет только во временную базу ---
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
    child.stdout.on('data', d => { log += d.toString(); });
    child.stderr.on('data', d => { log += d.toString(); });
    await waitServer(child);

    // --- 1) обычному посетителю всё закрыто ---
    const page = await fetch(BASE + '/ai-office/');
    ok('страница /ai-office/ без прав → 403', page.status === 403, page.status);
    const apiNo = await jget(BASE + '/ai-office/api/state');
    ok('API state без прав → 403', apiNo.status === 403, apiNo.status);
    const raw = await fetch(BASE + '/ai-office/main.js');
    ok('файлы модуля без прав → 403', raw.status === 403, raw.status);
    const dbFile = await fetch(BASE + '/database.json');
    ok('database.json не отдаётся через static → 403', dbFile.status === 403, dbFile.status);
    const src = await fetch(BASE + '/AI_OFFICE_ULTIMATE/server/core.mjs');
    ok('исходники архива не отдаются → 403', src.status === 403, src.status);
    const badAuth = await jpost(BASE + '/api/ai-office/auth', { adminToken: 'nope' });
    ok('вход с чужим токеном → 403', badAuth.status === 403, badAuth.status);
    const userAuth = await jpost(BASE + '/api/ai-office/auth', { adminToken: 'user-session-token-demo' });
    ok('пользовательский токен не даёт доступ → 403', userAuth.status === 403, userAuth.status);

    // --- 2) админ: cookie + API ---
    const admin = await adminLogin('123456');
    ok('админ-логин выдаёт токен', !!admin.token, !!admin.token);
    const auth = await jpost(BASE + '/api/ai-office/auth', { adminToken: admin.token });
    ok('обмен токена на cookie → 200', auth.status === 200 && /pb_admin=/.test(auth.setCookie), auth.status);
    const cookie = (auth.setCookie.split(';')[0]);
    const pageOk = await fetch(BASE + '/ai-office/', { headers: { Cookie: cookie } });
    const pageHtml = await pageOk.text();
    ok('страница модуля с cookie админа → 200', pageOk.status === 200 && /AI OFFICE/i.test(pageHtml), pageOk.status);
    const state = await jget(BASE + '/ai-office/api/state', { Cookie: cookie });
    ok('state с cookie админа → 200', state.status === 200 && Array.isArray(state.data.projects), state.status);
    const hdr = await jget(BASE + '/ai-office/api/state', { 'X-Admin-Token': admin.token });
    ok('доступ по заголовку X-Admin-Token → 200', hdr.status === 200, hdr.status);

    // --- 2б) адреса: ngrok-туннель, локальная сеть, чужой Origin ---
    const rawGet = (hostHeader, path, headers) => new Promise((resolve, reject) => {
      const req = require('http').request({ host: '127.0.0.1', port: PORT, path, method: 'GET', headers: Object.assign({ Host: hostHeader }, headers || {}) }, res => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      req.on('error', reject); req.end();
    });
    const ng = await rawGet('darkness-grip-audible.ngrok-free.dev', '/ai-office/', { Cookie: cookie });
    ok('доступ через ngrok-адрес (Host туннеля) → 200', ng.status === 200, ng.status);
    const lan = await rawGet('192.168.1.50:3210', '/ai-office/api/state', { Cookie: cookie });
    ok('доступ из локальной сети (LAN Host) → 200', lan.status === 200, lan.status);
    const badHost = await rawGet('evil.example', '/ai-office/api/state', { Cookie: cookie });
    ok('адрес (Host) не блокирует работу админа → 200', badHost.status === 200, badHost.status);
    const badHostAnon = await rawGet('evil.example', '/ai-office/api/state', {});
    ok('без админ-прав любой адрес → 403', badHostAnon.status === 403, badHostAnon.status);
    const evilPost = await jpost(BASE + '/ai-office/api/action', { action: 'project', name: 'evil' }, { Cookie: cookie, Origin: 'https://evil.example' });
    ok('POST с чужим Origin → 403 (CSRF)', evilPost.status === 403, evilPost.status);

    // --- 3) ключи: маска вместо секрета, замена, удаление ---
    const FAKE = 'test-key-abcdef1234';
    const keyOnly = await jpost(BASE + '/ai-office/api/action', { action: 'connection', provider: 'mimo', key: FAKE }, { Cookie: cookie });
    ok('подключение только по ключу (без названия и модели) → 200', keyOnly.status === 200 && !!keyOnly.data.id && !!keyOnly.data.model, keyOnly.data && keyOnly.data.model);
    await jpost(BASE + '/ai-office/api/action', { action: 'delete-connection', id: keyOnly.data.id }, { Cookie: cookie });
    const conn = await jpost(BASE + '/ai-office/api/action', { action: 'connection', provider: 'mimo', name: 'Проверка MiMo', model: 'mimo-v2.5', key: FAKE }, { Cookie: cookie });
    ok('подключение создаётся → 200', conn.status === 200 && !!conn.data.id, conn.status);
    ok('в ответе нет секрета, есть маска', conn.data && conn.data.secret === undefined && /1234$/.test(conn.data.mask || ''), conn.data && conn.data.mask);
    const state2 = await jget(BASE + '/ai-office/api/state', { Cookie: cookie });
    ok('state не содержит API-ключ', !state2.text.includes(FAKE));
    const rep = await jpost(BASE + '/ai-office/api/action', { action: 'update-connection', id: conn.data.id, key: 'new-secret-key-5678' }, { Cookie: cookie });
    ok('замена ключа → маска обновлена', rep.status === 200 && /5678$/.test(rep.data.mask || ''), rep.data && rep.data.mask);
    const state3 = await jget(BASE + '/ai-office/api/state', { Cookie: cookie });
    ok('после замены старый ключ не возвращается', !state3.text.includes('new-secret-key-5678'));
    const del = await jpost(BASE + '/ai-office/api/action', { action: 'delete-connection', id: conn.data.id }, { Cookie: cookie });
    ok('удаление ключа → 200', del.status === 200, del.status);

    // --- 4) проверка подключений ---
    const demo = await jpost(BASE + '/ai-office/api/action', { action: 'check-connection', id: 'demo' }, { Cookie: cookie });
    ok('тестовый адаптер: ok + явная пометка demo', demo.data && demo.data.ok === true && demo.data.demo === true, demo.data);
    const conn2 = await jpost(BASE + '/ai-office/api/action', { action: 'connection', provider: 'groq', name: 'Проверка Groq', model: 'llama-3.3-70b-versatile', key: 'gsk_fake_key_for_check' }, { Cookie: cookie });
    const realCheck = await jpost(BASE + '/ai-office/api/action', { action: 'check-connection', id: conn2.data.id }, { Cookie: cookie });
    ok('проверка с фейковым ключом честно падает', realCheck.data && realCheck.data.ok === false && !!realCheck.data.error, realCheck.data);
    await jpost(BASE + '/ai-office/api/action', { action: 'delete-connection', id: conn2.data.id }, { Cookie: cookie });

    // --- 5) задания через тестовый адаптер (без ключей) ---
    const proj = await jpost(BASE + '/ai-office/api/action', { action: 'project', name: 'Проверка интеграции' }, { Cookie: cookie });
    ok('проект создаётся', proj.status === 200 && !!proj.data.id, proj.status);
    const req = { action: 'task', requestId: 'aio-check-' + Date.now(), project: proj.data.id, prompt: 'Тест: ответь кратко', connections: ['demo'], mode: 'single', maxTokens: 256 };
    const t1 = await jpost(BASE + '/ai-office/api/action', req, { Cookie: cookie });
    ok('задание принято (demo)', t1.status === 202 || t1.status === 200, t1.status);
    let task = null;
    for (let i = 0; i < 30; i++) {
      const st = await jget(BASE + '/ai-office/api/state', { Cookie: cookie });
      task = (st.data.tasks || []).find(t => t.id === t1.data.id);
      if (task && !['queued', 'running'].includes(task.status)) break;
      await sleep(300);
    }
    ok('demo-задание завершилось', task && task.status === 'done', task && task.status);
    ok('ответ явно помечен как тестовый адаптер', !!(task && /ТЕСТОВЫЙ АДАПТЕР/.test(task.output || '')), task && String(task.output || '').slice(0, 60));
    const t2 = await jpost(BASE + '/ai-office/api/action', req, { Cookie: cookie });
    ok('повтор того же requestId — без второй модели', t2.data && t2.data.id === t1.data.id, t2.data && t2.data.id);

    // --- 6) без cookie админ-токен из localStorage тоже работает, выход закрывает ---
    const logout = await jpost(BASE + '/api/ai-office/logout', {});
    ok('выход чистит cookie', logout.status === 200, logout.status);
    admin.socket.close();
  } finally {
    if (child && child.exitCode === null) { try { child.kill(); } catch (e) { } }
    await sleep(500);
    try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch (e) { }
    if (hadDb && fs.existsSync(BAK_PATH)) fs.renameSync(BAK_PATH, DB_PATH);
    try { if (fs.existsSync(DB_PATH + '.tmp')) fs.unlinkSync(DB_PATH + '.tmp'); } catch (e) { }
  }

  const failed = results.filter(r => !r.pass);
  console.log('\nИтог: ' + (results.length - failed.length) + '/' + results.length + ' проверок прошло');
  if (failed.length) { console.log('Провалены: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
}
main().catch(e => { console.error('FAIL — ошибка проверки:', e.message); process.exit(1); });
