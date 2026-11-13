/* Проверка оптимизаций словаря: init-рендер, батчинг фильтров, флаг повторной отрисовки, поиск */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9341;
const APP = 'http://127.0.0.1:3000/dictionary';
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
async function cdpEval(ws, expression, awaitPromise) {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('cdp timeout: ' + expression.slice(0, 80))), 20000);
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
async function val(ws, expr, awaitPromise) {
  const r = await cdpEval(ws, expr, awaitPromise);
  if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result && r.result.value;
}

async function main() {
  // 1) server
  const server = spawn('node', ['server.js'], { cwd: __dirname, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40; i++) {
    try {
      await getJson('http://127.0.0.1:3000/api/parent-view/x').catch(() => {});
      const req = http.get('http://127.0.0.1:3000/dictionary', res => { up = true; res.resume(); });
      req.on('error', () => {});
      await sleep(250);
      if (up) break;
    } catch (e) { await sleep(250); }
  }
  ok('server up on :3000', up);
  if (!up) { server.kill(); process.exit(1); }

  // 2) chrome
  const userDataDir = path.join(__dirname, '.chrome_dict_check');
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + userDataDir,
    '--window-size=390,844',
    'about:blank'
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
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));
  ws.send(JSON.stringify({ id: 3, method: 'Page.navigate', params: { url: APP } }));
  await sleep(2500);

  // Collect page errors
  const errCount = await val(ws, `(() => { return window.__errCount || 0; })()`).catch(() => -1);
  ok('page loaded', await val(ws, `document.readyState`), );

  // 3) data intact
  const dataInfo = await val(ws, `(() => ({
    words: typeof unifiedWords!=='undefined' ? unifiedWords.length : -1,
    wordsRaw: typeof words!=='undefined' ? words.length : -1,
    phrases: typeof phrases!=='undefined' ? phrases.length : -1,
    allPhrases: typeof ALL_PHRASES!=='undefined' ? ALL_PHRASES.length : -1,
    lessons: typeof LESSONS!=='undefined' ? LESSONS.length : -1
  }))()`);
  ok('unifiedWords intact (854)', dataInfo && dataInfo.words === 854, dataInfo);
  ok('ALL_PHRASES built', dataInfo && dataInfo.allPhrases >= dataInfo.phrases, dataInfo && dataInfo.allPhrases);

  // 4) batched lesson filters — optgroups должны содержать option
  const filterInfo = await val(ws, `(() => {
    const lf=document.getElementById('lessonFilter');
    const groups=[...lf.querySelectorAll('optgroup')].map(g=>({label:g.label, opts:g.querySelectorAll('option').length}));
    return { totalOpts: lf.querySelectorAll('option').length, groups: groups, flatOpts: lf.querySelectorAll(':scope > option').length };
  })()`);
  ok('lessonFilter has options', filterInfo && filterInfo.totalOpts > 50, filterInfo);
  ok('lessonFilter optgroups contain options', filterInfo && filterInfo.groups.length >= 3 && filterInfo.groups.every(g => g.opts > 0), filterInfo.groups);

  // 5) отложенный начальный рендер: dictCards заполнен после первого кадра
  await sleep(600);
  const renderInfo = await val(ws, `(() => ({
    cards: document.querySelectorAll('#dictCards .word-card').length,
    dictRendered: typeof dictListRendered!=='undefined' ? dictListRendered : null,
    favItems: document.querySelectorAll('#favCards .fav-card, #favCards > *').length,
    homeActive: document.getElementById('homeView').classList.contains('active')
  }))()`);
  ok('deferred init render produced word cards', renderInfo && renderInfo.cards === 30, renderInfo);
  ok('dictListRendered flag set', renderInfo && renderInfo.dictRendered === true, renderInfo);
  ok('home view is default active', renderInfo && renderInfo.homeActive === true, renderInfo);

  // 6) повторный вход в раздел без перерисовки
  const skipInfo = await val(ws, `(() => {
    const before=document.getElementById('dictCards').innerHTML.length;
    navigate('dictionary');
    const mid=document.getElementById('dictCards').innerHTML.length;
    // сымитируем «ушёл-вернулся» ещё раз
    navigate('home');
    navigate('dictionary');
    const after=document.getElementById('dictCards').innerHTML.length;
    return {before, mid, after};
  })()`);
  ok('re-enter dictionary keeps same DOM (no rebuild)', skipInfo && skipInfo.before === skipInfo.after && skipInfo.before > 1000, skipInfo);

  // 7) поиск фильтрует список
  const searchInfo = await val(ws, `(() => {
    const el=document.getElementById('dictSearch');
    el.value='人';
    resetDictLimit();
    renderDict('人');
    const n=document.querySelectorAll('#dictCards .word-card').length;
    const emptyShown=document.getElementById('dictEmpty').style.display==='block';
    el.value='';
    renderDict('');
    return {matches:n, emptyShown};
  })()`);
  ok('search filters dictionary', searchInfo && searchInfo.matches > 0 && searchInfo.matches < 30, searchInfo);

  // 8) searchInternalDB работает по _sk
  const sdb = await val(ws, `(() => {
    const r=searchInternalDB('好',null);
    return {words:r.words.length, phrases:r.phrases.length};
  })()`);
  ok('searchInternalDB works', sdb && sdb.words > 0, sdb);

  // 9) уроки: повторный показ без пересборки
  const lessonsInfo = await val(ws, `(() => {
    navigate('lessons');
    const before=document.getElementById('lessonsList').innerHTML.length;
    navigate('home');
    navigate('lessons');
    const after=document.getElementById('lessonsList').innerHTML.length;
    return {before, after, key: lessonsListRenderKey};
  })()`);
  ok('re-enter lessons keeps same DOM', lessonsInfo && lessonsInfo.before === lessonsInfo.after && lessonsInfo.before > 1000, lessonsInfo);

  // 10) смена режима всё же перерисовывает уроки
  const modeInfo = await val(ws, `(() => {
    currentMode='hsk1';
    showLessonsList();
    const n=document.querySelectorAll('#lessonsList .lesson-card').length;
    currentMode='all';
    showLessonsList();
    const n2=document.querySelectorAll('#lessonsList .lesson-card').length;
    return {hsk1:n, all:n2};
  })()`);
  ok('mode switch re-renders lessons', modeInfo && modeInfo.hsk1 > 0 && modeInfo.all > modeInfo.hsk1, modeInfo);

  // 11) избранное и фразы инициализированы
  const misc = await val(ws, `(() => ({
    phrase: (document.getElementById('phraseHanzi')||{}).textContent || '',
    currentPhrase: typeof currentPhrase!=='undefined' && !!currentPhrase
  }))()`);
  ok('phrase initialised', misc && misc.currentPhrase, misc);

  const failed = results.filter(r => !r.pass).length;
  console.log(failed === 0 ? 'ALL OK' : 'FAILED: ' + failed);
  try { ws.close(); } catch (e) {}
  chrome.kill();
  server.kill();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
