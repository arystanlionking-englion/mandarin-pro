/* Quick UI check: login form + no-account modal + admin create user */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9340;
const APP = 'http://127.0.0.1:3000/index.html';
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
async function cdpEval(ws, expression, awaitPromise) {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('cdp timeout')), 20000);
    function onMsg(raw) {
      const m = JSON.parse(raw);
      if (m.id !== id) return;
      clearTimeout(to);
      ws.off('message', onMsg);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: !!awaitPromise, returnByValue: true, userGesture: true } }));
  });
}

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(__dirname, '.chrome_auth'),
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
  await sleep(150);
  ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));
  ws.send(JSON.stringify({ id: 3, method: 'Page.navigate', params: { url: APP } }));
  await sleep(3500);

  const form = await cdpEval(ws, `(() => {
    const name = document.getElementById('authName');
    const pass = document.getElementById('authPassword');
    const step1 = document.getElementById('authStep1');
    const setPin = document.getElementById('authStepSetPin');
    const html = document.getElementById('authScreen').innerHTML;
    return {
      hasName: !!name,
      hasPassword: !!pass,
      step1Visible: step1 && !step1.classList.contains('hidden'),
      hasNoAccount: html.includes('Нет аккаунта'),
      hasSetPin: !!setPin,
      hasRegBtn: html.includes('Регистрация') || html.includes('Зарегистрироваться')
    };
  })()`);
  ok('login form has name+password, no self-register', form.result.value.hasName && form.result.value.hasPassword
    && form.result.value.hasNoAccount && !form.result.value.hasSetPin && !form.result.value.hasRegBtn, form.result.value);

  const noAcc = await cdpEval(ws, `(async () => {
    window.showNoAccount();
    await new Promise(r => setTimeout(r, 200));
    const modal = document.getElementById('mNoAccount');
    const open = modal && modal.classList.contains('on');
    const text = modal ? modal.textContent : '';
    return {
      open,
      hasMessage: text.includes('обратитесь к администратору') || text.includes('администратору'),
      hasSubmit: !!document.querySelector('#mNoAccount [onclick*="submitNoAccount"]'),
      hasOk: text.includes('Понятно')
    };
  })()`, true);
  ok('«Нет аккаунта?» shows admin-contact message', noAcc.result.value.open && noAcc.result.value.hasMessage
    && noAcc.result.value.hasSubmit && noAcc.result.value.hasOk, noAcc.result.value);

  // Wrong login shows clear error
  const wrong = await cdpEval(ws, `(async () => {
    if (typeof window.cmOnly === 'function') window.cmOnly('mNoAccount');
    document.getElementById('authName').value = 'НетТакогоПользователя';
    document.getElementById('authPassword').value = 'badpass';
    window.doAuth();
    await new Promise(r => setTimeout(r, 1500));
    const err = document.getElementById('authErr');
    return { err: err && err.textContent, visible: err && err.style.display !== 'none' };
  })()`, true);
  ok('wrong credentials show clear error', /Неверное имя пользователя или пароль/i.test(wrong.result.value.err || ''), wrong.result.value);

  // Admin login + create user modal exists
  const adminUi = await cdpEval(ws, `(async () => {
    window.showAdminLogin();
    await new Promise(r => setTimeout(r, 200));
    const fields = document.getElementById('adminModalPinFields').querySelectorAll('.pin-field');
    fields.forEach((f,i)=>{ f.value='1234'[i]||''; f.dispatchEvent(new Event('input',{bubbles:true})); });
    window.doAdminLoginModal();
    await new Promise(r => setTimeout(r, 1500));
    window.go('admin');
    await new Promise(r => setTimeout(r, 500));
    window.showCreateUserModal();
    await new Promise(r => setTimeout(r, 300));
    const modal = document.getElementById('mCreateUser');
    const open = modal && modal.classList.contains('on');
    const hasFields = !!(document.getElementById('cuLogin') && document.getElementById('cuPassword') && document.getElementById('cuPin') && document.getElementById('cuStatus'));
    const adminHtml = document.getElementById('adminPanelView') ? document.getElementById('adminPanelView').textContent : '';
    return {
      isAdmin: window.BP.isAdmin(),
      open,
      hasFields,
      hasCreateBtn: adminHtml.includes('Создать пользователя'),
      hasRequestsBtn: adminHtml.includes('Запросы на аккаунт')
    };
  })()`, true);
  ok('admin create-user form + requests section', adminUi.result.value.isAdmin && adminUi.result.value.open
    && adminUi.result.value.hasFields && adminUi.result.value.hasCreateBtn && adminUi.result.value.hasRequestsBtn,
    adminUi.result.value);

  console.log('\n===== SUMMARY =====');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' passed');
  try { ws.close(); } catch (e) {}
  chrome.kill();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('UI ERR', e); process.exit(1); });
