// Smoke-тест обновления: админ-токены, закрепление прав за аккаунтом, прямые ссылки
const { io } = require('socket.io-client');
const URL = 'http://127.0.0.1:3000';
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
}
function once(sock, ev, ms) {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ms || 6000);
    sock.once(ev, (d) => { clearTimeout(t); res(d); });
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function http(path, opts) {
  const r = await fetch(URL + path, opts);
  const t = await r.text();
  return { status: r.status, text: t, headers: r.headers };
}

(async () => {
  // --- 1. Прямые ссылки: гейт ---
  const mn = await http('/my-notes/');
  ok('GET /my-notes/ → гейт PIN', mn.status === 403 && mn.text.includes('PIN') && mn.text.includes('pb_admin_token'));
  const ao = await http('/ai-office/');
  ok('GET /ai-office/ → гейт PIN', ao.status === 403 && ao.text.includes('PIN') && ao.text.includes('pb_admin_token'));
  const bad = await http('/api/ai-office/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminToken: 'bad' }) });
  ok('auth с мусорным токеном → 403', bad.status === 403);

  // --- 2. Вход администратора по PIN (безопасно: при неверном PIN ничего не меняется) ---
  const admin = io(URL, { transports: ['websocket'] });
  await once(admin, 'connect');
  const authP = once(admin, 'admin:authenticated', 5000);
  admin.emit('admin:login', { pin: '1234' });
  const auth = await authP;
  if (!auth || !auth.success) {
    ok('admin:login (PIN 1234)', false, 'PIN не подошёл — остальные проверки пропущены');
    admin.close();
    const failed = results.filter(r => !r.pass);
    console.log('\n=== ' + (results.length - failed.length) + '/' + results.length + ' passed ===');
    process.exit(failed.length ? 1 : 0);
  }
  ok('admin:login (PIN)', true);
  ok('PIN-вход выдаёт adminToken', !!auth.adminToken);

  // --- 3. Тестовый пользователь ---
  const login = 'SecAdmSmoke' + Date.now().toString().slice(-5);
  const createdP = once(admin, 'admin:createUserResult', 6000);
  admin.emit('admin:createUser', { login, password: 'test1234', pin: '1111', displayName: 'Смоук ДопАдм' });
  const created = await createdP;
  ok('admin:createUser', !!(created && created.success), created && created.message);
  const uid = created && created.user && created.user.id;

  // --- 4. Обычный вход: без прав ---
  const user = io(URL, { transports: ['websocket'] });
  await once(user, 'connect');
  const loginP = once(user, 'user:logged_in', 6000);
  user.emit('user:login_password', { name: login, password: 'test1234' });
  const ulogin = await loginP;
  ok('вход тестового пользователя', !!(ulogin && ulogin.user && ulogin.user.id === uid));
  ok('до назначения adminRights нет', !ulogin.adminRights);

  // --- 5. Назначение доп. администратора → токен в ответе ---
  const grantedP = once(user, 'admin:granted', 6000); // слушатель ДО события
  const setP = once(admin, 'admin:secondaryAdminResult', 6000);
  admin.emit('admin:setSecondaryAdmin', { userId: uid });
  const set = await setP;
  ok('назначен доп. администратор', !!(set && set.success && set.secondaryAdminId === uid), set && { success: set.success });
  ok('в результате есть adminToken', !!(set && set.adminToken), set && { hasToken: !!set.adminToken });

  // --- 6. Целевой сокет получает admin:granted с токеном ---
  const granted = await grantedP;
  ok('admin:granted получен целевым сокетом', !!(granted && granted.adminToken), granted && { hasToken: !!granted.adminToken });

  // --- 7. Токен работает для модулей (AI Office / My Notes) ---
  const tok = (granted && granted.adminToken) || (set && set.adminToken);
  const auth2 = await http('/api/ai-office/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminToken: tok }) });
  ok('/api/ai-office/auth принимает токен аккаунта', auth2.status === 200 && auth2.text.includes('"ok":true'));
  const ao2 = await http('/ai-office/', { headers: { 'Cookie': 'pb_admin=' + tok } });
  ok('GET /ai-office/ с cookie → модуль (не гейт)', ao2.status === 200 && !ao2.text.includes('PIN администратора'));
  const mn2 = await http('/my-notes/', { headers: { 'Cookie': 'pb_admin=' + tok } });
  ok('GET /my-notes/ с cookie → страница модуля', mn2.status === 200 && mn2.text.includes('My Notes AI'));

  // --- 8. Повторный вход под аккаунтом → права автоматически ---
  const user2 = io(URL, { transports: ['websocket'] });
  await once(user2, 'connect');
  const login2P = once(user2, 'user:logged_in', 6000);
  user2.emit('user:login_password', { name: login, password: 'test1234' });
  const ulogin2 = await login2P;
  ok('повторный вход: adminRights автоматически', ulogin2 && ulogin2.adminRights === true);
  ok('повторный вход: выдан adminToken', !!(ulogin2 && ulogin2.adminToken));

  // --- 9. Токен аккаунта — НЕ главный админ (нельзя управлять доп. админами) ---
  const u2tok = ulogin2 && ulogin2.adminToken;
  const user3 = io(URL, { transports: ['websocket'] });
  await once(user3, 'connect');
  const resumeP = once(user3, 'admin:resumeResult', 5000);
  user3.emit('admin:resume', { adminToken: u2tok });
  const resume = await resumeP;
  ok('resume токена аккаунта: main=false', resume && resume.success && resume.main === false, resume && { main: resume.main });

  const denyP = once(user2, 'admin:secondaryAdminResult', 5000);
  user2.emit('admin:setSecondaryAdmin', { userId: uid });
  const deny = await denyP;
  ok('доп. администратор не может назначать других', !!(deny && deny.success === false));

  // --- 10. PIN-токен остаётся главным ---
  const resumeMainP = once(admin, 'admin:resumeResult', 5000);
  admin.emit('admin:resume', { adminToken: auth.adminToken });
  const resumeMain = await resumeMainP;
  ok('resume PIN-токена: main=true', resumeMain && resumeMain.success && resumeMain.main !== false, resumeMain && { main: resumeMain.main });

  // --- 11. Очистка ---
  const rmP = once(admin, 'admin:secondaryAdminResult', 6000);
  admin.emit('admin:setSecondaryAdmin', { userId: null });
  const rm = await rmP;
  ok('снятие доп. администратора', !!(rm && rm.success && rm.removed));
  const archP = once(admin, 'admin:userArchived', 6000);
  admin.emit('admin:archiveUser', { userId: uid });
  const arch = await archP;
  ok('тестовый пользователь в архиве', !!(arch && arch.archived));

  await sleep(300);
  admin.close(); user.close(); user2.close(); user3.close();

  const failed = results.filter(r => !r.pass);
  console.log('\n=== ' + (results.length - failed.length) + '/' + results.length + ' passed ===');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
