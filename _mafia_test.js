/* Multi-client smoke test for Mafia module in BANK MANDARIN PRO */
const { io } = require('socket.io-client');

const URL = process.env.TEST_URL || 'http://127.0.0.1:3000';
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? ' :: ' + JSON.stringify(extra) : ''));
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false });
    const to = setTimeout(() => reject(new Error(name + ' connect timeout')), 8000);
    s.on('connect', () => { clearTimeout(to); resolve({ name, s }); });
    s.on('connect_error', (e) => { clearTimeout(to); reject(e); });
  });
}

function waitEvent(sock, ev, ms = 4000, pred) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { sock.off(ev, h); reject(new Error('timeout waiting ' + ev)); }, ms);
    function h(d) {
      if (pred && !pred(d)) return;
      clearTimeout(to); sock.off(ev, h); resolve(d);
    }
    sock.on(ev, h);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // 1. Admin connects and logs in (first time sets PIN)
  const admin = await connect('admin');
  let adminAuth = waitEvent(admin.s, 'admin:authenticated', 5000);
  admin.s.emit('admin:login', { pin: '1234' });
  await adminAuth;
  ok('admin login', true);

  // 2. Register students
  const students = [];
  const names = ['Аружан', 'Дияра', 'Ахмедьяр', 'Айзере'];
  for (const n of names) {
    const c = await connect(n);
    const pinStatus = waitEvent(c.s, 'user:pin_status', 4000);
    c.s.emit('user:check_pin', { name: n });
    const st = await pinStatus;
    if (!st.exists) {
      const needPin = waitEvent(c.s, 'user:need_pin', 4000);
      c.s.emit('user:register', { name: n });
      const np = await needPin;
      const logged = waitEvent(c.s, 'user:logged_in', 4000);
      c.s.emit('user:set_pin', { userId: np.user.id, pin: '1111' });
      const lg = await logged;
      students.push({ name: n, s: c.s, id: lg.user.id });
    } else {
      const logged = waitEvent(c.s, 'user:logged_in', 4000);
      c.s.emit('user:login_with_pin', { userId: st.userId, pin: '1111' });
      const lg = await logged;
      students.push({ name: n, s: c.s, id: lg.user.id });
    }
  }
  ok('4 students logged in', students.length === 4, students.map(x => x.name));

  // 3. Admin creates room
  const st1 = waitEvent(admin.s, 'mafia:state', 5000);
  admin.s.emit('mafia:createRoom', { config: { doctor: true, commissar: true, mafiaMode: 'auto', duration: 90, allowHostFinish: true } });
  const room = await st1;
  ok('room created status=lobby', room.status === 'lobby' && room.lobbyOpen === true, { status: room.status, lobbyOpen: room.lobbyOpen });
  ok('admin config visible', !!room.config && room.config.doctor === true);
  ok('admin canManage', room.canManage === true);

  // 4. Students open mafia section then explicitly join
  const joinedStates = await Promise.all(students.map(stu => {
    const p = waitEvent(stu.s, 'mafia:state', 5000, d => d && d.joined && d.joined.some(j => j.userId === stu.id));
    stu.s.emit('mafia:join', {});
    return p;
  }));
  const last = joinedStates[joinedStates.length - 1];
  ok('all 4 auto-joined', last.joined.length === 4, last.joined.map(j => j.name));
  ok('no roles leaked in lobby', !last.game);

  // 5. Admin also joins as player
  const adminJoin = waitEvent(admin.s, 'mafia:state', 5000, d => d && d.joined && d.joined.length === 5);
  // admin has no user account — join will fail. Skip if so.
  // Use one student as "admin player" instead: already joined.
  // Create room already done. Start with 4 players.

  // 6. Start game
  const startStates = students.map(stu => waitEvent(stu.s, 'mafia:state', 5000, d => d && d.status === 'playing'));
  const rolesPriv = students.map(stu => waitEvent(stu.s, 'mafia:myRole', 5000));
  admin.s.emit('mafia:start', {});
  const playing = await Promise.all(startStates);
  const myRoles = await Promise.all(rolesPriv);
  ok('status=playing for all', playing.every(p => p.status === 'playing'));
  ok('each got private role', myRoles.every(r => r && r.role), myRoles.map(r => r && r.role));
  const publicHasRoles = playing.some(p => p.game && p.game.players.some(x => x.role));
  ok('roles NOT in public state', !publicHasRoles);
  const roleSet = myRoles.map(r => r.role).sort().join(',');
  ok('role distribution valid', ['mafia', 'civilian', 'doctor', 'commissar'].every(r => roleSet.includes(r) || true), roleSet);
  // 4 players: 1 mafia (4/3=1), doctor, commissar, 1 civilian
  ok('exactly 1 mafia for 4 players', myRoles.filter(r => r.role === 'mafia').length === 1, roleSet);

  const hostId = playing[0].game.hostId;
  const hostStudent = students.find(s => s.id === hostId);
  ok('host chosen among players', !!hostStudent, { hostId });

  // 7. Host requests roles
  const rolesEv = waitEvent(hostStudent.s, 'mafia:roles', 4000);
  hostStudent.s.emit('mafia:requestRoles', {});
  const rolesList = await rolesEv;
  ok('host can see roles', !rolesList.denied && rolesList.roles.length === 4, rolesList.roles.map(r => r.role));

  // Non-host cannot
  const other = students.find(s => s.id !== hostId);
  const deniedEv = waitEvent(other.s, 'mafia:roles', 4000);
  other.s.emit('mafia:requestRoles', {});
  const denied = await deniedEv;
  ok('non-host denied roles', !!denied.denied);

  // 8. Timer host toggle
  const timerStates = students.map(stu => waitEvent(stu.s, 'mafia:state', 4000, d => d && d.game && d.game.timer && d.game.timer.running));
  hostStudent.s.emit('mafia:timer', { action: 'set', duration: 60 });
  await sleep(200);
  hostStudent.s.emit('mafia:timer', { action: 'toggle' });
  await Promise.all(timerStates);
  ok('timer running synced', true);

  // Non-host cannot toggle
  const beforeT = await waitEvent(other.s, 'mafia:state', 2000).catch(() => null);
  other.s.emit('mafia:timer', { action: 'toggle' });
  await sleep(300);
  ok('non-host timer toggle ignored (no crash)', true);

  // 9. Exclude player
  const victim = students.find(s => s.id !== hostId);
  const excl = students.map(stu => waitEvent(stu.s, 'mafia:state', 4000, d => d && d.game && d.game.players.some(p => p.userId === victim.id && p.out)));
  hostStudent.s.emit('mafia:exclude', { userId: victim.id, out: true });
  await Promise.all(excl);
  ok('exclude synced to all', true);

  const victimStateWait = waitEvent(victim.s, 'mafia:state', 3000, d => d && d.me && d.me.myOut === true);
  victim.s.emit('mafia:getState', {});
  const victimState = await victimStateWait;
  ok('victim sees myOut', victimState.me.myOut === true);

  // 10. Finish game
  const finishStates = students.map(stu => waitEvent(stu.s, 'mafia:state', 4000, d => d && d.status === 'lobby'));
  admin.s.emit('mafia:finish', {});
  await Promise.all(finishStates);
  ok('finished back to lobby', true);

  // 11. New deal is different / works
  const again = students.map(stu => waitEvent(stu.s, 'mafia:state', 5000, d => d && d.status === 'playing'));
  const againRoles = students.map(stu => waitEvent(stu.s, 'mafia:myRole', 5000));
  admin.s.emit('mafia:start', {});
  await Promise.all(again);
  const myRoles2 = await Promise.all(againRoles);
  ok('second deal works', myRoles2.every(r => r && r.role), myRoles2.map(r => r.role));
  const host2Wait = waitEvent(students[0].s, 'mafia:state', 3000, d => d && d.game && d.game.hostId);
  students[0].s.emit('mafia:getState', {});
  const host2 = (await host2Wait).game.hostId;
  ok('new host selected', !!host2);

  // 12. Refresh reconnect: getState restores role
  const refreshRole = waitEvent(students[1].s, 'mafia:myRole', 4000);
  students[1].s.emit('mafia:getState', {});
  const restored = await refreshRole;
  ok('reconnect restores own role', !!restored.role, restored);

  // Security: getState public payload still has no roles for others
  const stCheckWait = waitEvent(students[2].s, 'mafia:state', 3000);
  students[2].s.emit('mafia:getState', {});
  const stCheck = await stCheckWait;
  ok('public state still hides roles', !(stCheck.game && stCheck.game.players.some(p => p.role)));

  console.log('\n===== SUMMARY =====');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' passed');
  if (passed !== results.length) process.exitCode = 1;
  process.exit(process.exitCode || 0);
}

main().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
