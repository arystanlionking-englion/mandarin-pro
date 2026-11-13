/* Финальная проверка: десктопный вид (1280x900), перерисовки, повторный прогон словаря */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { io } = require('socket.io-client');

const ROOT = __dirname;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9344;
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 250) : ''));
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

  // admin token
  const admin = await new Promise((resolve, reject) => {
    const s = io('http://127.0.0.1:3000', { transports: ['websocket'], reconnection: false });
    const to = setTimeout(() => { s.close(); reject(new Error('login timeout')); }, 8000);
    s.on('connect_error', e => { clearTimeout(to); reject(e); });
    s.on('admin:authenticated', d => { clearTimeout(to); resolve(d.adminToken); });
    s.on('connect', () => s.emit('admin:login', { pin: '1234' }));
  });

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + path.join(ROOT, '.chrome_desk_check'),
    '--window-size=1280,900', 'about:blank'
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
    source: `window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message||'err')));try{localStorage.setItem('pb_admin_token',${JSON.stringify(admin)})}catch(e){}`
  });
  await cdpSend(ws, 'Page.navigate', { url: 'http://127.0.0.1:3000/index.html' });
  await sleep(3500);

  // Десктоп: сайдбар по CSS виден (>=769px), мобильная шапка скрыта
  const desk = await val(ws, `({
    errs: window.__errs.slice(0,5),
    sidebarDisplay: (function(){const el=document.querySelector('.sidebar');return el?getComputedStyle(el).display:null})(),
    mobHeaderHidden: (function(){const el=document.querySelector('.mob-header');return el?getComputedStyle(el).display==='none':null})()
  })`);
  ok('desktop: sidebar shown, mobile header hidden', desk && desk.sidebarDisplay === 'flex' && desk.mobHeaderHidden, desk);
  ok('desktop: no JS errors', desk && desk.errs.length === 0, desk);

  // Замер lucide.createIcons и повторных перерисовок
  const perf = await val(ws, `(function(){
    const out={};
    function t(n,f){const a=performance.now();f();out[n]=Math.round((performance.now()-a)*10)/10}
    t('lucide_createIcons_1',()=>{if(window.lucide)lucide.createIcons()});
    t('lucide_createIcons_2',()=>{if(window.lucide)lucide.createIcons()});
    t('go_users_1',()=>go('users'));
    t('go_users_2',()=>go('users'));
    t('go_admin_1',()=>go('admin'));
    t('go_admin_2',()=>go('admin'));
    return out;
  })()`);
  ok('desktop timings sane (<400ms)', perf && Object.values(perf).every(v => v < 400), perf);

  // Повторная проверка словаря (после оптимизаций)
  await cdpSend(ws, 'Page.navigate', { url: 'http://127.0.0.1:3000/dictionary' });
  await sleep(2500);
  const dict = await val(ws, `({
    errs: window.__errs.slice(0,5),
    words: typeof unifiedWords!=='undefined'?unifiedWords.length:-1,
    cards: document.querySelectorAll('#dictCards .word-card').length,
    rendered: typeof dictListRendered!=='undefined'?dictListRendered:null
  })`);
  ok('dictionary intact after optimizations', dict && dict.words === 854 && dict.cards === 30 && dict.rendered === true, dict);

  // Поиск и переключение режима (сначала переходим в раздел словаря)
  const dictNav = await val(ws, `(function(){
    navigate('dictionary');
    const out={};
    function t(n,f){const a=performance.now();f();out[n]=Math.round((performance.now()-a)*10)/10}
    t('search',()=>{document.getElementById('dictSearch').value='好';resetDictLimit();renderDict('好')});
    out.matches=document.querySelectorAll('#dictCards .word-card').length;
    t('back_all',()=>{document.getElementById('dictSearch').value='';currentMode='all';refreshCurrentView()});
    out.allCards=document.querySelectorAll('#dictCards .word-card').length;
    out.allTotal=unifiedWords.length;
    out.hsk1Total=unifiedWords.filter(w=>w.levels&&w.levels.includes('hsk1')).length;
    t('mode_switch',()=>{currentMode='hsk1';refreshCurrentView()});
    out.hsk1Cards=document.querySelectorAll('#dictCards .word-card').length;
    return out;
  })()`);
  ok('dictionary search/mode fast and correct', dictNav && dictNav.matches > 0 && dictNav.matches < 30 && dictNav.allCards === 30 && dictNav.hsk1Cards === 30 && dictNav.hsk1Total > 30 && dictNav.hsk1Total < dictNav.allTotal && dictNav.search < 400 && dictNav.mode_switch < 400, dictNav);

  const failed = results.filter(r => !r.pass).length;
  console.log(failed === 0 ? 'ALL OK' : 'FAILED: ' + failed);
  try { ws.close(); } catch (e) {}
  chrome.kill();
  server.kill();
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
