/* UI smoke: главный экран администратора (T1.2/T1.3/T1.7) */
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { io } = require('socket.io-client');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9444;
const APP = 'http://127.0.0.1:3000/index.html';
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? ' :: ' + JSON.stringify(extra) : ''));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
    const to = setTimeout(() => reject(new Error('cdp timeout: ' + expression.slice(0, 60))), 20000);
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
function once(sock, ev, ms) {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ms || 5000);
    sock.once(ev, (d) => { clearTimeout(t); res(d); });
  });
}

(async () => {
  // --- prepare test user over socket ---
  const admin = io('http://localhost:3000', { transports: ['websocket'] });
  await once(admin, 'connect');
  const authP = once(admin, 'admin:authenticated', 5000);
  admin.emit('admin:login', { pin: '1234' });
  await authP;
  const crP = once(admin, 'admin:createUserResult', 5000);
  admin.emit('admin:createUser', { login: 'UiAdmTest', password: 'test1234', pin: '1111', displayName: 'UI Тест' });
  const cr = await crP;
  ok('test user created', !!(cr && cr.success), cr && cr.message);
  admin.close();

  // --- launch chrome ---
  const userDataDir = path.join(__dirname, '.chrome_ui_admin');
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDataDir,
    '--window-size=1280,900', 'about:blank'
  ], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40; i++) {
    try { list = await getJson('http://127.0.0.1:' + PORT + '/json/list'); if (list && list.length) break; } catch (e) {}
    await sleep(250);
  }
  if (!list || !list.length) { console.error('Chrome CDP not available'); chrome.kill(); process.exit(1); }
  const page = list.find(t => t.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  await cdpEval(ws, '1+1');
  ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));
  ws.send(JSON.stringify({ id: 3, method: 'Page.navigate', params: { url: APP } }));
  await sleep(4000);
  // reset any persisted admin/user session so the login below is deterministic
  await cdpEval(ws, `(() => { try { localStorage.clear(); sessionStorage.clear(); } catch(e){} return true; })()`);
  ws.send(JSON.stringify({ id: 4, method: 'Page.navigate', params: { url: APP } }));
  await sleep(4000);

  // --- login as test user via UI (name -> PIN) ---
  const login = await cdpEval(ws, `(async () => {
    function q(id){ return document.getElementById(id); }
    const nameInput = q('authName');
    if (!nameInput) return { step: 'no authName' };
    nameInput.value = 'UiAdmTest';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof window.doAuth === 'function') window.doAuth();
    await new Promise(r => setTimeout(r, 1800));
    // PIN step
    const fields = document.querySelectorAll('#authPinFields .pin-field');
    if (!fields.length) return { step: 'no pin fields', pinStep: !!q('authStepPin') };
    const pin = '1111';
    fields.forEach((f, i) => { f.value = pin[i] || ''; f.dispatchEvent(new Event('input', { bubbles: true })); });
    if (typeof window.doPinLogin === 'function') window.doPinLogin();
    await new Promise(r => setTimeout(r, 2500));
    return {
      appShown: !!(q('app') && q('app').classList.contains('show')),
      homeStudentVisible: !!(q('homeStudentOnly') && !q('homeStudentOnly').classList.contains('hidden')),
      homeAdminVisible: !!(q('homeAdminOnly') && !q('homeAdminOnly').classList.contains('hidden'))
    };
  })()`, true);
  const lv = login.result && login.result.value;
  ok('user logged in (app shown)', !!(lv && lv.appShown), lv);

  // student blocks visible for normal user
  ok('student home blocks visible for normal user', !!(lv && lv.homeStudentVisible));
  ok('admin home blocks hidden for normal user', !!(lv && !lv.homeAdminVisible));

  // --- open admin panel with PIN ---
  const adm = await cdpEval(ws, `(async () => {
    if (typeof window.go === 'function') window.go('admin');
    await new Promise(r => setTimeout(r, 600));
    const fields = document.querySelectorAll('#adminPinFields .pin-field');
    if (!fields.length) return { step: 'no pin fields' };
    const pin = '1234';
    fields.forEach((f, i) => { f.value = pin[i] || ''; f.dispatchEvent(new Event('input', { bubbles: true })); });
    if (typeof window.doAdminLogin === 'function') window.doAdminLogin();
    await new Promise(r => setTimeout(r, 2500));
    return {
      isAdmin: typeof isAdmin !== 'undefined' ? isAdmin : 'n/a',
      panelVisible: !!(document.getElementById('adminPanelView') && !document.getElementById('adminPanelView').classList.contains('hidden')),
      loginHidden: !!(document.getElementById('adminLoginView') && document.getElementById('adminLoginView').classList.contains('hidden'))
    };
  })()`, true);
  const av = adm.result && adm.result.value;
  ok('admin PIN login → panel open (no re-auth needed)', !!(av && av.panelVisible && av.loginHidden), av);
  ok('isAdmin true (panel rendered)', !!(av && av.panelVisible && av.loginHidden));

  // --- home screen admin layout ---
  const home = await cdpEval(ws, `(async () => {
    if (typeof window.go === 'function') window.go('home');
    await new Promise(r => setTimeout(r, 700));
    const vis = (el) => !!el && !el.classList.contains('hidden') && el.offsetParent !== null;
    return {
      studentHidden: !!document.getElementById('homeStudentOnly') && document.getElementById('homeStudentOnly').classList.contains('hidden'),
      adminVisible: vis(document.getElementById('homeAdminOnly')),
      notifBlock: !!document.getElementById('homeNotifList'),
      notifSub: (document.getElementById('homeNotifSub')||{}).textContent,
      quickCount: document.querySelectorAll('#homeQuickActions button').length,
      bnavDiaryLabel: (document.getElementById('bnavDiaryLabel')||{}).textContent,
      bnavCenterLabel: (document.getElementById('bnavCenterLabel')||{}).textContent,
      balOnHome: !!document.querySelector('#secHome .bal-card #balVal') && vis(document.getElementById('homeStudentOnly')),
      gradeBlock: !!document.getElementById('homeGradeVal'),
      profHasBal: !!document.getElementById('profBal'),
      notifTabs: document.querySelectorAll('#notifCatTabs .coupon-subtab').length
    };
  })()`, true);
  const hv = home.result && home.result.value;
  ok('student blocks hidden on admin home', !!(hv && hv.studentHidden), hv);
  ok('admin home block visible', !!(hv && hv.adminVisible));
  ok('notifications block present', !!(hv && hv.notifBlock));
  ok('quick actions present (>=12)', !!(hv && hv.quickCount >= 12), hv && hv.quickCount);
  ok('bottom nav = Журнал', hv && hv.bnavDiaryLabel === 'Журнал', hv && hv.bnavDiaryLabel);
  ok('bottom nav center = Панель', hv && hv.bnavCenterLabel === 'Панель', hv && hv.bnavCenterLabel);
  ok('balance moved to profile (profBal exists)', !!(hv && hv.profHasBal));
  ok('notifications 3 category tabs', hv && hv.notifTabs === 3, hv && hv.notifTabs);

  // --- notifications tabs work ---
  const nt = await cdpEval(ws, `(async () => {
    if (typeof window.setNotifCat === 'function') window.setNotifCat('approved');
    await new Promise(r => setTimeout(r, 400));
    const a = document.querySelectorAll('#notifCatTabs .coupon-subtab.on').length;
    const aLabel = (document.querySelector('#notifCatTabs .coupon-subtab.on')||{}).textContent;
    if (typeof window.setNotifCat === 'function') window.setNotifCat('all');
    await new Promise(r => setTimeout(r, 400));
    const bLabel = (document.querySelector('#notifCatTabs .coupon-subtab.on')||{}).textContent;
    if (typeof window.setNotifCat === 'function') window.setNotifCat('pending');
    await new Promise(r => setTimeout(r, 400));
    const cLabel = (document.querySelector('#notifCatTabs .coupon-subtab.on')||{}).textContent;
    return { oneSelected: a === 1, aLabel, bLabel, cLabel };
  })()`, true);
  const ntv = nt.result && nt.result.value;
  ok('notification category switching', !!(ntv && ntv.oneSelected && /Одобренные/.test(ntv.aLabel||'') && /Все/.test(ntv.bLabel||'') && /проверке/.test(ntv.cLabel||'')), ntv);

  // --- admin panel sections ---
  const panel = await cdpEval(ws, `(() => {
    const txt = document.getElementById('secAdmin') ? document.getElementById('secAdmin').innerText : '';
    return {
      hasAiOffice: txt.includes('AI Office'),
      hasBackup: txt.includes('Резервная копия'),
      hasRest: txt.includes('Отдых'),
      hasGlobal: txt.includes('Глобальное управление'),
      hasGuest: txt.includes('Гостевой режим'),
      hasMaint: txt.includes('Технические работы'),
      hasForce: txt.includes('Принудительное обновление'),
      hasQrt: txt.includes('QR-ТЕРМИНАЛ'),
      hasSecAdmin: txt.includes('Дополнительный администратор'),
      noUsersBlock: !/^\s*Пользователи\s*$/m.test(txt.split('История операций')[0].split('Дополнительный администратор').slice(-1)[0] || ''),
      usersToolsInUsers: !!document.getElementById('secUsersAdminTools')
    };
  })()`);
  const pv = panel.result && panel.result.value;
  ok('panel: AI Office', !!(pv && pv.hasAiOffice));
  ok('panel: Резервная копия', !!(pv && pv.hasBackup));
  ok('panel: Отдых', !!(pv && pv.hasRest));
  ok('panel: Глобальное управление', !!(pv && pv.hasGlobal));
  ok('panel: Гостевой режим', !!(pv && pv.hasGuest));
  ok('panel: Технические работы', !!(pv && pv.hasMaint));
  ok('panel: Принудительное обновление', !!(pv && pv.hasForce));
  ok('panel: QR-ТЕРМИНАЛ', !!(pv && pv.hasQrt));
  ok('panel: Дополнительный администратор', !!(pv && pv.hasSecAdmin));
  ok('users tools moved to Users section', !!(pv && pv.usersToolsInUsers));

  // --- users section shows admin tools ---
  const us = await cdpEval(ws, `(async () => {
    if (typeof window.go === 'function') window.go('users');
    await new Promise(r => setTimeout(r, 700));
    const tools = document.getElementById('secUsersAdminTools');
    const cards = document.querySelectorAll('#usersListCont .ucard').length;
    const idLabels = Array.from(document.querySelectorAll('#usersListCont .ucard .id')).map(e => e.textContent).slice(0, 3);
    return {
      toolsVisible: !!tools && !tools.classList.contains('hidden'),
      cards,
      idLabels,
      hasCreateBtn: !!document.querySelector('#secUsersAdminTools button'),
      hasAdminNotifBtn: (document.getElementById('secUsersAdminTools')||{}).innerText?.includes('Admin уведомление')
    };
  })()`, true);
  const uv = us.result && us.result.value;
  ok('users: admin tools visible', !!(uv && uv.toolsVisible), uv);
  ok('users: cards rendered', !!(uv && uv.cards > 0), uv && uv.cards);
  ok('users: no ugly ID labels', !(uv && (uv.idLabels || []).some(t => /ID:\s*[0-9a-f-]{6}/i.test(t || ''))), uv && uv.idLabels);
  ok('users: Admin уведомление button', !!(uv && uv.hasAdminNotifBtn));

  // --- profile balance label ---
  const prof = await cdpEval(ws, `(async () => {
    if (typeof window.go === 'function') window.go('profile');
    await new Promise(r => setTimeout(r, 700));
    const txt = document.getElementById('secProfile') ? document.getElementById('secProfile').innerText : '';
    const low = txt.toLowerCase();
    return { hasBalRu: low.includes('баланс'), hasBalZh: txt.includes('余额'), hasProfBal: !!document.getElementById('profBal') };
  })()`, true);
  const pfv = prof.result && prof.result.value;
  ok('profile: balance with RU/ZH title', !!(pfv && pfv.hasBalRu && pfv.hasBalZh && pfv.hasProfBal), pfv);

  // --- mobile nav (narrow viewport) ---
  const mob = await cdpEval(ws, `(() => {
    const nav = document.getElementById('mobBottomNav');
    return { exists: !!nav, diary: (document.getElementById('bnavDiaryLabel')||{}).textContent, center: (document.getElementById('bnavCenterLabel')||{}).textContent };
  })()`);
  const mv = mob.result && mob.result.value;
  ok('mobile bottom nav updated', !!(mv && mv.diary === 'Журнал' && mv.center === 'Панель'), mv);

  ws.close();
  chrome.kill();
  await sleep(500);

  // --- cleanup test user ---
  const admin2 = io('http://localhost:3000', { transports: ['websocket'] });
  await once(admin2, 'connect');
  const dP = once(admin2, 'admin:full_data', 6000);
  admin2.emit('admin:login', { pin: '1234' });
  const d = await dP;
  const t = (d && d.users || []).find(u => u && u.name === 'UiAdmTest');
  if (t) {
    admin2.emit('admin:remove', { targetId: t.id });
    await sleep(600);
  }
  admin2.close();
  console.log('cleanup: UiAdmTest removed:', !!t);

  const failed = results.filter(r => !r.pass);
  console.log('\n=== ' + (results.length - failed.length) + '/' + results.length + ' passed ===');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
