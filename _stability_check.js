/* Итоговая проверка стабильности BANK MANDARIN PRO:
   вход админа и ученика, разделы, дневник/ДЗ, экзамены, уведомления, админ-панель,
   создание/редактирование пользователя, JSON-бэкап и восстановление, сохранность данных */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { io } = require('socket.io-client');

const ROOT = __dirname;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9343;
const APP = 'http://127.0.0.1:3000/index.html';
const DB = path.join(ROOT, 'database.json');
const results = [];

function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function snap() {
  const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
  return {
    users: (db.users || []).length,
    balancesSum: (db.users || []).reduce((a, u) => a + (Number(u.balance) || 0), 0),
    history: (db.history || []).length,
    notifications: (db.notifications || []).length,
    journalRecords: ((db.journal && db.journal.records) || []).length,
    journalStudents: ((db.journal && db.journal.students) || []).length,
    exams: ((db.exams && db.exams.exams) || []).length,
    attempts: ((db.exams && db.exams.attempts) || []).length,
    quests: (db.quests || []).length,
    tasks: (db.taskAssignments || []).length
  };
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function connect() {
  return new Promise((resolve, reject) => {
    const s = io('http://127.0.0.1:3000', { transports: ['websocket'], reconnection: false });
    const to = setTimeout(() => reject(new Error('connect timeout')), 8000);
    s.on('connect', () => { clearTimeout(to); resolve(s); });
    s.on('connect_error', e => { clearTimeout(to); reject(e); });
  });
}
function once(s, ev, ms, pred) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { s.off(ev, h); reject(new Error('timeout ' + ev)); }, ms || 5000);
    function h(d) { if (pred && !pred(d)) return; clearTimeout(to); s.off(ev, h); resolve(d); }
    s.on(ev, h);
  });
}
let msgId = 0;
function cdpSend(ws, method, params) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('cdp timeout: ' + method)), 20000);
    function onMsg(raw) {
      const m = JSON.parse(raw);
      if (m.id !== id) return;
      clearTimeout(to);
      ws.off('message', onMsg);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function val(ws, expr, awaitPromise) {
  const r = await cdpSend(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: !!awaitPromise, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result && r.result.value;
}

async function main() {
  // ---------- 0. страховочная копия файла ----------
  const before = snap();
  fs.copyFileSync(DB, path.join(ROOT, 'database.json.pre_stability.bak'));
  ok('pre-snapshot taken (34 users expected)', before.users > 0, before);

  // ---------- 1. сервер ----------
  const server = spawn('node', ['server.js'], { cwd: ROOT, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40; i++) {
    try {
      const req = http.get('http://127.0.0.1:3000/index.html', res => { up = true; res.resume(); });
      req.on('error', () => {});
      await sleep(250);
      if (up) break;
    } catch (e) { await sleep(250); }
  }
  ok('server up', up);
  if (!up) { server.kill(); process.exit(1); }

  // ---------- 2. вход администратора ----------
  const admin = await connect();
  const authP = once(admin, 'admin:authenticated', 6000);
  admin.emit('admin:login', { pin: '1234' });
  const auth = await authP;
  const adminToken = auth.adminToken || '';
  ok('admin login', !!adminToken);

  // ---------- 3. JSON-бэкап и восстановление (одни и те же данные) ----------
  const backupP = once(admin, 'admin:backup_data', 8000);
  admin.emit('admin:backup');
  const b = await backupP;
  ok('backup created', !!(b && b.backup && Array.isArray(b.backup.users)), { users: b.backup.users.length });
  const restoreP = once(admin, 'admin:restore_success', 8000);
  admin.emit('admin:restore', { backup: b.backup });
  await restoreP;
  ok('restore succeeded', true);
  await sleep(700);
  const afterRestore = snap();
  ok('data intact after restore', afterRestore.users === b.backup.users.length && afterRestore.balancesSum === before.balancesSum, { before, afterRestore });

  // ---------- 4. создание и вход ученика ----------
  const TEST_LOGIN = 'ТестСтабЧК';
  const mk = once(admin, 'admin:createUserResult', 6000);
  admin.emit('admin:createUser', { login: TEST_LOGIN, pin: '1111' });
  const mkRes = await mk;
  ok('admin createUser (student)', !!(mkRes && mkRes.success), mkRes);
  const student = await connect();
  let studentId = (mkRes && mkRes.user && mkRes.user.id) || null;
  const pinP = once(student, 'user:pin_status', 5000);
  student.emit('user:check_pin', { name: TEST_LOGIN });
  const pinStatus = await pinP.catch(() => null);
  if (pinStatus && pinStatus.exists) {
    const lg = once(student, 'user:logged_in', 5000);
    student.emit('user:login_with_pin', { userId: pinStatus.userId, pin: '1111' });
    const d = await lg;
    studentId = (d.user && d.user.id) || studentId;
    ok('student login (name + PIN)', !!studentId, { studentId });
  } else {
    ok('student login (name + PIN)', false, 'pin_status missing');
  }

  // ---------- 5. создание и редактирование пользователя (админ-операции) ----------
  const createP = once(admin, 'admin:createUserResult', 6000);
  admin.emit('admin:createUser', { login: 'ТестСтабЧК2', pin: '1111' });
  const cr = await createP;
  ok('admin createUser works', !!(cr && cr.success), cr);
  const createdId = (cr && cr.user && cr.user.id) || null;
  if (createdId) {
    admin.emit('admin:editBalance', { targetId: createdId, newBalance: 777, reason: 'тест стабильности' });
    await sleep(900);
    const dbNow = JSON.parse(fs.readFileSync(DB, 'utf8'));
    const cu = (dbNow.users || []).find(u => u.id === createdId);
    ok('admin editBalance persisted', !!(cu && Number(cu.balance) === 777), cu ? { balance: cu.balance } : 'user not found');
  } else {
    ok('admin editBalance persisted', false, 'no created user id');
  }

  // ---------- 6. UI: разделы, ошибки, производительность ----------
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + path.join(ROOT, '.chrome_stab_check'),
    '--window-size=390,844', 'about:blank'
  ], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await getJson('http://127.0.0.1:' + CDP_PORT + '/json/list'); if (list && list.length) break; }
    catch (e) {}
    await sleep(250);
  }
  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  await cdpSend(ws, 'Runtime.enable');
  await cdpSend(ws, 'Page.enable');
  await cdpSend(ws, 'Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message||e.error||'err')));` +
      `try{localStorage.setItem('pb_admin_token',${JSON.stringify(adminToken)})}catch(e){}`
  });
  await cdpSend(ws, 'Page.navigate', { url: APP });
  await sleep(4000);

  const bootInfo = await val(ws, `({
    errs: window.__errs.slice(0,5),
    appShown: !!document.querySelector('#app.show') || document.getElementById('authScreen').style.display==='none',
    adminBadge: !!(document.getElementById('navAdmin')&&!document.getElementById('navAdmin').classList.contains('hidden'))
  })`);
  ok('app booted without JS errors', bootInfo && bootInfo.errs.length === 0, bootInfo);

  // Быстродействие основных разделов
  const timings = await val(ws, `(function(){
    const out={};
    function t(name,fn){const a=performance.now();fn();out[name]=Math.round(performance.now()-a)}
    t('home',()=>go('home'));
    t('users',()=>go('users'));
    t('admin',()=>go('admin'));
    t('diary',()=>go('diary'));
    t('homework',()=>go('homework'));
    t('exams',()=>go('exams'));
    t('notifications',()=>go('notifications'));
    t('home2',()=>go('home'));
    return out;
  })()`);
  ok('sections navigate without errors', timings && Object.keys(timings).length === 8, timings);
  ok('navigation is fast (<400ms each)', timings && Object.values(timings).every(v => v < 400), timings);

  const secInfo = await val(ws, `({
    errs: window.__errs.slice(0,8),
    secs: [...document.querySelectorAll('.sec')].length,
    journalRoot: !!document.getElementById('journalRoot'),
    diarySec: !!document.getElementById('secDiary'),
    hwSec: !!document.getElementById('secHomework'),
    examsSec: !!document.getElementById('secExams'),
    notifSec: !!document.getElementById('secNotifications')
  })`);
  ok('diary/homework/exams/notifications sections exist', secInfo && secInfo.diarySec && secInfo.hwSec && secInfo.examsSec && secInfo.notifSec, secInfo);
  ok('still no JS errors after navigation', secInfo && secInfo.errs.length === 0, secInfo.errs);

  // Каждый раздел реально показывается
  const showChecks = await val(ws, `(function(){
    const out={};
    ['home','users','admin','diary','homework','exams','notifications'].forEach(s=>{
      go(s);
      const el=document.querySelector('.sec.on');
      out[s]=el?el.id:null;
    });
    return out;
  })()`);
  ok('each tab becomes active section', showChecks && showChecks.home === 'secHome' && showChecks.users === 'secUsers' && showChecks.admin === 'secAdmin' && showChecks.diary === 'secDiary' && showChecks.homework === 'secHomework' && showChecks.exams === 'secExams' && showChecks.notifications === 'secNotifications', showChecks);

  // Уведомления рендерятся
  const notifInfo = await val(ws, `(function(){
    go('notifications');
    const el=document.getElementById('secNotifications');
    return {on:el.classList.contains('on'),html:el.innerHTML.length};
  })()`);
  ok('notifications section renders', notifInfo && notifInfo.on && notifInfo.html > 200, notifInfo);

  // ---------- 7. удаление тестовых пользователей ----------
  if (createdId) {
    admin.emit('admin:remove', { targetId: createdId });
    await sleep(500);
  }
  if (studentId) {
    admin.emit('admin:remove', { targetId: studentId });
    await sleep(500);
  }
  ok('test users removed via admin:remove', true);

  // ---------- 8. сохранность данных ----------
  const final = snap();
  ok('user count restored', final.users === before.users, { before: before.users, final: final.users });
  ok('balances sum unchanged', final.balancesSum === before.balancesSum, { before: before.balancesSum, final: final.balancesSum });
  ok('history/journal intact', Math.abs(final.history - before.history) <= 2 && final.journalRecords === before.journalRecords && final.journalStudents === before.journalStudents, { before, final });

  const failed = results.filter(r => !r.pass).length;
  console.log(failed === 0 ? 'ALL OK' : 'FAILED: ' + failed);
  try { ws.close(); } catch (e) {}
  try { admin.close(); student.close(); } catch (e) {}
  chrome.kill();
  server.kill();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
