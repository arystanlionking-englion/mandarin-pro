const fs = require('fs');
const nov04 = JSON.parse(fs.readFileSync('C:/Users/狮子/qwerty/данные за 4 число.json', 'utf8'));
const cur = JSON.parse(fs.readFileSync('C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/database.json', 'utf8'));
const oct29 = JSON.parse(fs.readFileSync('C:/Users/狮子/qwerty/данные за 29 число.json', 'utf8'));
const oct30 = JSON.parse(fs.readFileSync('C:/Users/狮子/qwerty/данные за 30 число.json', 'utf8'));

function counts(d, label) {
  const c = {};
  for (const k of Object.keys(d)) {
    const v = d[k];
    if (Array.isArray(v)) c[k] = 'arr:' + v.length;
    else if (v && typeof v === 'object') {
      if (k === 'exams') c[k] = `exams:${(v.exams || []).length}/attempts:${(v.attempts || []).length}`;
      else if (k === 'journal') c[k] = `journal{records:${(v.records || []).length},students:${(v.students || []).length},groups:${(v.groups || []).length},homework:${(v.homework || []).length},awards:${Object.keys(v.awards || {}).length},attendance:${(v.attendance || []).length},homeworkSubmissions:${(v.homeworkSubmissions || []).length}}`;
      else if (k === 'testResults') c[k] = 'arr:' + (v.length || 0);
      else c[k] = 'obj:' + Object.keys(v).length;
    } else c[k] = typeof v;
  }
  console.log('===', label);
  console.log(JSON.stringify(c, null, 1));
}

counts(oct29, 'oct29');
counts(oct30, 'oct30');
counts(nov04, 'nov04');
counts(cur, 'current database.json');

// users comparison: balance changes
function userMap(d) {
  const m = {};
  (d.users || []).forEach(u => { m[u.id] = { name: (u.firstName || '') + ' ' + (u.lastName || ''), balance: u.balance, xp: u.xp, nick: u.nickname }; });
  return m;
}
const u29 = userMap(oct29), u30 = userMap(oct30), u04 = userMap(nov04), ucur = userMap(cur);
console.log('\n=== user count:', Object.keys(u29).length, Object.keys(u30).length, Object.keys(u04).length, Object.keys(ucur).length);
// balance diffs between nov04 and cur
for (const id of Object.keys(u04)) {
  const a = u04[id], b = ucur[id];
  if (!b) { console.log('ONLY in nov04:', id, a.name); continue; }
  if (a.balance !== b.balance || a.xp !== b.xp) console.log('DIFF', a.name, 'nov04 bal/xp:', a.balance, a.xp, '| cur:', b.balance, b.xp);
}
for (const id of Object.keys(ucur)) {
  if (!u04[id]) console.log('ONLY in cur:', id, ucur[id].name);
}
