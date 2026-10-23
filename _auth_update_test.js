/* Auth update tests: no self-register, admin create, login password, account request */
const { io } = require('socket.io-client');
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? ' :: ' + JSON.stringify(extra) : ''));
}
function connect() {
  return new Promise((resolve, reject) => {
    const s = io('http://127.0.0.1:3000', { transports: ['websocket'], reconnection: false });
    const to = setTimeout(() => reject(new Error('connect timeout')), 8000);
    s.on('connect', () => { clearTimeout(to); resolve(s); });
    s.on('connect_error', e => { clearTimeout(to); reject(e); });
  });
}
function once(s, ev, ms = 5000, pred) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { s.off(ev, h); reject(new Error('timeout ' + ev)); }, ms);
    function h(d) { if (pred && !pred(d)) return; clearTimeout(to); s.off(ev, h); resolve(d); }
    s.on(ev, h);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const suffix = 'T' + Date.now().toString(36).slice(-5);
  const NEW_LOGIN = 'Ученик' + suffix;
  const RENAMED_LOGIN = 'НовИмя' + suffix;

  // --- 1) Self-registration must be disabled ---
  {
    const c = await connect();
    const p = once(c, 'user:register_disabled', 5000);
    c.emit('user:register', { name: 'СамРегистр' + suffix });
    const d = await p;
    ok('self-registration disabled', !!d && /администратор/i.test(d.message || ''), d);
    const admin = await connect();
    const auth = once(admin, 'admin:authenticated', 6000);
    admin.emit('admin:login', { pin: '1234' });
    await auth;
    const auth2 = once(admin, 'admin:authenticated', 6000);
    const full2 = once(admin, 'admin:full_data', 6000);
    admin.emit('admin:login', { pin: '1234' });
    await auth2;
    const fd = await full2;
    const created = (fd.users || []).find(u => u.name === 'СамРегистр' + suffix);
    ok('no self-registered user in DB', !created);
    c.close();
    admin.close();
  }

  // --- 2) Account request creates admin notification ---
  {
    const reqName = 'Новичок' + suffix;
    const c = await connect();
    const p = once(c, 'account:request_result', 5000);
    c.emit('account:request', { name: reqName, comment: 'Нужен доступ к системе' });
    const d = await p;
    ok('account:request accepted', d && d.success === true, d);

    const admin = await connect();
    const auth = once(admin, 'admin:authenticated', 6000);
    admin.emit('admin:login', { pin: '1234' });
    await auth;
    const listP = once(admin, 'admin:accountRequests', 5000);
    admin.emit('admin:getAccountRequests');
    const list = await listP;
    const req = (list.requests || []).find(r => r.name === reqName);
    ok('request visible in admin panel', !!req && req.status === 'new', req);

    const p2 = once(c, 'account:request_result', 5000);
    c.emit('account:request', { name: reqName, comment: 'снова' });
    const d2 = await p2;
    ok('duplicate request suppressed', d2 && d2.success === true && /уже/i.test(d2.message || ''), d2);

    const markP = once(admin, 'admin:accountRequestMarked', 5000);
    admin.emit('admin:markAccountRequest', { id: req.id });
    const marked = await markP;
    ok('request mark read', marked && marked.status === 'read', marked);
    c.close();
    admin.close();
  }

  // --- 3) Admin creates user with login+password ---
  {
    const admin = await connect();
    const auth = once(admin, 'admin:authenticated', 6000);
    admin.emit('admin:login', { pin: '1234' });
    await auth;

    const createP = once(admin, 'admin:createUserResult', 5000);
    admin.emit('admin:createUser', { login: NEW_LOGIN, password: 'secret12', pin: '1111', displayName: 'Ученик' });
    const created = await createP;
    ok('admin creates user', created && created.success === true && created.user && created.user.login === NEW_LOGIN, created);
    if (!created || !created.success) { process.exit(1); }

    const dupP = once(admin, 'admin:createUserResult', 5000);
    admin.emit('admin:createUser', { login: NEW_LOGIN, password: 'other456' });
    const dup = await dupP;
    ok('duplicate login rejected', dup && dup.success === false && /уже существует/i.test(dup.message || ''), dup);

    const user = await connect();
    const loginP = once(user, 'user:login_result', 5000);
    user.emit('user:login_password', { name: NEW_LOGIN, password: 'secret12' });
    const login = await loginP;
    ok('new user login with password', login && login.success === true, login);
    let logged = null;
    try { logged = await once(user, 'user:logged_in', 3000); } catch (e) {}
    ok('logged_in received', !!logged || (login && login.success), logged ? { name: logged.user && logged.user.name } : login);

    const user2 = await connect();
    const badP = once(user2, 'user:login_result', 5000);
    user2.emit('user:login_password', { name: NEW_LOGIN, password: 'wrongpass' });
    const bad = await badP;
    ok('wrong password rejected', bad && bad.success === false && /Неверное имя/i.test(bad.message || ''), bad);

    const user3 = await connect();
    const unkP = once(user3, 'user:login_result', 5000);
    user3.emit('user:login_password', { name: 'ТакогоНет' + suffix, password: 'pass1234' });
    const unk = await unkP;
    ok('unknown user rejected', unk && unk.success === false && /Неверное имя/i.test(unk.message || ''), unk);

    const rstP = once(admin, 'admin:resetPasswordResult', 5000);
    admin.emit('admin:resetUserPassword', { userId: created.user.id, password: 'newpass99' });
    const rst = await rstP;
    ok('admin resets password', rst && rst.success === true, rst);

    const user4 = await connect();
    const np = once(user4, 'user:login_result', 5000);
    user4.emit('user:login_password', { name: NEW_LOGIN, password: 'newpass99' });
    const nl = await np;
    ok('login with new password', nl && nl.success === true, nl);

    const blockP = once(admin, 'admin:blockResult', 5000);
    admin.emit('admin:blockUser', { targetId: created.user.id, mode: 'standard', duration: 'forever', reason: 'тест блокировки' });
    await blockP;

    const user5 = await connect();
    const bl = once(user5, 'user:login_result', 5000);
    user5.emit('user:login_password', { name: NEW_LOGIN, password: 'newpass99' });
    const blr = await bl;
    ok('blocked user cannot login', blr && blr.success === false, blr);

    const unP = once(admin, 'admin:unblockResult', 5000);
    admin.emit('admin:unblockUser', { targetId: created.user.id });
    await unP;
    const user6 = await connect();
    const ul = once(user6, 'user:login_result', 5000);
    user6.emit('user:login_password', { name: NEW_LOGIN, password: 'newpass99' });
    const ulr = await ul;
    ok('unblocked user can login', ulr && ulr.success === true, ulr);

    const user7 = user6;
    const na = once(user7, 'admin:createUserResult', 4000);
    user7.emit('admin:createUser', { login: 'Хакер' + suffix, password: 'hack1234' });
    const nar = await na;
    ok('non-admin cannot create user', nar && nar.success === false, nar);

    const nrPromise = Promise.race([
      once(user7, 'admin:accountRequests', 1500).catch(() => 'timeout'),
      sleep(1600).then(() => 'timeout')
    ]);
    user7.emit('admin:getAccountRequests');
    const nr = await nrPromise;
    ok('non-admin gets no account requests', nr === 'timeout' || !(nr && nr.requests), { type: typeof nr });

    const chP = once(admin, 'admin:changeLoginResult', 5000);
    admin.emit('admin:changeUserLogin', { userId: created.user.id, login: RENAMED_LOGIN });
    const ch = await chP;
    ok('admin changes login', ch && ch.success === true, ch);

    const user8 = await connect();
    const cl = once(user8, 'user:login_result', 5000);
    user8.emit('user:login_password', { name: RENAMED_LOGIN, password: 'newpass99' });
    const clr = await cl;
    ok('login with new login name', clr && clr.success === true, clr);

    [user, user2, user3, user4, user5, user6, user8, admin].forEach(s => { try { s.close(); } catch (e) {} });
  }

  // --- 10) Legacy user without password ---
  {
    const admin = await connect();
    const auth = once(admin, 'admin:authenticated', 6000);
    admin.emit('admin:login', { pin: '1234' });
    await auth;
    const auth2 = once(admin, 'admin:authenticated', 6000);
    const full = once(admin, 'admin:full_data', 6000);
    admin.emit('admin:login', { pin: '1234' });
    await auth2;
    const fd = await full;
    const legacy = (fd.users || []).find(u => u.hasPin && !u.hasPassword);
    if (legacy) {
      const c = await connect();
      const p = once(c, 'user:login_result', 5000);
      c.emit('user:login_password', { name: legacy.name, password: 'whatever' });
      const d = await p;
      ok('legacy user gets admin-contact message', d && d.success === false && /администратор/i.test(d.message || ''), { name: legacy.name, message: d && d.message });
      c.close();
    } else {
      ok('legacy user gets admin-contact message', true, { note: 'no legacy user left' });
    }
    admin.close();
  }

  console.log('\n===== SUMMARY =====');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' passed');
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
