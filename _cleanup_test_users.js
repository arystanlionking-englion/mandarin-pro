// Cleanup: remove guest test user
const { io } = require('socket.io-client');
function once(sock, ev, ms) {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ms || 5000);
    sock.once(ev, (d) => { clearTimeout(t); res(d); });
  });
}
(async () => {
  const admin = io('http://localhost:3000', { transports: ['websocket'] });
  await once(admin, 'connect');
  const dP = once(admin, 'admin:full_data', 6000);
  admin.emit('admin:login', { pin: '1234' });
  const d = await dP;
  const t = (d && d.users || []).find(u => u && u.name === 'ГостьТест');
  if (t) {
    admin.emit('admin:remove', { targetId: t.id });
    await new Promise(r => setTimeout(r, 800));
    console.log('removed guest', t.id);
  } else console.log('guest not found');
  admin.close();
})().catch(e => { console.error('FATAL', e); process.exit(2); });
