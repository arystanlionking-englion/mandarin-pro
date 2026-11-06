// E2E: дополнительный администратор (T1.1)
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? ' :: ' + JSON.stringify(extra) : ''));
}
function once(sock, ev, ms) {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ms || 5000);
    sock.once(ev, (d) => { clearTimeout(t); res(d); });
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const admin = io(URL, { transports: ['websocket'] });
  await once(admin, 'connect');
  ok('admin socket connected', true);

  // 1) без авторизации — отказ
  const unauth = io(URL, { transports: ['websocket'] });
  await once(unauth, 'connect');
  const unauthResP = once(unauth, 'admin:secondaryAdminResult', 4000);
  unauth.emit('admin:setSecondaryAdmin', { userId: 'x' });
  const unauthRes = await unauthResP;
  ok('setSecondaryAdmin без авторизации отклонён', unauthRes && unauthRes.success === false && /доступ|администратор/i.test(unauthRes.error || ''), unauthRes);

  // 2) вход администратора по PIN
  const authP = once(admin, 'admin:authenticated', 5000);
  admin.emit('admin:login', { pin: '1234' });
  const auth = await authP;
  ok('admin:login (PIN)', !!(auth && auth.success), auth && { firstTime: auth.firstTime });

  // 3) создаём тестового пользователя
  const createdP = once(admin, 'admin:createUserResult', 5000);
  admin.emit('admin:createUser', { login: 'SecAdmTest', password: 'test1234', pin: '1111', displayName: 'Тест ДопАдм' });
  const created = await createdP;
  ok('admin:createUser', !!(created && created.success), created && created.message);
  const uid1 = created && created.user && created.user.id;

  const created2P = once(admin, 'admin:createUserResult', 5000);
  admin.emit('admin:createUser', { login: 'SecAdmTest2', password: 'test1234', pin: '1111' });
  const created2 = await created2P;
  const uid2 = created2 && created2.user && created2.user.id;
  ok('admin:createUser #2', !!(created2 && created2.success));

  // 4) назначаем первого
  const set1P = once(admin, 'admin:secondaryAdminResult', 5000);
  admin.emit('admin:setSecondaryAdmin', { userId: uid1 });
  const set1 = await set1P;
  ok('назначен 1-й доп. администратор', !!(set1 && set1.success && set1.secondaryAdminId === uid1), set1);

  // 5) второго — запрещено
  const set2P = once(admin, 'admin:secondaryAdminResult', 5000);
  admin.emit('admin:setSecondaryAdmin', { userId: uid2 });
  const set2 = await set2P;
  ok('второй доп. администратор отклонён', !!(set2 && set2.success === false), set2);

  // 6) повторное назначение того же — ок
  const set1bP = once(admin, 'admin:secondaryAdminResult', 5000);
  admin.emit('admin:setSecondaryAdmin', { userId: uid1 });
  const set1b = await set1bP;
  ok('повторное назначение того же — ок', !!(set1b && set1b.success), set1b);

  // 7) вход пользователем → adminRights
  const user = io(URL, { transports: ['websocket'] });
  await once(user, 'connect');
  const loginP = once(user, 'user:logged_in', 6000);
  user.emit('user:login_password', { name: 'SecAdmTest', password: 'test1234' });
  const login = await loginP;
  ok('вход доп. администратора по логину/паролю', !!(login && login.user && login.user.id === uid1));
  ok('adminRights=true при входе', login && login.adminRights === true, { adminRights: login && login.adminRights });

  // 8) у него есть admin-доступ (проверяем по ответу admin-события)
  const resP = once(user, 'admin:secondaryAdminResult', 5000);
  user.emit('admin:setSecondaryAdmin', { userId: uid2 }); // попытка назначить — должен отказать (не главный)
  const res = await resP;
  ok('доп. администратор не может назначать других', !!(res && res.success === false), res);

  // 9) обычный пользователь без прав тоже отклоняется
  const user2 = io(URL, { transports: ['websocket'] });
  await once(user2, 'connect');
  const login2P = once(user2, 'user:logged_in', 6000);
  user2.emit('user:login_password', { name: 'SecAdmTest2', password: 'test1234' });
  const login2 = await login2P;
  ok('обычный пользователь: adminRights не выдан', login2 && !login2.adminRights, { adminRights: login2 && login2.adminRights });

  // 10) снятие доп. администратора
  const rmP = once(admin, 'admin:secondaryAdminResult', 5000);
  admin.emit('admin:setSecondaryAdmin', { userId: null });
  const rm = await rmP;
  ok('снятие доп. администратора', !!(rm && rm.success && rm.removed), rm);

  // 11) после снятия — можно назначить второго
  const set3P = once(admin, 'admin:secondaryAdminResult', 5000);
  admin.emit('admin:setSecondaryAdmin', { userId: uid2 });
  const set3 = await set3P;
  ok('после снятия можно назначить другого', !!(set3 && set3.success && set3.secondaryAdminId === uid2), set3);

  // 12) снимаем окончательно (не мусорим в database.json)
  const rm2P = once(admin, 'admin:secondaryAdminResult', 5000);
  admin.emit('admin:setSecondaryAdmin', { userId: null });
  await rm2P;

  // 13) гостю admin-права не даются (isGuest excluded) — проверяем логику через архив
  const archP = once(admin, 'admin:userArchived', 5000);
  admin.emit('admin:archiveUser', { userId: uid1 });
  const arch = await archP;
  ok('пользователь в архиве', !!(arch && arch.archived));

  const setArchP = once(admin, 'admin:secondaryAdminResult', 5000);
  admin.emit('admin:setSecondaryAdmin', { userId: uid1 });
  const setArch = await setArchP;
  ok('нельзя назначить архивного пользователя', !!(setArch && setArch.success === false), setArch);

  // 14) гостевой вход → без adminRights
  // включаем гостевой режим
  const gmP = once(admin, 'guestMode:setResult', 5000);
  admin.emit('admin:guestMode:set', { enabled: true });
  const gm = await gmP;
  ok('гостевой режим включён', !!(gm && gm.success));

  const guest = io(URL, { transports: ['websocket'] });
  await once(guest, 'connect');
  const gLoginP = once(guest, 'user:logged_in', 6000);
  guest.emit('user:guest_login', { name: 'ГостьТест' });
  const gLogin = await gLoginP;
  ok('гостевой вход работает', !!(gLogin && gLogin.user && gLogin.user.isGuest));
  ok('гость: adminRights не выдан', gLogin && !gLogin.adminRights, { adminRights: gLogin && gLogin.adminRights });

  const gmOffP = once(admin, 'guestMode:setResult', 5000);
  admin.emit('admin:guestMode:set', { enabled: false });
  await gmOffP;

  // 15) homework: groupIds сохраняются
  const jP = once(admin, 'journal:updated', 5000);
  admin.emit('journal:get');
  const j = await jP;
  const groups = (j && j.groups) || [];
  ok('journal:get отвечает', !!j);
  if (groups.length >= 2) {
    const hwP = once(admin, 'homework:saved', 6000);
    admin.emit('homework:save', { groupId: groups[0].id, groupIds: [groups[0].id, groups[1].id], date: '2026-11-05', text: 'Тест ДЗ на 2 группы' });
    const hw = await hwP;
    ok('homework:save с несколькими группами', !!(hw && hw.ok), hw);
    ok('в ответе groupIds из 2 групп', hw && Array.isArray(hw.groupIds) && hw.groupIds.length === 2, hw && hw.groupIds);

    // удалить созданное
    if (hw && hw.id) {
      const delP = once(admin, 'homework:deleted', 5000);
      admin.emit('homework:delete', { id: hw.id });
      const del = await delP;
      ok('homework:delete удаляет', !!(del && del.ok), del);
    }
  } else {
    ok('homework:save с несколькими группами', false, 'нужны 2 группы в журнале');
  }

  await sleep(300);
  admin.close(); user.close(); user2.close(); guest.close(); unauth.close();

  const failed = results.filter(r => !r.pass);
  console.log('\n=== ' + (results.length - failed.length) + '/' + results.length + ' passed ===');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
