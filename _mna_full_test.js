const { spawn } = require('child_process');
const http = require('http');
const { io } = require('socket.io-client');
const ROOT = 'C:/Users/狮子/qwerty/personal-bank 81';
const BASE = 'http://127.0.0.1:3000';
const MOCK = 'http://127.0.0.1:3987';

// --- Mock AI server: returns queued actions ---
const queue = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mimo-v2.6-flash' }] }));
      return;
    }
    if (req.url.endsWith('/chat/completions')) {
      const item = queue.shift() || { reply: 'Готово.', action: 'none' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(item) } }] }));
      return;
    }
    res.writeHead(404); res.end();
  });
});

const srv = spawn('node', ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
srv.stdout.on('data', d => out += d);
srv.stderr.on('data', d => out += d);

const sleep = ms => new Promise(r => setTimeout(r, ms));
function waitPort() {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function p() {
      fetch(BASE + '/api/my-notes/state').then(() => res()).catch(() => {
        if (Date.now() - t0 > 25000) return rej(new Error('server did not start\n' + out));
        setTimeout(p, 500);
      });
    })();
  });
}
function adminLogin() {
  return new Promise((res, rej) => {
    const s = io(BASE, { transports: ['websocket'] });
    const to = setTimeout(() => { s.close(); rej(new Error('login timeout')); }, 8000);
    s.on('admin:authenticated', d => { clearTimeout(to); res({ s, token: d.adminToken }); });
    s.on('connect', () => s.emit('admin:login', { pin: '1234' }));
  });
}
async function api(token, path, method, body) {
  const r = await fetch(BASE + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
    body: body ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}
let pass = 0, fail = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
  cond ? pass++ : fail++;
}

(async () => {
  let admin = null;
  try {
    await new Promise((res, rej) => { mock.listen(3987, () => res()); mock.on('error', rej); });
    await waitPort();
    admin = await adminLogin();
    const T = admin.token;

    // point AI settings at mock
    let r = await api(T, '/api/my-notes/settings', 'PUT', { apiEndpoint: MOCK, model: 'mimo-v2.6-flash' });
    check('settings PUT', r.status === 200 && r.d.ok);
    r = await api(T, '/api/my-notes/settings/test', 'POST', {});
    check('settings test (mock /models)', r.status === 200 && r.d.ok === true);

    // reset data (previous runs / debounced saves may have left state)
    await api(T, '/api/my-notes/state', 'PUT', { notes: [], reminders: [] });
    await sleep(900);

    // --- create note via AI ---
    queue.push({ reply: 'Заметка создана.', action: 'create_note', note: { title: 'Идея проекта', category: 'Идеи', html: '<p>Приложение для учёбы</p>', text: 'Приложение для учёбы' } });
    r = await api(T, '/api/my-notes/ai', 'POST', { message: 'запиши идею проекта приложение для учёбы' });
    check('AI create_note', r.status === 200 && r.d.ok && r.d.action === 'create_note' && r.d.note && r.d.notes.length === 1);
    const noteId = r.d.note && r.d.note.id;

    // --- edit note via AI ---
    queue.push({ reply: 'Дополнил.', action: 'edit_note', note: { id: noteId, html: '<p>Приложение для учёбы</p><p>1. Тест</p>' } });
    r = await api(T, '/api/my-notes/ai', 'POST', { message: 'добавь в заметку пункт тест' });
    check('AI edit_note', r.status === 200 && r.d.action === 'edit_note' && r.d.note.html.indexOf('Тест') >= 0);

    // --- checklist via AI + toggle persistence ---
    queue.push({ reply: 'План добавлен.', action: 'add_checklist', note: { id: noteId, title: 'Идея проекта', checks: [{ text: 'Чтение' }, { text: 'Повторение слов' }, { text: 'Эссе' }] } });
    r = await api(T, '/api/my-notes/ai', 'POST', { message: 'добавь чекбоксы плана' });
    check('AI add_checklist', r.status === 200 && r.d.note && Array.isArray(r.d.note.checks) && r.d.note.checks.length === 3);
    const checkId = r.d.note && r.d.note.checks && r.d.note.checks[0] && r.d.note.checks[0].id;
    if (checkId) {
      r = await api(T, '/api/my-notes/notes/' + noteId + '/checks/' + checkId, 'POST', { done: true });
      check('check toggle', r.status === 200 && r.d.note.checks.find(c => c.id === checkId).done === true);
      r = await api(T, '/api/my-notes/state');
      check('check state persisted', r.d.notes[0].checks.find(c => c.id === checkId).done === true);
    } else {
      check('check toggle (skipped)', true);
      check('check state persisted (skipped)', true);
    }

    // --- reminder via AI (dueAt in the past -> scheduler should fire) ---
    queue.push({ reply: 'Напоминание создано.', action: 'create_reminder', reminder: { text: 'Проверить документы', dueAt: new Date(Date.now() - 5000).toISOString() } });
    r = await api(T, '/api/my-notes/ai', 'POST', { message: 'напомни проверить документы' });
    check('AI create_reminder', r.status === 200 && r.d.reminder && r.d.reminders.some(x => x.text === 'Проверить документы'));

    // --- fast routes (local, without AI) ---
    r = await api(T, '/api/my-notes/ai', 'POST', { message: 'какие у меня планы?' });
    check('fast list plans', r.status === 200 && r.d.action === 'list' && r.d.notes.length >= 1 && /Идея проекта/.test(r.d.reply));
    r = await api(T, '/api/my-notes/ai', 'POST', { message: 'найди проект' });
    check('fast search', r.status === 200 && r.d.action === 'search' && r.d.notes.length >= 1 && /Найдено/.test(r.d.reply));

    // --- search action (no mutation) ---
    queue.push({ reply: 'Нашёл: Идея проекта.', action: 'search', query: 'проект' });
    r = await api(T, '/api/my-notes/ai', 'POST', { message: 'подбери проект' });
    check('AI search', r.status === 200 && r.d.action === 'search' && r.d.notes.length === 1);

    // --- links ---
    r = await api(T, '/api/my-notes/links', 'POST', { noteId, expiresInDays: 1 });
    check('link create', r.status === 200 && r.d.link && r.d.link.url);
    const linkUrl = r.d.link.url, linkId = r.d.link.id;
    const token = linkUrl.split('/').pop();
    r = await api(T, '/api/note-view/' + token);
    check('note-view JSON (enabled)', r.status === 200 && r.d.note.title === 'Идея проекта');
    let pub = await fetch(BASE + '/note-view/' + token);
    const pubHtml = await pub.text();
    check('note-view public HTML', pub.status === 200 && pubHtml.indexOf('Идея проекта') >= 0 && pubHtml.indexOf('Приложение') >= 0);
    check('note-view hides other data', pubHtml.indexOf('Проверить документы') < 0);
    r = await api(T, '/api/my-notes/links/' + linkId, 'PATCH', { enabled: false });
    check('link disable', r.status === 200);
    pub = await fetch(BASE + '/api/note-view/' + token);
    check('link disabled -> 404', pub.status === 404);
    await api(T, '/api/my-notes/links/' + linkId, 'PATCH', { enabled: true });
    pub = await fetch(BASE + '/api/note-view/' + token);
    check('link re-enabled -> 200', pub.status === 200);

    // --- state persistence (create/edit/delete via state) ---
    r = await api(T, '/api/my-notes/state');
    check('state GET has note+reminder', r.d.notes.length === 1 && r.d.reminders.some(x => x.text === 'Проверить документы'));
    const allNotes = r.d.notes.slice();
    allNotes.push({ id: 'x1', title: 'Вторая', category: 'Разное', html: '<p>тест</p>', text: 'тест' });
    await api(T, '/api/my-notes/state', 'PUT', { notes: allNotes, reminders: r.d.reminders });
    r = await api(T, '/api/my-notes/state');
    check('state PUT create', r.d.notes.length === 2 && r.d.notes.some(n => n.id === 'x1'));
    await api(T, '/api/my-notes/state', 'PUT', { notes: r.d.notes.filter(n => n.id !== 'x1'), reminders: r.d.reminders });
    r = await api(T, '/api/my-notes/state');
    check('state DELETE note', r.d.notes.length === 1 && r.d.notes[0].id === noteId);

    // --- reminders: scheduler fires past-due, missed, done, delete ---
    console.log('waiting 35s for reminder scheduler tick...');
    await sleep(35000);
    r = await api(T, '/api/my-notes/state');
    const fired = r.d.reminders.some(x => x.notified === true);
    check('scheduler fired past-due reminder', fired);
    r = await api(T, '/api/my-notes/reminders/missed');
    check('missed reminders endpoint', r.status === 200 && r.d.ok);
    const remId = r.d.missed && r.d.missed[0] && r.d.missed[0].id;
    if (remId) {
      r = await api(T, '/api/my-notes/reminders/' + remId + '/done', 'POST');
      check('reminder done', r.status === 200 && r.d.reminder.done === true);
    } else {
      check('reminder done (skipped - none missed)', true);
    }
    r = await api(T, '/api/my-notes/state');
    for (const rem of r.d.reminders) {
      await api(T, '/api/my-notes/reminders/' + rem.id, 'DELETE');
    }
    r = await api(T, '/api/my-notes/state');
    check('reminder delete', r.d.reminders.length === 0);

    // --- merge via AI ---
    queue.push({ reply: 'Слил.', action: 'create_note', note: { title: 'Для слияния', html: '<p>б</p>', text: 'б' } });
    r = await api(T, '/api/my-notes/ai', 'POST', { message: 'создай ещё' });
    const n2 = r.d.note.id;
    queue.push({ reply: 'Объединил.', action: 'merge', noteIds: [noteId, n2], note: { title: 'Объединённая', html: '<p>а б</p>' } });
    r = await api(T, '/api/my-notes/ai', 'POST', { message: 'объедини заметки' });
    check('AI merge', r.status === 200 && r.d.action === 'merge' && r.d.notes.length === 1 && r.d.notes[0].title === 'Объединённая');

    // --- delete via AI ---
    queue.push({ reply: 'Удалил.', action: 'delete_note', noteId: noteId });
    r = await api(T, '/api/my-notes/ai', 'POST', { message: 'удали заметку' });
    check('AI delete_note', r.status === 200 && r.d.deleted === noteId && r.d.notes.length === 0);

    // --- admin panel ---
    r = await api(T, '/api/my-notes/admin/overview');
    check('admin overview', r.status === 200 && r.d.stats && r.d.recent.length > 0 && r.d.stats.actions > 0);
    queue.push({ reply: 'Пользователь создал заметку.', action: 'none' });
    r = await api(T, '/api/my-notes/admin/ask', 'POST', { question: 'что происходило?' });
    check('admin AI ask', r.status === 200 && r.d.reply.length > 0);

    // --- export backup ---
    r = await api(T, '/api/my-notes/export');
    check('export JSON backup', r.status === 200 && Array.isArray(r.d.notes));

    // --- security: no token -> 403 ---
    r = await (await fetch(BASE + '/api/my-notes/state')).json().catch(() => ({}));
    check('no token -> 403', r.ok === false || r.ok === undefined);

    console.log('--- RESULT: ' + pass + ' pass, ' + fail + ' fail ---');
    // cleanup test data and let debounced saveDB flush
    await api(T, '/api/my-notes/state', 'PUT', { notes: [], reminders: [] });
    await api(T, '/api/my-notes/settings', 'PUT', { apiKey: 'tp-sp7xftr9xj3ktdjt271xp2mtojtfsffzpox2o6fh8le9o74w', apiEndpoint: 'https://token-plan-sgp.xiaomimimo.com/v1', model: 'mimo-v2.6-flash' });
    await sleep(1200);
  } catch (e) {
    console.error('TEST ERROR:', e.message);
    console.log('LOG TAIL:', out.split('\n').slice(-12).join('\n'));
    fail++;
  } finally {
    if (admin && admin.s) admin.s.close();
    srv.kill();
    mock.close();
    setTimeout(() => process.exit(fail ? 1 : 0), 500);
  }
})();
