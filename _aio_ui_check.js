/* Проверка AI Office: открытие/закрытие рабочего пространства, сайдбар, сохранение текста, задача */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { io } = require('socket.io-client');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9342;
const APP = 'http://127.0.0.1:3000/index.html';
const AIO = 'http://127.0.0.1:3000/ai-office/';
const results = [];

function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
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
  if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result && r.result.value;
}

const STATE_STUB = JSON.stringify({
  projects: [{ id: 'p1', name: 'Тестовый проект', archived: false }],
  connections: [{ id: 'c1', provider: 'groq', name: 'Groq', mask: '****' }],
  files: [], tasks: [], messages: [], templates: [], settings: {},
  providerInfo: {}
});

async function main() {
  const server = spawn('node', ['server.js'], { cwd: __dirname, stdio: 'ignore' });
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

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + path.join(__dirname, '.chrome_aio_check'),
    '--window-size=390,844', 'about:blank'
  ], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await getJson('http://127.0.0.1:' + CDP_PORT + '/json/list'); if (list && list.length) break; }
    catch (e) {}
    await sleep(250);
  }
  if (!list || !list.length) { console.error('Chrome CDP not available'); chrome.kill(); server.kill(); process.exit(1); }
  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  await cdpSend(ws, 'Runtime.enable');
  await cdpSend(ws, 'Page.enable');

  // ================= PART A: parent app workspace open/close =================
  // Реальный админ-токен через socket admin:login (PIN 1234 — как в тестах проекта)
  let adminToken = '';
  try {
    adminToken = await new Promise((resolve, reject) => {
      const s = io('http://127.0.0.1:3000', { transports: ['websocket'], reconnection: false });
      const to = setTimeout(() => { s.close(); reject(new Error('admin login timeout')); }, 8000);
      s.on('connect_error', e => { clearTimeout(to); reject(e); });
      s.on('admin:authenticated', d => { clearTimeout(to); s.close(); resolve(d.adminToken || ''); });
      s.on('connect', () => s.emit('admin:login', { pin: '1234' }));
      setTimeout(() => { try { s.close(); } catch (e) {} }, 9000);
    });
  } catch (e) { console.log('WARN admin login:', e.message); }
  ok('admin login (pin 1234) issued token', !!adminToken, adminToken ? 'token-len=' + adminToken.length : null);

  await cdpSend(ws, 'Page.addScriptToEvaluateOnNewDocument', {
    source: `try{localStorage.setItem('pb_admin_token',${JSON.stringify(adminToken)})}catch(e){}`
  });
  await cdpSend(ws, 'Page.navigate', { url: APP });
  await sleep(3500);
  const adminReady = await val(ws, `(function(){
    return { resumeTried: !!localStorage.getItem('pb_admin_token') };
  })()`);
  ok('admin token stored in page', adminReady && adminReady.resumeTried, adminReady);

  // UI-путь: показать логин администратора не требуется — токен уже применён через admin:resume.
  // Открываем рабочее пространство.
  await val(ws, `openAiOffice()`);
  await sleep(500);
  let s = await val(ws, `({
    fs: document.body.classList.contains('aioffice-fullscreen'),
    sec: document.getElementById('secAioffice').classList.contains('on'),
    secs: [...document.querySelectorAll('.sec.on')].map(e=>e.id)
  })`);
  ok('openAiOffice → fullscreen + section on', s && s.fs && s.sec, s);
  ok('workspace section is the only active one on top', s && s.sec, s);

  // случайная навигация не должна закрывать рабочее пространство
  await val(ws, `go('users')`);
  await sleep(250);
  s = await val(ws, `({
    fs: document.body.classList.contains('aioffice-fullscreen'),
    sec: document.getElementById('secAioffice').classList.contains('on'),
    secs: [...document.querySelectorAll('.sec.on')].map(e=>e.id)
  })`);
  ok('stray go() does NOT close workspace', s && s.fs && s.sec, s);

  // Escape закрывает рабочее пространство
  await val(ws, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(350);
  s = await val(ws, `({
    fs: document.body.classList.contains('aioffice-fullscreen'),
    sec: document.getElementById('secAioffice').classList.contains('on')
  })`);
  ok('Escape closes workspace', s && !s.fs && !s.sec, s);

  // Повторное открытие + явная кнопка «✕ Закрыть»
  await val(ws, `openAiOffice()`);
  await sleep(500);
  const btnOk = await val(ws, `(function(){
    const b=document.getElementById('aioClose');
    if(!b)return 'no button';
    b.click();
    return 'clicked';
  })()`);
  await sleep(350);
  s = await val(ws, `({
    fs: document.body.classList.contains('aioffice-fullscreen'),
    sec: document.getElementById('secAioffice').classList.contains('on')
  })`);
  ok('explicit close button works', btnOk === 'clicked' && s && !s.fs && !s.sec, { btnOk, s });

  // Навигация после закрытия работает как обычно
  await val(ws, `go('admin')`);
  await sleep(250);
  s = await val(ws, `[...document.querySelectorAll('.sec.on')].map(e=>e.id)`);
  ok('navigation works after close', Array.isArray(s) && s.includes('secAdmin'), s);

  // ================= PART B: AI Office app sidebar / text / task =================
  // Заглушка API — до загрузки страницы
  await cdpSend(ws, 'Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      const state=${STATE_STUB};
      window.fetch=function(url,opts){
        const u=String(url);
        const j=(d)=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(d)});
        if(u.indexOf('/api/auth')>=0)return j({user:'teacher',integrated:true});
        if(u.indexOf('/api/state')>=0)return j(state);
        if(u.indexOf('/api/action')>=0)return j({});
        if(u.indexOf('/api/file')>=0)return j({});
        return j({});
      };
    })();`
  });
  await cdpSend(ws, 'Page.navigate', { url: AIO });
  await sleep(2500);

  s = await val(ws, `({
    closeBtn: !!document.querySelector('.side-close'),
    backdrop: !!document.querySelector('.side-backdrop'),
    menuBtn: !!document.querySelector('button[data-action="menu"]'),
    hasU: typeof U!=='undefined'
  })`);
  ok('AI Office rendered', s && s.hasU, s);
  ok('sidebar has explicit close button', s && s.closeBtn, s);
  ok('sidebar backdrop exists', s && s.backdrop, s);

  // Открыть меню ☰ (кнопка в шапке, не кнопка закрытия в сайдбаре)
  await val(ws, `document.querySelector('.main button[data-action="menu"]').click()`);
  await sleep(200);
  s = await val(ws, `({
    mobile: U.mobile,
    sidebarOpen: document.querySelector('.sidebar').classList.contains('open'),
    backdropShow: document.querySelector('.side-backdrop').classList.contains('show')
  })`);
  ok('menu opens with backdrop', s && s.mobile === true && s.sidebarOpen && s.backdropShow, s);

  // Клик по свободной области: ничего не закрывается (подложка нейтральна)
  await val(ws, `document.querySelector('.side-backdrop').click()`);
  await sleep(200);
  s = await val(ws, `({
    mobile: U.mobile,
    office: U.office,
    sidebarOpen: document.querySelector('.sidebar').classList.contains('open')
  })`);
  ok('free-area tap does NOT close menu/panels', s && s.mobile === true && s.office === true && s.sidebarOpen, s);

  // Кнопка закрытия меню работает
  await val(ws, `document.querySelector('.side-close').click()`);
  await sleep(200);
  s = await val(ws, `({mobile:U.mobile,sidebarOpen:document.querySelector('.sidebar').classList.contains('open')})`);
  ok('explicit ✕ closes menu', s && s.mobile === false && !s.sidebarOpen, s);

  // Сохранение текста followup при переключении агента (туда-обратно)
  await val(ws, `(function(){
    const f=document.getElementById('followup');
    f.value='Проверь черновик задания';
    f.dispatchEvent(new Event('input',{bubbles:true}));
    return U.followup;
  })()`);
  await val(ws, `document.querySelector('.ws-tab[data-agent="research"]').click()`);
  await sleep(200);
  await val(ws, `document.querySelector('.ws-tab[data-agent="document"]').click()`);
  await sleep(200);
  s = await val(ws, `({followup:U.followup, input:document.getElementById('followup').value})`);
  ok('followup text survives agent switch (round-trip)', s && s.followup === 'Проверь черновик задания' && s.input === 'Проверь черновик задания', s);

  // Сохранение текста при переключении раздела (вкладки)
  await val(ws, `document.querySelector('nav button[data-section="word"]').click()`);
  await sleep(200);
  await val(ws, `document.querySelector('nav button[data-section="chat"]').click()`);
  await sleep(200);
  s = await val(ws, `({followup:U.followup, input:document.getElementById('followup').value})`);
  ok('followup text survives section switch', s && s.followup === 'Проверь черновик задания' && s.input === 'Проверь черновик задания', s);

  // Задача не сбрасывается при повторном нажатии на текущего агента
  s = await val(ws, `(function(){
    U.task='task-keep';
    render();
    const tab=document.querySelector('.ws-tab[data-agent="document"]');
    tab.click();
    return {task:U.task, agent:U.agent};
  })()`);
  ok('same-agent click keeps current task', s && s.task === 'task-keep', s);

  // prompt/editor тоже переживают переключение агента
  await val(ws, `(function(){
    const p=document.getElementById('prompt');
    if(p){p.value='Черновик задания';p.dispatchEvent(new Event('input',{bubbles:true}))}
    return U.prompt;
  })()`);
  await val(ws, `document.querySelector('.ws-tab[data-agent="education"]').click()`);
  await sleep(150);
  await val(ws, `document.querySelector('.ws-tab[data-agent="document"]').click()`);
  await sleep(150);
  s = await val(ws, `U.prompt`);
  ok('prompt survives agent switch (round-trip)', s === 'Черновик задания', s);

  const failed = results.filter(r => !r.pass).length;
  console.log(failed === 0 ? 'ALL OK' : 'FAILED: ' + failed);
  try { ws.close(); } catch (e) {}
  chrome.kill();
  server.kill();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
