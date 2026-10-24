/* Smoke-тест party: создание комнаты + подключение игрока + сброс состояния */
const { io } = require('socket.io-client');
const URL = process.env.TEST_URL || 'http://127.0.0.1:3000';
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? ' :: ' + JSON.stringify(extra).slice(0, 200) : ''));
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

async function main() {
  // --- Admin ---
  const admin = await connect();
  const authP = once(admin, 'admin:authenticated', 6000);
  admin.emit('admin:login', { pin: '1234' });
  await authP;
  ok('admin login', true);

  // --- Create test player via admin ---
  const created = once(admin, 'admin:createUserResult', 5000);
  const loginName = 'PSmoke' + Date.now().toString(36).slice(-5);
  admin.emit('admin:createUser', {
    login: loginName,
    password: 'test1234',
    pin: '2222'
  });
  const cu = await created;
  ok('admin createUser', cu.success === true, cu.message || cu.user);
  const playerLogin = cu.user && cu.user.login ? cu.user.login : loginName;
  const playerUserId = cu.user && cu.user.id ? cu.user.id : null;

  // --- Player login ---
  const player = await connect();
  let loginOk = false;
  if (playerUserId) {
    const logged = once(player, 'user:logged_in', 5000);
    player.emit('user:login_with_pin', { userId: playerUserId, pin: '2222' });
    await logged;
    loginOk = true;
  } else if (playerLogin) {
    const st = once(player, 'user:pin_status', 4000);
    player.emit('user:check_pin', { name: playerLogin });
    const pst = await st;
    const logged = once(player, 'user:logged_in', 5000);
    player.emit('user:login_with_pin', { userId: pst.userId, pin: '2222' });
    await logged;
    loginOk = true;
  }
  ok('player login', loginOk);

  // --- CROC: create room ---
  let adminStateP = once(admin, 'party:state', 5000, d => d && d.mode === 'croc' && d.status === 'lobby' && d.lobbyOpen);
  let playerSeesP = once(player, 'party:state', 5000, d => d && d.mode === 'croc' && d.lobbyOpen);
  admin.emit('party:createRoom', { mode: 'croc' });
  const lobbyState = await adminStateP;
  ok('croc createRoom -> lobby open', lobbyState.status === 'lobby' && lobbyState.lobbyOpen === true, { status: lobbyState.status, lobbyOpen: lobbyState.lobbyOpen });

  // Player sees open lobby (broadcast)
  const playerSees = await playerSeesP;
  ok('player receives croc lobby state', playerSees.lobbyOpen === true);

  // --- Player joins ---
  const joinedP = once(player, 'party:state', 5000, d => d && d.mode === 'croc' && d.me && d.me.inRoom);
  const adminSeesP = once(admin, 'party:state', 5000, d => d && d.mode === 'croc' && d.players && d.players.length > 0);
  player.emit('party:join', { mode: 'croc' });
  const joined = await joinedP;
  ok('player joined croc', joined.me.inRoom === true, joined.me);

  // Admin sees player in list
  const adminSees = await adminSeesP;
  ok('admin sees player in croc lobby', adminSees.players.length > 0);

  // --- Start game ---
  const playingP = once(player, 'party:state', 5000, d => d && d.mode === 'croc' && d.status === 'playing');
  admin.emit('party:start', { mode: 'croc' });
  await playingP;
  ok('croc start -> playing', true);

  // Player should have card (distribution=all by default) via party:myCard or state
  let gotCard = false;
  try {
    const c = await once(player, 'party:myCard', 4000, d => d && d.mode === 'croc' && d.card);
    gotCard = !!c.card;
  } catch (e) {
    // deal manually
    try {
      const c2 = once(player, 'party:myCard', 4000, d => d && d.card);
      admin.emit('party:deal', { mode: 'croc', userId: joined.me.userId });
      await c2;
      gotCard = true;
    } catch (e2) {
      gotCard = false;
    }
  }
  ok('player got card', gotCard);

  // --- BUNKER: old data must not show ---
  const bunkerP = once(admin, 'party:state', 5000, d => d && d.mode === 'bunker' && d.status === 'lobby' && d.lobbyOpen);
  const bunkerPlayerP = once(player, 'party:state', 5000, d => d && d.mode === 'bunker' && d.lobbyOpen);
  admin.emit('party:createRoom', { mode: 'bunker' });
  await bunkerP;
  await bunkerPlayerP.catch(() => {});
  ok('bunker createRoom -> lobby open', true);

  const bJoinP = once(player, 'party:state', 5000, d => d && d.mode === 'bunker' && d.me && d.me.inRoom);
  player.emit('party:join', { mode: 'bunker' });
  await bJoinP;
  ok('player joined bunker', true);

  // Close bunker room -> player should see idle / no old players
  const closedP = once(player, 'party:state', 5000, d => d && d.mode === 'bunker' && d.status === 'idle');
  admin.emit('party:closeRoom', { mode: 'bunker' });
  const closed = await closedP;
  ok('bunker closeRoom -> idle', closed.status === 'idle');
  ok('bunker closed: no stale players', !closed.players || closed.players.length === 0, closed.players);
  ok('bunker closed: me not inRoom', closed.me && closed.me.inRoom === false);
  ok('bunker closed: me.hasCard false', closed.me && closed.me.hasCard === false);

  // --- Close croc ---
  const cClosedP = once(player, 'party:state', 5000, d => d && d.mode === 'croc' && d.status === 'idle');
  admin.emit('party:closeRoom', { mode: 'croc' });
  const cClosed = await cClosedP;
  ok('croc closeRoom -> idle', cClosed.status === 'idle');
  ok('croc closed: me.hasCard false', cClosed.me && cClosed.me.hasCard === false);
  ok('croc closed: no stale players', !cClosed.players || cClosed.players.length === 0);

  // --- Reopen croc: new room must not show old players/cards ---
  const reopenP = once(admin, 'party:state', 5000, d => d && d.mode === 'croc' && d.status === 'lobby' && d.lobbyOpen && d.players.length === 0);
  admin.emit('party:createRoom', { mode: 'croc' });
  const reopen = await reopenP;
  ok('croc reopen -> fresh lobby', reopen.status === 'lobby' && reopen.players.length === 0, reopen.players);

  admin.close();
  player.close();

  const failed = results.filter(r => !r.pass);
  console.log('\n--- SUMMARY ---');
  console.log('total:', results.length, 'failed:', failed.length);
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
