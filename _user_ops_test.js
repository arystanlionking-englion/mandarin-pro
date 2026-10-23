/* Test admin user operations: archive, restore, balance ops, delete */
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
  // --- Setup: admin + one student ---
  const admin = await connect();
  const authP = once(admin, 'admin:authenticated', 6000);
  admin.emit('admin:login', { pin: '1234' });
  await authP;
  ok('admin login', true);

  const student = await connect();
  const pinStatus = once(student, 'user:pin_status', 4000);
  student.emit('user:check_pin', { name: 'АрхивТест' });
  const st = await pinStatus;
  let studentId;
  if (!st.exists) {
    const needPin = once(student, 'user:need_pin', 4000);
    student.emit('user:register', { name: 'АрхивТест' });
    const np = await needPin;
    const logged = once(student, 'user:logged_in', 4000);
    student.emit('user:set_pin', { userId: np.user.id, pin: '1111' });
    const lg = await logged;
    studentId = lg.user.id;
  } else {
    const logged = once(student, 'user:logged_in', 4000);
    student.emit('user:login_with_pin', { userId: st.userId, pin: '1111' });
    const lg = await logged;
    studentId = lg.user.id;
  }
  ok('student logged in', !!studentId, { studentId });

  // Reset balance to known state
  await (async () => {
    const p = once(student, 'bank:update', 5000, d => d.me && d.me.balance === 1000);
    admin.emit('admin:editBalance', { targetId: studentId, newBalance: 1000, reason: 'тест сброса' });
    await p;
  })();

  // --- Add money ---
  const balP = once(student, 'bank:update', 5000, d => d.me && d.me.balance === 1500);
  admin.emit('admin:addMoney', { targetId: studentId, amount: 500, message: 'тест начисления', isStartCapital: false });
  const bal1 = await balP;
  ok('addMoney works', bal1.me.balance === 1500, { bal: bal1.me.balance });

  // --- Fine ---
  const fineP = once(student, 'bank:update', 5000, d => d.me && d.me.balance === 1400);
  admin.emit('admin:fine', { targetIds: [studentId], amount: 100, reason: 'тест штрафа' });
  const bal2 = await fineP;
  ok('fine works', bal2.me.balance === 1400, { bal: bal2.me.balance });

  // --- Withdraw ---
  const wdP = once(student, 'bank:update', 5000, d => d.me && d.me.balance === 1350);
  admin.emit('admin:withdraw', { targetId: studentId, amount: 50, reason: 'тест изъятия' });
  const bal3 = await wdP;
  ok('withdraw works', bal3.me.balance === 1350, { bal: bal3.me.balance });

  // --- Edit balance ---
  const editP = once(student, 'bank:update', 5000, d => d.me && d.me.balance === 1000);
  admin.emit('admin:editBalance', { targetId: studentId, newBalance: 1000, reason: 'тест корректировки' });
  const bal4 = await editP;
  ok('editBalance works', bal4.me.balance === 1000, { bal: bal4.me.balance });

  // --- Send notification ---
  const notifP = once(student, 'notification:push', 5000);
  admin.emit('admin:sendNotification', { targetIds: [studentId], title: 'Тест', text: 'Проверка уведомления' });
  const notif = await notifP;
  ok('sendNotification works', !!notif, notif && notif.type);

  // --- Archive ---
  const archP = once(admin, 'admin:userArchived', 5000, d => d.userId === studentId && d.archived === true);
  admin.emit('admin:archiveUser', { userId: studentId });
  const arch = await archP;
  ok('archive works', arch.archived === true);

  // Admin sees archived user in full data
  const fullP = once(admin, 'admin:full_data', 5000);
  admin.emit('admin:resume', { adminToken: 'invalid' }); // will fail, use bank update instead
  // Check via bank:update on next action
  const bankP = once(admin, 'bank:update', 5000);
  admin.emit('admin:addMoney', { targetId: studentId, amount: 1, message: 'probe', isStartCapital: false });
  const bank = await bankP;
  const listed = (bank.users || []).find(u => u.id === studentId);
  ok('archived user present for admin', !!listed, { archived: listed && listed.archived });
  ok('archived flag set in list', listed && listed.archived === true);

  // --- Restore ---
  const restP = once(admin, 'admin:userArchived', 5000, d => d.userId === studentId && d.archived === false);
  admin.emit('admin:restoreUser', { userId: studentId });
  const rest = await restP;
  ok('restore works', rest.archived === false);

  // --- History preserved after archive cycle ---
  const histP = once(admin, 'admin:full_data', 5000);
  // re-login admin to get full data
  admin.emit('admin:login', { pin: '1234' });
  const full = await histP;
  const userHist = (full.history || []).filter(h => h.userId === studentId || h.toId === studentId);
  ok('history preserved', userHist.length >= 4, { count: userHist.length });

  console.log('\n===== SUMMARY =====');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' passed');
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
