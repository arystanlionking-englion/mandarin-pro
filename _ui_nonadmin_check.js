/* Verify non-admin user does not get Mafia admin panel */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
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
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: !!awaitPromise, returnByValue: true } }));
  });
}

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(__dirname, '.chrome_fin_c'),
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

  const login = await cdpEval(ws, `(async () => {
    const nameInput = document.getElementById('authName');
    nameInput.value = 'АрхивТест';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    window.doAuth();
    await new Promise(r => setTimeout(r, 1500));
    const pinShown = document.getElementById('authStepPin') && !document.getElementById('authStepPin').classList.contains('hidden');
    if (pinShown) {
      const fields = document.getElementById('authPinFields').querySelectorAll('.pin-field');
      fields.forEach((f,i)=>{ f.value='1111'[i]||''; f.dispatchEvent(new Event('input',{bubbles:true})); });
      window.doPinLogin();
      await new Promise(r => setTimeout(r, 1500));
    }
    return {
      app: document.getElementById('app').classList.contains('show'),
      userName: document.getElementById('uName') && document.getElementById('uName').textContent,
      isAdmin: window.BP.isAdmin(),
      pinShown
    };
  })()`, true);
  ok('student login without admin', login.result.value.app === true && login.result.value.isAdmin === false, login.result.value);

  const mafia = await cdpEval(ws, `(async () => {
    window.go('mafia');
    await new Promise(r => setTimeout(r, 2000));
    const html = document.getElementById('mafiaRoot').innerHTML;
    return {
      isAdmin: window.BP.isAdmin(),
      hasAdminPanel: html.includes('Панель администратора'),
      hasAdminButtons: html.includes('Сбросить комнату') || html.includes('ОТКРЫТЬ КОМНАТУ') || html.includes('НАЧАТЬ ПАРТИЮ') || html.includes('Завершить партию'),
      hasPlayerText: html.includes('Администратор готовит') || html.includes('Ожидайте') || html.includes('Комната') || html.includes('Зал') || html.includes('Дождитесь') || html.includes('Партия') || html.includes('СЕКРЕТНЫЕ'),
      snippet: html.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 280)
    };
  })()`, true);
  ok('non-admin mafia UI has no admin controls',
    mafia.result.value.hasAdminPanel === false && mafia.result.value.hasAdminButtons === false && mafia.result.value.hasPlayerText === true,
    mafia.result.value);

  // Right-click gate: contextmenu listener checks isAdmin
  const ctxGate = await cdpEval(ws, `(async () => {
    window.go('users');
    await new Promise(r => setTimeout(r, 700));
    if (typeof window.setUsersFilter === 'function') window.setUsersFilter('offline');
    await new Promise(r => setTimeout(r, 500));
    const card = document.querySelector('.ucard[data-uid]');
    if (!card) return { error: 'no card', cont: (document.getElementById('usersListCont')||{}).innerHTML ? document.getElementById('usersListCont').innerHTML.slice(0,150) : 'none' };
    const before = document.getElementById('ctxMenu').className;
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 });
    card.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 150));
    return {
      isAdmin: window.BP.isAdmin(),
      before,
      after: document.getElementById('ctxMenu').className,
      menuOpen: !document.getElementById('ctxMenu').classList.contains('hidden')
    };
  })()`, true);
  ok('right-click does not open admin ctx menu for non-admin',
    ctxGate.result.value.menuOpen === false && ctxGate.result.value.isAdmin === false,
    ctxGate.result.value);

  console.log('\n===== SUMMARY =====');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' passed');
  try { ws.close(); } catch (e) {}
  chrome.kill();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('ERR', e); process.exit(1); });
