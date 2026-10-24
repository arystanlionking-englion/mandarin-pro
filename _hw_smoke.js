/* Тест: ДЗ группы приходит ученику через journal:get */
const { io } = require('socket.io-client');
const URL = process.env.TEST_URL || 'http://127.0.0.1:3000';
function connect() {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false });
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

async function main() {
  const admin = await connect();
  const authP = once(admin, 'admin:authenticated', 6000);
  admin.emit('admin:login', { pin: '1234' });
  await authP;
  console.log('PASS admin login');

  // Create student user
  const created = once(admin, 'admin:createUserResult', 5000);
  const login = 'HwStu' + Date.now().toString(36).slice(-5);
  admin.emit('admin:createUser', { login, password: 'test1234', pin: '3333' });
  const cu = await created;
  if (!cu.success) { console.log('FAIL createUser', cu); process.exit(1); }
  console.log('PASS createUser', cu.user.id);

  // Student login
  const student = await connect();
  const logged = once(student, 'user:logged_in', 5000);
  student.emit('user:login_with_pin', { userId: cu.user.id, pin: '3333' });
  await logged;
  console.log('PASS student login');

  // Admin creates group + student + homework
  // journal:save with groups/students
  const saved = once(student, 'journal:updated', 6000);
  const gid = 'g_' + Date.now().toString(36);
  const sid = 's_' + Date.now().toString(36);
  admin.emit('journal:save', {
    groups: [{ id: gid, name: 'ТестГруппа' }],
    students: [{ id: sid, name: login, groupId: gid, userId: cu.user.id }],
    records: [],
    settings: { reward: 300 },
    links: [{ studentId: sid, userId: cu.user.id }]
  });
  await saved;
  console.log('PASS journal save group+student (student got update)');

  // Admin publishes homework for the group
  const hwSaved = once(admin, 'homework:saved', 5000);
  const studentHwUpdate = once(student, 'journal:updated', 6000, d => d && Array.isArray(d.homework) && d.homework.some(h => h.groupId === gid));
  admin.emit('homework:save', {
    groupId: gid,
    date: new Date().toISOString().slice(0, 10),
    text: '1. Выучить слова\n2. Сделать упражнение',
    studentId: null
  });
  const hwRes = await hwSaved;
  console.log('PASS homework:save', hwRes.ok, hwRes.id);

  // Student should have received the homework via broadcast
  try {
    await studentHwUpdate;
    console.log('PASS student received homework broadcast');
  } catch (e) {
    console.log('WARN student broadcast missed, pulling via journal:get');
  }

  // Student pulls journal — must see homework for their group
  const got = once(student, 'journal:updated', 6000);
  student.emit('journal:get');
  const data = await got;
  const hws = (data.homework || []);
  const match = hws.find(h => h.groupId === gid && !h.studentId);
  console.log((match ? 'PASS' : 'FAIL') + ' student sees group homework', match ? match.text.slice(0, 40) : hws);
  console.log((data.isAdmin === false ? 'PASS' : 'FAIL') + ' student is not admin', data.isAdmin);
  console.log((Array.isArray(data.students) && data.students.length === 1 ? 'PASS' : 'FAIL') + ' student sees self only', (data.students || []).length);

  admin.close(); student.close();
  process.exit(match ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
