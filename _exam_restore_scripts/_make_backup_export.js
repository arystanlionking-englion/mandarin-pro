// Generate the updated v2.2 backup export from the merged database.json
const fs = require('fs');
const cur = JSON.parse(fs.readFileSync('C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/database.json', 'utf8'));

const backup = {
  version: '2.2',
  timestamp: Date.now(),
  users: cur.users,
  history: cur.history,
  messages: cur.messages,
  favorites: cur.favorites,
  notifications: cur.notifications,
  adminHistory: cur.adminHistory,
  groups: cur.groups,
  groupPermissions: cur.groupPermissions,
  coupons: cur.coupons,
  userCoupons: cur.userCoupons,
  couponNotifications: cur.couponNotifications,
  investments: cur.investments,
  purchaseRequests: cur.purchaseRequests,
  quests: cur.quests,
  taskAssignments: cur.taskAssignments,
  duels: cur.duels,
  userXP: cur.userXP,
  sessions: cur.sessions,
  approvalRequests: cur.approvalRequests,
  rests: cur.rests,
  userBlocks: cur.userBlocks,
  qrTerminalHistory: cur.qrTerminalHistory,
  battlePass: cur.battlePass,
  btcPrice: cur.btcPrice,
  investmentPrices: cur.investmentPrices,
  promocodes: cur.promocodes,
  userPromoActivations: cur.userPromoActivations,
  userLists: cur.userLists,
  journal: cur.journal,
  exams: cur.exams,
  testResults: cur.testResults,
  accountRequests: cur.accountRequests,
  securityLog: cur.securityLog,
  auditLog: cur.auditLog,
  globalMode: cur.globalMode,
  maintenanceMode: cur.maintenanceMode,
  guestMode: cur.guestMode,
  savingsGoals: cur.savingsGoals,
  bankQuests: cur.bankQuests,
  virtualBanks: cur.virtualBanks,
  userBankDeposits: cur.userBankDeposits,
  userBankInvestments: cur.userBankInvestments,
  bankHistory: cur.bankHistory,
  qrCodes: cur.qrCodes,
  qrAccounts: cur.qrAccounts,
  qrCodeScans: cur.qrCodeScans,
  couponPricesHalved: cur.couponPricesHalved,
  mafia: cur.mafia,
  party: cur.party,
  guestSessions: cur.guestSessions,
  guestQrTokens: cur.guestQrTokens,
  guestCounter: cur.guestCounter
};

const outPath = 'C:/Users/狮子/qwerty/данные обновлённые 04.11.2026.json';
fs.writeFileSync(outPath, JSON.stringify(backup, null, 2), 'utf-8');

const v = JSON.parse(fs.readFileSync(outPath, 'utf8'));
console.log('written:', outPath);
console.log('version:', v.version);
console.log('users:', v.users.length, '| history:', v.history.length);
console.log('journal.records:', v.journal.records.length, '| journal.students:', v.journal.students.length, '| journal.groups:', v.journal.groups.length);
console.log('exams:', JSON.stringify(v.exams), '| testResults:', v.testResults.length);
console.log('groups:', v.groups.length, '| duels:', v.duels.length, '| taskAssignments:', v.taskAssignments.length);
