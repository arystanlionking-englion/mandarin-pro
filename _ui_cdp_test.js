/* Minimal CDP UI test for Mafia admin panel + user context menu */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
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
    const to = setTimeout(() => reject(new Error('cdp timeout: ' + expression.slice(0, 80))), 15000);
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

async function main() {
  const userDataDir = path.join(__dirname, '.chrome_ui_test');
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDataDir,
    '--window-size=1280,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40; i++) {
    try {
      list = await getJson('http://127.0.0.1:' + PORT + '/json/list');
      if (list && list.length) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!list || !list.length) {
    console.error('Chrome CDP not available');
    chrome.kill();
    process.exit(1);
  }

  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  // Enable runtime + navigate
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  await cdpEval(ws, '1+1');
  ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));
  ws.send(JSON.stringify({ id: 3, method: 'Page.navigate', params: { url: APP } }));
  await sleep(3500);

  // Wait for app / socket
  const boot = await cdpEval(ws, `(() => {
    return {
      hasBP: typeof window.BP === 'object',
      hasMafia: typeof window.Mafia === 'object',
      hasShowCtx: typeof window.showCtxMenu === 'function',
      hasShowUD: typeof window.showUD === 'function',
      hasShowAUser: typeof window.showAUser === 'function',
      hasDoArchive: typeof window.doArchiveUser === 'function',
      hasRunCtx: typeof runCtxAction === 'function' || typeof window.runCtxAction === 'function',
      isAdminNow: (function(){ try { return window.BP && window.BP.isAdmin && window.BP.isAdmin(); } catch(e){ return String(e); } })(),
      connected: (function(){ try { return !!(window.io && document.querySelector('input#authName')); } catch(e){ return false; } })()
    };
  })()`);
  ok('BP/Mafia bridge loaded', boot.result && boot.result.value && boot.result.value.hasBP && boot.result.value.hasMafia, boot.result && boot.result.value);
  ok('ctx handlers on window', boot.result.value.hasShowCtx && boot.result.value.hasShowUD && boot.result.value.hasShowAUser && boot.result.value.hasDoArchive);

  // Login as a test student + admin PIN via socket from the page
  const login = await cdpEval(ws, `(async () => {
    const s = window.socket || (window.io && window.io.socket);
    // find socket via BP internals is not exposed; use io from page if any
    return { hasSocket: typeof window.socket, keys: Object.keys(window).filter(k=>k.toLowerCase().includes('socket')).slice(0,10) };
  })()`);
  console.log('socket probe', JSON.stringify(login.result && login.result.value));

  // The app keeps socket in IIFE — use UI: fill auth fields and click
  const authRes = await cdpEval(ws, `(async () => {
    function q(id){ return document.getElementById(id); }
    // wait for auth screen
    const nameInput = q('authName');
    if (!nameInput) return { step: 'no authName' };
    nameInput.value = 'АрхивТест';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    // trigger doAuth
    if (typeof window.doAuth === 'function') window.doAuth();
    await new Promise(r => setTimeout(r, 1500));
    // If pin step shown, enter 1111 via pin fields
    const pinWrap = q('authPinFields');
    const hasPinStep = pinWrap && !pinWrap.closest('.hidden') && pinWrap.offsetParent !== null;
    if (hasPinStep || (q('authStepPin') && !q('authStepPin').classList.contains('hidden'))) {
      const fields = q('authPinFields').querySelectorAll('.pin-field');
      const pin = '1111';
      fields.forEach((f, i) => { f.value = pin[i] || ''; f.dispatchEvent(new Event('input', { bubbles: true })); });
      if (typeof window.doPinLogin === 'function') window.doPinLogin();
      await new Promise(r => setTimeout(r, 1500));
    }
    // If set-pin step (new user)
    if (q('authStepSetPin') && !q('authStepSetPin').classList.contains('hidden')) {
      const f1 = q('setPinFields').querySelectorAll('.pin-field');
      const f2 = q('setPinFields2').querySelectorAll('.pin-field');
      f1.forEach((f,i)=>{ f.value='1111'[i]||''; f.dispatchEvent(new Event('input',{bubbles:true})); });
      f2.forEach((f,i)=>{ f.value='1111'[i]||''; f.dispatchEvent(new Event('input',{bubbles:true})); });
      if (typeof window.doSetPin === 'function') window.doSetPin();
      await new Promise(r => setTimeout(r, 1500));
    }
    return {
      appShown: document.getElementById('app') && document.getElementById('app').classList.contains('show'),
      userName: document.getElementById('uName') && document.getElementById('uName').textContent
    };
  })()`, true);
  ok('student login via UI', authRes.result && authRes.result.value && authRes.result.value.appShown, authRes.result && authRes.result.value);

  // Admin login via modal
  const adminRes = await cdpEval(ws, `(async () => {
    if (typeof window.showAdminLogin === 'function') window.showAdminLogin();
    await new Promise(r => setTimeout(r, 300));
    const wrap = document.getElementById('adminModalPinFields');
    if (!wrap) return { step: 'no admin pin fields' };
    const fields = wrap.querySelectorAll('.pin-field');
    fields.forEach((f,i)=>{ f.value='1234'[i]||''; f.dispatchEvent(new Event('input',{bubbles:true})); });
    if (typeof window.doAdminLoginModal === 'function') window.doAdminLoginModal();
    await new Promise(r => setTimeout(r, 1500));
    return {
      isAdmin: window.BP && window.BP.isAdmin && window.BP.isAdmin(),
      adminPanelVisible: document.getElementById('adminPanelView') && !document.getElementById('adminPanelView').classList.contains('hidden')
    };
  })()`, true);
  ok('admin PIN unlock via UI', adminRes.result && adminRes.result.value && adminRes.result.value.isAdmin === true, adminRes.result && adminRes.result.value);

  // Open Mafia section
  const mafiaRes = await cdpEval(ws, `(async () => {
    if (typeof window.go === 'function') window.go('mafia');
    await new Promise(r => setTimeout(r, 1200));
    const root = document.getElementById('mafiaRoot');
    const html = root ? root.innerHTML : '';
    return {
      hasRoot: !!root,
      hasAdminPanel: html.includes('Панель администратора'),
      hasWaiting: html.includes('Ожидание') || html.includes('жд') || html.includes('Скоро') || html.includes('Комната') || html.includes('Зал') || html.includes('настро') || html.includes('ОТКРЫТЬ') || html.includes('idle') || html.includes('СЕКРЕТНЫЕ'),
      hasFinish: html.includes('Завершить') || html.includes('Сбросить') || html.includes('ОТКРЫТЬ') || html.includes('НАЧАТЬ'),
      snippet: html.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 300)
    };
  })()`, true);
  ok('Mafia admin panel visible for admin', mafiaRes.result && mafiaRes.result.value && mafiaRes.result.value.hasAdminPanel, mafiaRes.result && mafiaRes.result.value);

  // Open users section and context menu
  const ctxRes = await cdpEval(ws, `(async () => {
    if (typeof window.go === 'function') window.go('users');
    await new Promise(r => setTimeout(r, 800));
    const card = document.querySelector('.ucard[data-uid]');
    if (!card) return { step: 'no ucard', body: document.getElementById('usersListCont') ? document.getElementById('usersListCont').innerHTML.slice(0,200) : 'no cont' };
    const uid = card.dataset.uid;
    // open ctx menu as admin
    window.showCtxMenu(200, 200, uid);
    await new Promise(r => setTimeout(r, 200));
    const menu = document.getElementById('ctxMenu');
    const visible = menu && !menu.classList.contains('hidden');
    const items = menu ? Array.from(menu.querySelectorAll('.ctx-item')).map(i => i.dataset.ctx) : [];
    return { uid, visible, items, hiddenClass: menu && menu.className };
  })()`, true);
  ok('context menu opens with 11 actions', ctxRes.result && ctxRes.result.value && ctxRes.result.value.visible === true
    && Array.isArray(ctxRes.result.value.items) && ctxRes.result.value.items.length >= 11,
    ctxRes.result && ctxRes.result.value);

  // Click each ctx action and verify it does something (modal opens or confirm opens)
  const actionResults = await cdpEval(ws, `(async () => {
    const uid = document.querySelector('.ucard[data-uid]') && document.querySelector('.ucard[data-uid]').dataset.uid;
    if (!uid) return { error: 'no uid' };
    const actions = ['profile','balance','history','addMoney','topup','withdraw','fine','editBal','sendNotif','archive','remove'];
    const out = {};
    for (const act of actions) {
      window.showCtxMenu(220, 220, uid);
      await new Promise(r => setTimeout(r, 80));
      const item = document.querySelector('#ctxMenu .ctx-item[data-ctx="' + act + '"]');
      if (!item) { out[act] = 'no-item'; continue; }
      item.click();
      await new Promise(r => setTimeout(r, 250));
      const anyModal = Array.from(document.querySelectorAll('.modal-bg')).some(m => m.classList.contains('on'));
      const confirmOn = document.getElementById('mConfirm') && document.getElementById('mConfirm').classList.contains('on');
      const profileOn = document.getElementById('mUserDetail') && document.getElementById('mUserDetail').classList.contains('on');
      out[act] = { anyModal, confirmOn, profileOn, menuHidden: document.getElementById('ctxMenu').classList.contains('hidden') };
      // close modal if open
      if (typeof window.cmOnly === 'function') {
        document.querySelectorAll('.modal-bg.on').forEach(m => window.cmOnly(m.id));
      }
      await new Promise(r => setTimeout(r, 80));
    }
    return out;
  })()`, true);

  const ar = actionResults.result && actionResults.result.value || {};
  for (const act of ['profile','balance','history','addMoney','topup','withdraw','fine','editBal','sendNotif','archive','remove']) {
    const r = ar[act];
    const worked = r && typeof r === 'object' && (r.anyModal || r.confirmOn || r.profileOn);
    ok('ctx action opens UI: ' + act, worked, r);
  }

  console.log('\\n===== SUMMARY =====');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' passed');

  try { ws.close(); } catch (e) {}
  chrome.kill();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('UI TEST ERROR', e); process.exit(1); });
