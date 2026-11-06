// Снимок агрегатов database.json для проверки сохранности данных
const fs = require('fs');
const db = JSON.parse(fs.readFileSync(__dirname + '/database.json', 'utf8'));
const out = {
  users: (db.users || []).length,
  balancesSum: (db.users || []).reduce((a, u) => a + (Number(u.balance) || 0), 0),
  pointsSum: (db.users || []).reduce((a, u) => a + (Number(u.points) || 0), 0),
  history: (db.history || []).length,
  messages: (db.messages || []).length,
  notifications: (db.notifications || []).length,
  exams: ((db.exams && db.exams.exams) || []).length,
  examAttempts: ((db.exams && db.exams.attempts) || []).length,
  testResults: (db.testResults || []).length,
  journalRecords: ((db.journal && db.journal.records) || []).length,
  journalStudents: ((db.journal && db.journal.students) || []).length,
  quests: (db.quests || []).length,
  taskAssignments: (db.taskAssignments || []).length,
  adminHistory: (db.adminHistory || []).length,
  adminLog: (db.auditLog || []).length,
  securityLog: (db.securityLog || []).length,
  aiOfficeRecords: (db.aiOfficeRecords || []).length,
  groups: (db.groups || []).length,
  userNames: (db.users || []).map(u => u.name).sort()
};
console.log(JSON.stringify(out, null, 1));
