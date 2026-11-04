const fs = require('fs');
const nov04 = JSON.parse(fs.readFileSync('C:/Users/狮子/qwerty/данные за 4 число.json', 'utf8'));
const cur = JSON.parse(fs.readFileSync('C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/database.json', 'utf8'));

// ids of records in both, for array-of-object-with-id fields
function idSet(arr) { return new Set((arr || []).map(x => x && x.id).filter(Boolean)); }

const arrFields = ['users','history','messages','notifications','adminHistory','groups','coupons','userCoupons','couponNotifications','investments','purchaseRequests','quests','taskAssignments','duels','sessions','approvalRequests','rests','userBlocks','qrTerminalHistory','promocodes','userPromoActivations','accountRequests','securityLog','auditLog','savingsGoals','bankQuests','virtualBanks','userBankDeposits','userBankInvestments','bankHistory','qrCodes','qrAccounts','qrCodeScans'];
console.log('=== array fields: nov04-only ids / cur-only ids');
for (const f of arrFields) {
  const a = nov04[f] || [], b = cur[f] || [];
  const ia = idSet(a), ib = idSet(b);
  const onlyA = [...ia].filter(x => !ib.has(x));
  const onlyB = [...ib].filter(x => !ia.has(x));
  if (a.length !== b.length || onlyA.length || onlyB.length) {
    console.log(` ${f}: nov04=${a.length} cur=${b.length} | onlyInNov04=${onlyA.length} onlyInCur=${onlyB.length}`);
    if (onlyA.length && onlyA.length <= 6) onlyA.forEach(id => { const o = a.find(x => x.id === id); console.log('    nov04-only:', id, JSON.stringify(o).slice(0, 100)); });
    if (onlyB.length && onlyB.length <= 6) onlyB.forEach(id => { const o = b.find(x => x.id === id); console.log('    cur-only  :', id, JSON.stringify(o).slice(0, 100)); });
  }
}

// journal deep compare
console.log('\n=== journal:');
for (const k of ['students','records','homework','attendance','homeworkSubmissions','groups']) {
  const a = nov04.journal[k] || [], b = cur.journal[k] || [];
  const ia = idSet(a), ib = idSet(b);
  const onlyA = [...ia].filter(x => !ib.has(x));
  const onlyB = [...ib].filter(x => !ia.has(x));
  console.log(` ${k}: nov04=${a.length} cur=${b.length} | onlyInNov04=${onlyA.length} onlyInCur=${onlyB.length}`);
}
const awA = Object.keys(nov04.journal.awards || {}), awB = Object.keys(cur.journal.awards || {});
console.log(' awards keys: nov04=' + awA.length, 'cur=' + awB.length);
awA.filter(k => !awB.includes(k)).forEach(k => console.log('   nov04-only award:', k, nov04.journal.awards[k]));

// userXP keys
const xpA = Object.keys(nov04.userXP || {}), xpB = Object.keys(cur.userXP || {});
console.log('\n=== userXP: nov04=' + xpA.length, 'cur=' + xpB.length);
xpA.filter(k => !xpB.includes(k)).forEach(k => console.log('   nov04-only xp:', k, JSON.stringify(nov04.userXP[k]).slice(0, 80)));
xpB.filter(k => !xpA.includes(k)).forEach(k => console.log('   cur-only xp:', k, JSON.stringify(cur.userXP[k]).slice(0, 80)));

// verify journal student userIds exist in cur.users
const curUserIds = new Set(cur.users.map(u => u.id));
console.log('\n=== nov04 journal.students userId missing in cur.users:');
nov04.journal.students.forEach(s => { if (s.userId && !curUserIds.has(s.userId)) console.log('   MISSING:', s.name, s.userId); });
console.log(' done');
