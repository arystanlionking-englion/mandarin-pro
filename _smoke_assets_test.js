const { io } = require('socket.io-client');
const URL = 'http://127.0.0.1:3000';
function once(sock, ev, ms) {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ms || 6000);
    sock.once(ev, (d) => { clearTimeout(t); res(d); });
  });
}
(async () => {
  const admin = io(URL, { transports: ['websocket'] });
  await once(admin, 'connect');
  const authP = once(admin, 'admin:authenticated', 5000);
  admin.emit('admin:login', { pin: '1234' });
  const auth = await authP;
  if (!auth || !auth.success) { console.log('PIN FAIL'); process.exit(1); }
  const tok = auth.adminToken;
  const cookie = { 'Cookie': 'pb_admin=' + tok };
  for (const p of ['/ai-office/', '/ai-office/main.js', '/ai-office/styles.css', '/ai-office/worker.js']) {
    const r = await fetch(URL + p, { headers: cookie });
    const t = await r.text();
    const marker = p.endsWith('main.js') ? ('homeHTML:' + (t.indexOf('function homeHTML') >= 0) + ' hero:' + (t.indexOf('hero-form') >= 0) + ' homeBtn:' + (t.indexOf("case'home'") >= 0))
      : p.endsWith('styles.css') ? ('hero-css:' + (t.indexOf('hero-form') >= 0))
        : ('len:' + t.length + ' gate:' + t.includes('PIN администратора'));
    console.log(p, r.status, marker);
  }
  // страница модуля My Notes
  const mn = await fetch(URL + '/my-notes/', { headers: cookie });
  const mnt = await mn.text();
  console.log('/my-notes/', mn.status, 'len:' + mnt.length, 'ui:' + mnt.includes('My Notes AI'), 'viewport:' + mnt.includes('viewport'));
  admin.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
