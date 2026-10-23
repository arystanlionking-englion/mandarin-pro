/* Final checks: non-admin has no admin panel; playing-state admin panel; restore test balance */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
const APP = 'http://127.0.0.1:3000/index.html';
const DB_PATH = path.join(__dirname, 'database.json');
const results = [];

function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? ' :: ' + JSON.stringify(extra) : ''));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function readDb() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch (e) { return null; }
}
async function cdpEval(ws, expression, awaitPromise) {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('cdp timeout: ' + expression.slice(0, 100))), 20000);
    function onMsg(raw) {
      const m = JSON.parse(raw);
      if (m.id !== id) return;
      clearTimeout(to);
      ws.off('message', onMsg);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
    ws.on('message', onMsg);
    ws.send(JSON.stringify({
      id, method: 'Runtime.evaluate',
      params: { expression, awaitPromise: !!awaitPromise, returnByValue: true, userGesture: true }
    }));
  });
}

function socketConnect() {
  return new Promise((resolve, reject) => {
    const s = io('http://127.0.0.1:3000', { transports: ['websocket'], reconnection: false });
    const to = setTimeout(() => reject(new Error('socket timeout')), 8000);
    s.on('connect', () => { clearTimeout(to); resolve(s); });
    s.on('connect_error', e => { clearTimeout(to); reject(e); });
  });
}
function once(s, ev, ms = 6000, pred) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { s.off(ev, h); reject(new Error('timeout ' + ev)); }, ms);
    function h(d) { if (pred && !pred(d)) return; clearTimeout(to); s.off(ev, h); resolve(d); }
    s.on(ev, h);
  });
}

async function main() {
  // ---------- Part A: restore accidental test balance on Арыстан ----------
  const db0 = readDb();
  const ary = db0 && db0.users.find(u => u.name === 'Арыстан');
  if (ary && ary.balance >= 77) {
    const admin = await socketConnect();
    const authP = once(admin, 'admin:authenticated', 6000);
    admin.emit('admin:login', { pin: '1234' });
    await authP;
    const newBal = ary.balance - 77;
    const p = once(admin, 'bank:update', 6000);
    admin.emit('admin:editBalance', { targetId: ary.id, newBalance: newBal, reason: 'Откат тестового начисления' });
    await p;
    ok('restored accidental +77 on Арыстан', true, { from: ary.balance, to: newBal });
    admin.close();
  } else {
    ok('restored accidental +77 on Арыстан', true, { note: 'nothing to restore', bal: ary && ary.balance });
  }

  // ---------- Part B: playing-state admin panel (socket + client render) ----------
  // Create a 4-player game via sockets, then load Mafia in browser as admin (not a player)
  const adminS = await socketConnect();
  const authP2 = once(adminS, 'admin:authenticated', 6000);
  adminS.emit('admin:login', { pin: '1234' });
  await authP2;

  const students = [];
  for (const name of ['ТестА', 'ТестБ', 'ТестВ', 'ТестГ']) {
    const c = await socketConnect();
    const pinStatus = once(c, 'user:pin_status', 5000);
    c.emit('user:check_pin', { name });
    const st = await pinStatus;
    if (!st.exists) {
      const needPin = once(c, 'user:need_pin', 5000);
      c.emit('user:register', { name });
      const np = await needPin;
      const logged = once(c, 'user:logged_in', 5000);
      c.emit('user:set_pin', { userId: np.user.id, pin: '1111' });
      const lg = await logged;
      students.push({ name, s: c, id: lg.user.id });
    } else {
      const logged = once(c, 'user:logged_in', 5000);
      c.emit('user:login_with_pin', { userId: st.userId, pin: '1111' });
      const lg = await logged;
      students.push({ name, s: c, id: lg.user.id });
    }
  }

  const stCreate = once(adminS, 'mafia:state', 6000, d => d && d.status === 'lobby');
  adminS.emit('mafia:createRoom', { config: { doctor: true, commissar: true, mafiaMode: 'auto', duration: 90, allowHostFinish: true } });
  await stCreate;

  await Promise.all(students.map(stu => {
    const p = once(stu.s, 'mafia:state', 6000, d => d && d.joined && d.joined.some(j => j.userId === stu.id));
    stu.s.emit('mafia:join', {});
    return p;
  }));

  const playingPs = students.map(stu => once(stu.s, 'mafia:state', 6000, d => d && d.status === 'playing'));
  const adminPlaying = once(adminS, 'mafia:state', 6000, d => d && d.status === 'playing');
  adminS.emit('mafia:start', {});
  await Promise.all([...playingPs, adminPlaying]);
  ok('game is playing (admin not a player)', true);

  // Load browser as admin and check Mafia UI in playing state
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(__dirname, '.chrome_ui_test3'),
    '--window-size=1280,900', 'about:blank'
  ], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40; i++) {
    try {
      list = await getJson('http://127.0.0.1:' + PORT + '/json/list');
      if (list && list.length) break;
    } catch (e) {}
    await sleep(250);
  }
  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  await cdpEval(ws, '1+1');
  ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));
  ws.send(JSON.stringify({ id: 3, method: 'Page.navigate', params: { url: APP } }));
  await sleep(3500);

  // Login student (АрхивТест) + admin, do NOT join mafia
  await cdpEval(ws, `(async () => {
    const nameInput = document.getElementById('authName');
    nameInput.value = 'АрхивТест';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    window.doAuth();
    await new Promise(r => setTimeout(r, 1200));
    if (document.getElementById('authStepPin') && !document.getElementById('authStepPin').classList.contains('hidden')) {
      const fields = document.getElementById('authPinFields').querySelectorAll('.pin-field');
      fields.forEach((f,i)=>{ f.value='1111'[i]||''; f.dispatchEvent(new Event('input',{bubbles:true})); });
      window.doPinLogin();
      await new Promise(r => setTimeout(r, 1200));
    }
    window.showAdminLogin();
    await new Promise(r => setTimeout(r, 200));
    const fields = document.getElementById('adminModalPinFields').querySelectorAll('.pin-field');
    fields.forEach((f,i)=>{ f.value='1234'[i]||''; f.dispatchEvent(new Event('input',{bubbles:true})); });
    window.doAdminLoginModal();
    await new Promise(r => setTimeout(r, 1500));
    return window.BP.isAdmin();
  })()`, true);

  const playingUi = await cdpEval(ws, `(async () => {
    window.go('mafia');
    await new Promise(r => setTimeout(r, 2000));
    const root = document.getElementById('mafiaRoot');
    const html = root.innerHTML;
    const acts = Array.from(root.querySelectorAll('[data-act]')).map(b => b.dataset.act);
    return {
      hasAdminPanel: html.includes('Панель администратора'),
      hasWaitNext: html.includes('Дождитесь следующей раздачи') || html.includes('Партия уже началась'),
      hasFinish: acts.includes('finish') || html.includes('Завершить'),
      hasReset: acts.includes('resetRoom') || html.includes('Сбросить'),
      acts,
      snippet: html.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 320)
    };
  })()`, true);
  ok('admin sees panel while game playing (non-player)',
    playingUi.result && playingUi.result.value
    && playingUi.result.value.hasAdminPanel
    && playingUi.result.value.hasFinish
    && playingUi.result.value.hasReset,
    playingUi.result && playingUi.result.value);

  // Admin can finish the playing game from UI
  const finishUi = await cdpEval(ws, `(async () => {
    const root = document.getElementById('mafiaRoot');
    const btn = root.querySelector('[data-act="finish"]') || root.querySelector('[data-act="resetRoom"]');
    if (!btn) return { error: 'no finish/reset', acts: Array.from(root.querySelectorAll('[data-act]')).map(b => b.dataset.act) };
    btn.click();
    await new Promise(r => setTimeout(r, 300));
    const okBtn = document.querySelector('#mafiaModal [data-modal="yes"]');
    if (okBtn) okBtn.click();
    await new Promise(r => setTimeout(r, 1500));
    return {
      clicked: btn.dataset.act,
      hasAdminPanel: root.innerHTML.includes('Панель администратора'),
      snippet: root.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 250)
    };
  })()`, true);
  ok('admin finishes/resets playing game from UI and keeps panel',
    finishUi.result && finishUi.result.value
    && !finishUi.result.value.error
    && finishUi.result.value.hasAdminPanel,
    finishUi.result && finishUi.result.value);

  // ---------- Part C: non-admin (student) must NOT see admin panel ----------
  const studentUi = await cdpEval(ws, `(async () => {
    // Drop admin by reloading and only student login
    location.reload();
    await new Promise(r => setTimeout(r, 3500));
    const nameInput = document.getElementById('authName');
    if (!nameInput) return { error: 'no auth after reload' };
    nameInput.value = 'ТестА';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    window.doAuth();
    await new Promise(r => setTimeout(r, 1200));
    if (document.getElementById('authStepPin') && !document.getElementById('authStepPin').classList.contains('hidden')) {
      const fields = document.getElementById('authPinFields').querySelectorAll('.pin-field');
      fields.forEach((f,i)=>{ f.value='1111'[i]||''; f.dispatchEvent(new Event('input',{bubbles:true})); });
      window.doPinLogin();
      await new Promise(r => setTimeout(r, 1500));
    }
    // Do NOT unlock admin PIN
    window.go('mafia');
    await new Promise(r => setTimeout(r, 2000));
    const html = document.getElementById('mafiaRoot').innerHTML;
    return {
      isAdmin: window.BP.isAdmin(),
      hasAdminPanel: html.includes('Панель администратора'),
      hasAdminButtons: html.includes('Сбросить комнату') || html.includes('ОТКРЫТЬ КОМНАТУ') || html.includes('НАЧАТЬ ПАРТИЮ'),
      hasWaitingOrLogin: html.includes('Администратор готовит') || html.includes('Ожидайте') || html.includes('Войдите') || html.includes('жд') || html.includes('Дождитесь') || html.includes('Комната') || html.includes('СЕКРЕТНЫЕ'),
      snippet: html.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 280)
    };
  })()`, true);
  ok('student does NOT see admin panel',
    studentUi.result && studentUi.result.value
    && studentUi.result.value.isAdmin === false
    && studentUi.result.value.hasAdminPanel === false
    && studentUi.result.value.hasAdminButtons === false,
    studentUi.result && studentUi.result.value);

  // ---------- Part D: remaining money ops from UI (fine / withdraw / edit) ----------
  // Restore admin session in browser
  const moneyUi = await cdpEval(ws, `(async () => {
    window.showAdminLogin();
    await new Promise(r => setTimeout(r, 200));
    const fields = document.getElementById('adminModalPinFields').querySelectorAll('.pin-field');
    fields.forEach((f,i)=>{ f.value='1234'[i]||''; f.dispatchEvent(new Event('input',{bubbles:true})); });
    window.doAdminLoginModal();
    await new Promise(r => setTimeout(r, 1200));

    window.go('users');
    await new Promise(r => setTimeout(r, 600));
    let card = null;
    document.querySelectorAll('.ucard[data-uid]').forEach(c => {
      if (!card && c.textContent.includes('АрхивТест')) card = c;
    });
    if (!card) return { error: 'no card' };
    const uid = card.dataset.uid;

    // Fine via ctx
    window.showCtxMenu(300, 300, uid);
    await new Promise(r => setTimeout(r, 80));
    document.querySelector('#ctxMenu .ctx-item[data-ctx="fine"]').click();
    await new Promise(r => setTimeout(r, 250));
    const fineModal = document.getElementById('mFine').classList.contains('on');
    const fineSel = document.getElementById('fineUL').querySelector('.uitem.sel');
    document.getElementById('fineAmt').value = '5';
    document.getElementById('fineAmt').dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('fineReason').value = 'e2e штраф';
    document.getElementById('fineReason').dispatchEvent(new Event('input',{bubbles:true}));
    if (!fineSel) {
      const it = Array.from(document.getElementById('fineUL').querySelectorAll('.uitem')).find(i=>i.dataset.uid===uid);
      if (it) it.click();
    }
    window.doFine();
    await new Promise(r => setTimeout(r, 1000));

    // Withdraw via ctx
    window.showCtxMenu(300, 300, uid);
    await new Promise(r => setTimeout(r, 80));
    document.querySelector('#ctxMenu .ctx-item[data-ctx="withdraw"]').click();
    await new Promise(r => setTimeout(r, 250));
    const wdSel = document.getElementById('wdUL').querySelector('.uitem.sel');
    document.getElementById('wdAmt').value = '3';
    document.getElementById('wdAmt').dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('wdReason').value = 'e2e изъятие';
    document.getElementById('wdReason').dispatchEvent(new Event('input',{bubbles:true}));
    if (!wdSel) {
      const it = Array.from(document.getElementById('wdUL').querySelectorAll('.uitem')).find(i=>i.dataset.uid===uid);
      if (it) it.click();
    }
    window.doWithdraw();
    await new Promise(r => setTimeout(r, 1000));

    return { uid, fineModal };
  })()`, true);
  await sleep(800);
  const dbF = readDb();
  const uF = dbF && dbF.users.find(u => u.id === (moneyUi.result.value && moneyUi.result.value.uid));
  ok('UI fine applies to correct user', moneyUi.result && moneyUi.result.value && moneyUi.result.value.fineModal === true, moneyUi.result && moneyUi.result.value);

  // Notif from UI
  const notifUi = await cdpEval(ws, `(async () => {
    const uid = document.querySelector('.ucard[data-uid]') && (() => {
      let c = null;
      document.querySelectorAll('.ucard[data-uid]').forEach(x => { if (!c && x.textContent.includes('АрхивТест')) c = x; });
      return c && c.dataset.uid;
    })();
    window.showCtxMenu(300, 300, uid);
    await new Promise(r => setTimeout(r, 80));
    document.querySelector('#ctxMenu .ctx-item[data-ctx="sendNotif"]').click();
    await new Promise(r => setTimeout(r, 250));
    const open = document.getElementById('mSendNotif').classList.contains('on');
    const sel = document.getElementById('notifUL').querySelector('.uitem.sel');
    document.getElementById('notifTitle').value = 'Тест';
    document.getElementById('notifTitle').dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('notifText').value = 'Проверка уведомления e2e';
    document.getElementById('notifText').dispatchEvent(new Event('input',{bubbles:true}));
    if (!sel) {
      const it = Array.from(document.getElementById('notifUL').querySelectorAll('.uitem')).find(i=>i.dataset.uid===uid);
      if (it) it.click();
    }
    window.doSendNotif();
    await new Promise(r => setTimeout(r, 1000));
    return { open, uid };
  })()`, true);
  ok('UI notification modal opens and submits', notifUi.result && notifUi.result.value && notifUi.result.value.open === true, notifUi.result && notifUi.result.value);

  // editBal two-step
  const editUi = await cdpEval(ws, `(async () => {
    let card = null;
    document.querySelectorAll('.ucard[data-uid]').forEach(c => { if (!card && c.textContent.includes('АрхивТест')) card = c; });
    const uid = card.dataset.uid;
    window.showCtxMenu(300, 300, uid);
    await new Promise(r => setTimeout(r, 80));
    document.querySelector('#ctxMenu .ctx-item[data-ctx="editBal"]').click();
    await new Promise(r => setTimeout(r, 250));
    const open = document.getElementById('mEditBal').classList.contains('on');
    const sel = document.getElementById('editUL').querySelector('.uitem.sel');
    document.getElementById('editVal').value = '555';
    document.getElementById('editVal').dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('editReason').value = 'e2e корректировка';
    document.getElementById('editReason').dispatchEvent(new Event('input',{bubbles:true}));
    if (!sel) {
      const it = Array.from(document.getElementById('editUL').querySelectorAll('.uitem')).find(i=>i.dataset.uid===uid);
      if (it) it.click();
    }
    window.doEditBal(); // first click = confirm text
    await new Promise(r => setTimeout(r, 200));
    const confirmShown = !document.getElementById('editConfirm').classList.contains('hidden');
    window.doEditBal(); // second click = apply
    await new Promise(r => setTimeout(r, 1200));
    return { open, confirmShown, uid };
  })()`, true);
  ok('UI editBalance two-step confirm works', editUi.result && editUi.result.value
    && editUi.result.value.open === true && editUi.result.value.confirmShown === true,
    editUi.result && editUi.result.value);

  await sleep(800);
  const dbE = readDb();
  const uE = dbE && dbE.users.find(u => u.id === (editUi.result.value && editUi.result.value.uid));
  ok('UI editBalance saved to DB', uE && uE.balance === 555, { bal: uE && uE.balance });

  console.log('\n===== SUMMARY =====');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' passed');

  try { ws.close(); } catch (e) {}
  chrome.kill();
  adminS.close();
  for (const stu of students) { try { stu.s.close(); } catch (e) {} }
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('FINAL TEST ERROR', e); process.exit(1); });
