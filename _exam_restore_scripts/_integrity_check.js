const fs = require('fs');
const before = JSON.parse(fs.readFileSync('C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/_backup_before_exam_restore_2026-11-04/database.json', 'utf8'));
const after = JSON.parse(fs.readFileSync('C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/database.json', 'utf8'));
function idSet(a) { return new Set((a || []).map(x => x && x.id).filter(Boolean)); }
const checks = [];
const ub = {}, ua = {};
(before.users || []).forEach(u => ub[u.id] = JSON.stringify([u.name, u.balance, u.xp, u.pinHash, u.passwordHash, u.role, u.archived]));
(after.users || []).forEach(u => ua[u.id] = JSON.stringify([u.name, u.balance, u.xp, u.pinHash, u.passwordHash, u.role, u.archived]));
let userDiff = 0;
for (const id of Object.keys(ub)) { if (ub[id] !== ua[id]) { userDiff++; console.log('USER CHANGED:', id); } }
checks.push('users changed: ' + userDiff + ' (before=' + Object.keys(ub).length + ' after=' + Object.keys(ua).length + ')');
for (const f of ['history', 'messages', 'notifications', 'adminHistory', 'coupons', 'userCoupons', 'couponNotifications', 'investments', 'purchaseRequests', 'quests', 'duels', 'sessions', 'rests', 'userBlocks', 'qrTerminalHistory', 'promocodes', 'userPromoActivations', 'accountRequests', 'securityLog', 'auditLog', 'savingsGoals', 'virtualBanks', 'userBankDeposits', 'userBankInvestments', 'bankHistory', 'qrCodes', 'qrAccounts', 'qrCodeScans', 'testResults', 'taskAssignments', 'approvalRequests']) {
  const b = idSet(before[f]), a = idSet(after[f]);
  const removed = [...b].filter(x => !a.has(x));
  const added = [...a].filter(x => !b.has(x));
  if (removed.length || added.length) checks.push(f + ': removed=' + removed.length + ' added=' + added.length);
}
checks.forEach(c => console.log(' ', c));
for (const k of ['btcPrice', 'couponPricesHalved', 'guestCounter']) console.log(k + ':', JSON.stringify(before[k]), '->', JSON.stringify(after[k]));
console.log('battlePass same:', JSON.stringify(before.battlePass) === JSON.stringify(after.battlePass));
console.log('investmentPrices same:', JSON.stringify(before.investmentPrices) === JSON.stringify(after.investmentPrices));
console.log('exams before:', JSON.stringify(before.exams), '-> after:', JSON.stringify(after.exams));
console.log('journal before:', JSON.stringify({ s: before.journal.students.length, r: before.journal.records.length, g: before.journal.groups.length }), '-> after:', JSON.stringify({ s: after.journal.students.length, r: after.journal.records.length, g: after.journal.groups.length }));
