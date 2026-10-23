/* Targeted test: admin panel visible in playing state when admin is not a player */
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
    function h(d) { if (pred && !pred(d)) return; clearTimeout(to); s.off(ev, h); resolve(d); }
    s.on(ev, h);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Admin login
  const admin = await connect();
  const authP = once(admin, 'admin:authenticated', 6000);
  admin.emit('admin:login', { pin: '1234' });
  await authP;
  ok('admin login', true);

  // Register 4 students
  const names = ['ТестА', 'ТестБ', 'ТестВ', 'ТестГ'];
  const students = [];
  for (const n of names) {
    const c = await connect();
    const pinStatus = once(c, 'user:pin_status', 4000);
    c.emit('user:check_pin', { name: n });
    const st = await pinStatus;
    if (!st.exists) {
      const needPin = once(c, 'user:need_pin', 4000);
      c.emit('user:register', { name: n });
      const np = await needPin;
      const logged = once(c, 'user:logged_in', 4000);
      c.emit('user:set_pin', { userId: np.user.id, pin: '1111' });
      const lg = await logged;
      students.push({ name: n, s: c, id: lg.user.id });
    } else {
      const logged = once(c, 'user:logged_in', 4000);
      c.emit('user:login_with_pin', { userId: st.userId, pin: '1111' });
      const lg = await logged;
      students.push({ name: n, s: c, id: lg.user.id });
    }
  }
  ok('4 students', students.length === 4);

  // Create room
  const st1 = once(admin, 'mafia:state', 5000);
  admin.emit('mafia:createRoom', { config: { doctor: true, commissar: true, mafiaMode: 'auto', duration: 90 } });
  await st1;

  // Students join
  await Promise.all(students.map(stu => {
    const p = once(stu.s, 'mafia:state', 5000, d => d && d.joined && d.joined.some(j => j.userId === stu.id));
    stu.s.emit('mafia:join', {});
    return p;
  }));
  ok('students joined', true);

  // Start game
  const playingP = students.map(stu => once(stu.s, 'mafia:state', 5000, d => d && d.status === 'playing'));
  const adminPlaying = once(admin, 'mafia:state', 5000, d => d && d.status === 'playing');
  admin.emit('mafia:start', {});
  await Promise.all([...playingP, adminPlaying]);
  ok('game playing', true);

  // Admin gets state — must have canManage=true even though admin is NOT a player
  const adminState = once(admin, 'mafia:state', 5000);
  admin.emit('mafia:getState', {});
  const as = await adminState;
  ok('admin canManage in playing state', as.canManage === true, { canManage: as.canManage });
  ok('admin me.isAdmin in playing state', as.me && as.me.isAdmin === true);
  ok('admin is NOT a player', as.me && as.me.isPlayer === false);
  ok('admin canFinish', as.canFinish === true);
  ok('game has real players', as.game && as.game.players && as.game.players.length === 4);

  // Admin can finish the game
  const finishP = students.map(stu => once(stu.s, 'mafia:state', 5000, d => d && d.status === 'lobby'));
  admin.emit('mafia:finish', {});
  await Promise.all(finishP);
  ok('admin finished game from non-player state', true);

  // Reset room
  const resetP = once(admin, 'mafia:state', 5000, d => d && d.status === 'idle');
  admin.emit('mafia:reset', {});
  await resetP;
  ok('admin reset room to idle', true);

  // Verify config is back in idle state for admin
  const idleState = once(admin, 'mafia:state', 5000);
  admin.emit('mafia:getState', {});
  const is = await idleState;
  ok('idle state has config for admin', !!is.config, { hasConfig: !!is.config, canManage: is.canManage });

  // Non-admin student gets NO config
  const stuState = once(students[0].s, 'mafia:state', 5000);
  students[0].s.emit('mafia:getState', {});
  const ss = await stuState;
  ok('student does NOT get config', ss.config === undefined);
  ok('student canManage is false', ss.canManage === false);

  console.log('\n===== SUMMARY =====');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' passed');
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
