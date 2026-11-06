const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');

// 1) onclick handlers resolve
const re = /onclick="([^"]+)"/g;
const fns = new Set();
let m;
while ((m = re.exec(html))) {
  const calls = m[1].match(/([a-zA-Z_$][\w$]*)\s*\(/g);
  if (calls) calls.forEach(c => fns.add(c.replace(/\s*\($/, '')));
}
const missing = [];
[...fns].sort().forEach(f => {
  const isWindow = html.includes('window.' + f + '=') || html.includes('window.' + f + ' =');
  const isGlobalFn = new RegExp('function\\s+' + f + '\\s*\\(').test(html);
  if (!isWindow && !isGlobalFn) missing.push(f);
});
console.log('onclick functions:', fns.size, '| missing:', missing.length ? missing.join(', ') : 'none');

// 2) new ids referenced from JS exist in HTML
const ids = ['homeStudentOnly','homeAdminOnly','homeNotifList','homeNotifBadge','homeNotifSub',
  'notifCatTabs','secondaryAdminInfo','secAdminList','mSecondaryAdmin','secAdminSearch',
  'bnavDiary','bnavDiaryLabel','bnavCenter','bnavCenterLabel','bnavCenterIcon',
  'secUsersAdminTools','btnUsersActive','btnUsersArchive','btnAccountReq','accountRequestsList',
  'guestModeToggleHome','guestModeLabelHome','maintenanceToggleHome','maintenanceLabelHome'];
const idsMissing = ids.filter(id => !html.includes('id="' + id + '"'));
console.log('required ids missing:', idsMissing.length ? idsMissing.join(', ') : 'none');

// 3) duplicate id check for critical ones
ids.forEach(id => {
  const count = (html.match(new RegExp('id="' + id + '"', 'g')) || []).length;
  if (count > 1) console.log('DUPLICATE id:', id, 'x' + count);
});

// 4) key functions defined
const keyFns = ['updateAdminHome','renderAdminHomeNotifs','renderSecondaryAdminInfo',
  'openSecondaryAdminPicker','confirmSecondaryAdmin','removeSecondaryAdmin','filterSecAdminList',
  'setNotifCat','buildResolvedNotifEl','syncGuestModeUI','syncMaintenanceUI'];
const fnMissing = keyFns.filter(f => {
  const isWindow = html.includes('window.' + f + '=') || html.includes('window.' + f + ' =');
  const isGlobalFn = new RegExp('function\\s+' + f + '\\s*\\(').test(html);
  return !isWindow && !isGlobalFn;
});
console.log('key functions missing:', fnMissing.length ? fnMissing.join(', ') : 'none');

// 5) server handlers exist
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
['admin:setSecondaryAdmin','secondaryAdminId','pinAdminSockets','isMainAdmin',
 'grantSecondaryAdminIfAny','groupIds'].forEach(k => {
  console.log('server has', k, ':', server.includes(k));
});
