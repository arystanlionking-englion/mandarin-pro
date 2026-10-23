const { io } = require('socket.io-client');
const URL = process.env.TEST_URL || 'http://127.0.0.1:3000';
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? ' :: ' + JSON.stringify(extra) : ''));
}
function connect() {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false });
    const to = setTimeout(() => reject(new Error('connect timeout')), 8000);
    s.on('connect', () => { clearTimeout(to); resolve(s); });
    s.on('connect_error', (e) => { clearTimeout(to); reject(e); });
  });
}
function once(s, ev, ms = 5000, pred) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { s.off(ev, h); reject(new Error('timeout ' + ev)); }, ms);
    function h(d) {
      if (pred && !pred(d)) return;
      clearTimeout(to); s.off(ev, h); resolve(d);
    }
    s.on(ev, h);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // --- admin login gives token ---
  const admin = await connect();
  const authP = once(admin, 'admin:authenticated', 6000);
  admin.emit('admin:login', { pin: '1234' });
  const ad = await authP;
  ok('admin login returns token', !!ad.adminToken && !!ad.expiresAt);
  const token = ad.adminToken;

  // --- resume on fresh socket without PIN ---
  const admin2 = await connect();
  const rrP = once(admin2, 'admin:resumeResult', 6000);
  const fdP = once(admin2, 'admin:full_data', 6000);
  admin2.emit('admin:resume', { adminToken: token });
  const r = await rrP;
  ok('admin resume success', r && r.success === true);
  const fd = await fdP;
  ok('resume full_data users have archived flag', Array.isArray(fd.users) && fd.users.length > 0 && fd.users.every(u => 'archived' in u), { count: fd.users.length });

  // --- archive / restore ---
  const victim = fd.users.find(u => u.name === 'Аружан') || fd.users.find(u => !u.archived);
  if (!victim) { ok('victim found', false); }
  else {
    const aP = once(admin2, 'admin:userArchived', 6000);
    admin2.emit('admin:archiveUser', { userId: victim.id });
    const ar = await aP;
    ok('archive user', ar.archived === true && ar.userId === victim.id, ar);

    const fd2P = once(admin2, 'admin:full_data', 6000);
    admin2.emit('admin:resume', { adminToken: token });
    const fd2data = await fd2P;
    const now = fd2data.users.find(u => u.id === victim.id);
    ok('archived flag persisted on server', now && now.archived === true);

    const rP = once(admin2, 'admin:userArchived', 6000);
    admin2.emit('admin:restoreUser', { userId: victim.id });
    const rr = await rP;
    ok('restore user', rr.archived === false && rr.userId === victim.id, rr);
  }

  // --- bad token rejected ---
  const admin3 = await connect();
  const badP = once(admin3, 'admin:resumeResult', 6000);
  admin3.emit('admin:resume', { adminToken: 'bogus-token' });
  const br = await badP;
  ok('bad admin token rejected', br && br.success === false);

  // --- non-admin cannot archive ---
  const stu = await connect();
  const pinP = once(stu, 'user:pin_status', 5000);
  stu.emit('user:check_pin', { name: 'Дияра' });
  const pst = await pinP;
  const loggedP = once(stu, 'user:logged_in', 5000);
  if (pst.exists) {
    stu.emit('user:login_with_pin', { userId: pst.userId, pin: '1111' });
  } else {
    const needP = once(stu, 'user:need_pin', 5000);
    stu.emit('user:register', { name: 'Дияра' });
    const np = await needP;
    const lg2 = once(stu, 'user:logged_in', 5000);
    stu.emit('user:set_pin', { userId: np.user.id, pin: '1111' });
    await lg2;
    ok('student registered', true);
  }
  try { await loggedP; } catch (e) { /* may already be logged in via set_pin */ }
  await sleep(200);
  let denied = false;
  const errP = once(stu, 'error', 3000).then(() => { denied = true; }).catch(() => {});
  const archP = once(stu, 'admin:userArchived', 1500).then(() => 'got').catch(() => 'none');
  stu.emit('admin:archiveUser', { userId: 'whatever' });
  const outcome = await Promise.race([archP, errP.then(() => 'err'), sleep(1800).then(() => 'none')]);
  ok('non-admin archive denied', outcome !== 'got');

  console.log('\n===== SUMMARY =====');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' passed');
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
