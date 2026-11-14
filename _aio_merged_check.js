/* Проверка объединённого интерфейса AI Office + 4 ассистента и My Notes AI: iPhone 13 (390x844), без горизонтальной прокрутки, крупные кнопки, единая панель ввода */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { io } = require('socket.io-client');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9355;
const BASE = 'http://127.0.0.1:3000';
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 160) : ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
let msgId = 0;
function cdpSend(ws, method, params) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('cdp timeout: ' + method)), 25000);
    function onMsg(raw) {
      const m = JSON.parse(raw);
      if (m.id !== id) return;
      clearTimeout(to); ws.off('message', onMsg);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
async function val(ws, expr) {
  const r = await cdpSend(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result && r.result.value;
}

async function main() {
  const server = spawn('node', ['server.js'], { cwd: __dirname, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE + '/'); up = true; break; } catch (e) { await sleep(300); }
  }
  ok('server up', up);
  if (!up) { server.kill(); process.exit(1); }

  const adminToken = await new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'], reconnection: false });
    const to = setTimeout(() => { s.close(); reject(new Error('admin login timeout')); }, 8000);
    s.on('admin:authenticated', d => { clearTimeout(to); s.close(); resolve(d.adminToken || ''); });
    s.on('connect', () => s.emit('admin:login', { pin: '1234' }));
  }).catch(e => { console.log('WARN admin login:', e.message); return ''; });
  ok('admin login token', !!adminToken);

  // cookie для загрузки страниц модулей
  const a1 = await fetch(BASE + '/api/ai-office/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminToken }) });
  const cookie = (a1.headers.get('set-cookie') || '').split(';')[0];
  await fetch(BASE + '/api/my-notes/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminToken }) });
  ok('auth cookies set', !!cookie);

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + path.join(__dirname, '.chrome_merged_check'),
    '--window-size=390,844', 'about:blank'
  ], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await getJson('http://127.0.0.1:' + CDP_PORT + '/json/list'); if (list && list.length) break; } catch (e) { }
    await sleep(300);
  }
  if (!list || !list.length) { console.error('Chrome CDP not available'); chrome.kill(); server.kill(); process.exit(1); }
  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  await cdpSend(ws, 'Runtime.enable');
  await cdpSend(ws, 'Page.enable');
  await cdpSend(ws, 'Network.enable');
  await cdpSend(ws, 'Network.setCookie', { name: 'pb_admin', value: adminToken, url: BASE + '/', httpOnly: true, sameSite: 'Strict' });
  await cdpSend(ws, 'Page.addScriptToEvaluateOnNewDocument', {
    source: `try{localStorage.setItem('pb_admin_token',${JSON.stringify(adminToken)})}catch(e){}`
  });

  // ================= 1. Объединённый AI Office =================
  await cdpSend(ws, 'Page.navigate', { url: BASE + '/ai-office/' });
  await sleep(3500);
  let s = await val(ws, `({
    top2: !!document.querySelector('.top2'),
    chips: document.querySelectorAll('.asst-chip').length,
    prompt: !!document.querySelector('#prompt'),
    send: !!document.querySelector('.send2'),
    settingsBtn: !!document.querySelector('.top2-actions button[data-action="settings"]'),
    historyBtn: !!document.querySelector('.top2-actions button[data-action="history"]'),
    composer: !!document.querySelector('.composer2'),
    err: (window.__lastError||'')
  })`);
  ok('AI Office: 4 ассистента вверху', s && s.chips === 4, s);
  ok('AI Office: единая панель ввода + кнопка отправки', s && s.prompt && s.send && s.composer, s);
  ok('AI Office: кнопки Настройки и История', s && s.settingsBtn && s.historyBtn, s);

  s = await val(ws, `({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    chipH: Math.round((document.querySelector('.asst-chip')||{getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height),
    sendH: Math.round((document.querySelector('.send2')||{getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height),
    promptFont: getComputedStyle(document.querySelector('#prompt')).fontSize
  })`);
  ok('iPhone13: нет горизонтальной прокрутки', s && s.overflow <= 1, s);
  ok('iPhone13: чипы ассистентов ≥ 40px', s && s.chipH >= 40, s);
  ok('iPhone13: кнопка отправки ≥ 44px', s && s.sendH >= 44, s);
  ok('iPhone13: шрифт ввода ≥ 16px (без автозума)', s && parseFloat(s.promptFont) >= 16, s);

  // выбор ассистента (мультивыбор) и «открыть ассистента»
  s = await val(ws, `(function(){
    function chip(i){return document.querySelectorAll('.asst-chip')[i]}
    chip(1).click();
    var sel1=document.querySelectorAll('.asst-chip.sel').length;
    chip(2).click();
    var sel2=document.querySelectorAll('.asst-chip.sel').length;
    chip(3).querySelector('.asst-open').click();
    var sel3=document.querySelectorAll('.asst-chip.sel').length;
    return {sel1:sel1,sel2:sel2,sel3:sel3,main:document.querySelectorAll('.asst-chip.main').length};
  })()`);
  ok('выбор нескольких ассистентов работает', s && s.sel1 === 2 && s.sel2 === 3, s);
  ok('открыть отдельного ассистента → соло-режим', s && s.sel3 === 1 && s.main === 1, s);

  // авто-определение типа задачи
  s = await val(ws, `({
    slides: inferWorkflow('сделай презентацию про китайский язык'),
    lesson: inferWorkflow('составь план урока для группы'),
    test: inferWorkflow('создай тест по HSK 4'),
    word: inferWorkflow('напиши документ-договор'),
    chat: inferWorkflow('привет, как дела?')
  })`);
  ok('авто-тип задачи: презентация/урок/тест/документ', s && s.slides === 'slides' && s.lesson === 'lesson' && s.test === 'test' && s.word === 'word', s);
  ok('обычный вопрос → чат ассистенту', s && s.chat === '', s);

  // настройки: ключи/модели/основной ассистент
  await val(ws, `document.querySelector('.top2-actions button[data-action="settings"]').click()`);
  await sleep(700);
  s = await val(ws, `({
    asstCfg: document.querySelectorAll('.asst-cfg').length,
    mainSel: !!document.querySelector('#asst-main'),
    connRows: document.querySelectorAll('.connection-row').length,
    testBtns: document.querySelectorAll('button[data-action="asst-test"]').length,
    keyInputs: document.querySelectorAll('input[type="password"]').length,
    clearKeyBtns: document.querySelectorAll('button[data-action="asst-clear-key"]').length,
    noRawKey: !/tp-sp7xftr9xj3ktdjt271xp2mtojtfsffzpox2o6fh8le9o74w/.test(document.body.innerHTML)
  })`);
  ok('настройки: конфиги 4 ассистентов + основной ассистент', s && s.asstCfg === 4 && s.mainSel, s);
  ok('настройки: проверка связи у каждого ассистента', s && s.testBtns === 4, s);
  ok('настройки: поля ключей (password) и удаление ключа, без ключей открытым текстом', s && s.keyInputs >= 4 && s.clearKeyBtns === 4 && s.noRawKey, s);

  // история
  await val(ws, `document.querySelector('.top2-actions button[data-action="history"]').click()`);
  await sleep(500);
  s = await val(ws, `({hist: document.body.innerHTML.indexOf('История запросов и результатов')>=0})`);
  ok('история запросов и результатов открывается', s && s.hist, s);

  // ================= 2. My Notes AI =================
  await cdpSend(ws, 'Page.navigate', { url: BASE + '/my-notes/' });
  await sleep(2500);
  s = await val(ws, `({
    input: !!document.querySelector('#aiInput'),
    send: !!document.querySelector('#sendBtn'),
    notes: !!document.querySelector('#notesList'),
    settings: !!document.querySelector('#btnSettings'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    inputFont: getComputedStyle(document.querySelector('#aiInput')).fontSize,
    sendH: Math.round(document.querySelector('#sendBtn').getBoundingClientRect().height),
    hasCheckCss: !!document.querySelector('style') && document.querySelector('style').textContent.indexOf('check-item')>=0,
    hasToggle: typeof toggleCheck==='function' && typeof renderChecks==='function'
  })`);
  ok('My Notes: панель ввода AI сразу на входе', s && s.input && s.send && s.notes, s);
  ok('iPhone13: нет горизонтальной прокрутки (My Notes)', s && s.overflow <= 1, s);
  ok('iPhone13: ввод ≥ 16px, кнопка отправки ≥ 44px', s && parseFloat(s.inputFont) >= 16 && s.sendH >= 44, s);
  ok('My Notes: чекбоксы (стили + обработчики) на месте', s && s.hasCheckCss && s.hasToggle, s);

  // чекбоксы: крупные цели нажатия (проверяем разметку рендера)
  s = await val(ws, `(function(){
    S.notes=[{id:'n1',title:'План',category:'Учёба',html:'<p>Группа Эмира</p>',text:'',checks:[{id:'c1',text:'Чтение',done:false},{id:'c2',text:'Эссе',done:true}],createdAt:1,updatedAt:1}];
    render();
    var items=document.querySelectorAll('.check-item');
    var prog=document.querySelector('.check-progress');
    return {
      count: items.length,
      h: items.length?Math.round(items[0].getBoundingClientRect().height):0,
      counter: prog?prog.textContent.replace(/\\s+/g,' ').trim():'',
      doneAtBottom: items.length?items[items.length-1].classList.contains('done'):false
    };
  })()`);
  ok('чекбоксы: счётчик «выполнено/осталось»', s && /1/.test(s.counter||'') && /осталось/.test(s.counter||''), s);
  ok('чекбоксы: элемент ≥ 48px (iPhone13)', s && s.count === 2 && s.h >= 48, s);
  ok('чекбоксы: выполненный пункт внизу', s && s.doneAtBottom, s);

  const pass = results.filter(r => r.pass).length, fail = results.length - pass;
  console.log('--- RESULT: ' + pass + ' pass, ' + fail + ' fail ---');
  ws.close(); chrome.kill(); server.kill();
  setTimeout(() => process.exit(fail ? 1 : 0), 500);
}
main().catch(e => { console.error('TEST ERROR:', e.message); process.exit(1); });
