// Merge lost learning-results data from "данные за 4 число.json" (04.11.2026) into database.json.
// STRICTLY ADDITIVE: never deletes or overwrites existing entries; only adds missing ones by id.
const fs = require('fs');

const CUR_PATH = 'C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/database.json';
const SRC_PATH = 'C:/Users/狮子/qwerty/данные за 4 число.json';

const cur = JSON.parse(fs.readFileSync(CUR_PATH, 'utf8'));
const src = JSON.parse(fs.readFileSync(SRC_PATH, 'utf8'));
const log = [];

function mergeById(dstArr, srcArr, label) {
  if (!Array.isArray(dstArr) || !Array.isArray(srcArr)) { log.push(label + ': SKIP (not array)'); return; }
  const have = new Set(dstArr.map(x => x && x.id).filter(Boolean));
  let added = 0;
  for (const item of srcArr) {
    if (!item || !item.id || have.has(item.id)) continue;
    dstArr.push(item);
    have.add(item.id);
    added++;
  }
  log.push(`${label}: +${added} (src=${srcArr.length}, dst now=${dstArr.length})`);
}

// 1. journal: students / groups / records / homework / awards / attendance / homeworkSubmissions
if (!cur.journal || typeof cur.journal !== 'object') cur.journal = {};
for (const k of ['students', 'groups', 'records', 'homework', 'attendance', 'homeworkSubmissions']) {
  if (!Array.isArray(cur.journal[k])) cur.journal[k] = [];
  mergeById(cur.journal[k], (src.journal || {})[k] || [], 'journal.' + k);
}
if (!cur.journal.awards || typeof cur.journal.awards !== 'object') cur.journal.awards = {};
if (!cur.journal.settings) cur.journal.settings = (src.journal || {}).settings || { reward: 300 };
{
  let added = 0;
  const sAw = (src.journal || {}).awards || {};
  for (const key of Object.keys(sAw)) {
    if (!(key in cur.journal.awards)) { cur.journal.awards[key] = sAw[key]; added++; }
  }
  log.push(`journal.awards: +${added} (src=${Object.keys(sAw).length}, dst now=${Object.keys(cur.journal.awards).length})`);
}

// 2. top-level groups (same real groups as journal.groups)
if (!Array.isArray(cur.groups)) cur.groups = [];
mergeById(cur.groups, src.groups || [], 'groups');

// 3. userXP (points must not be lost)
if (!cur.userXP || typeof cur.userXP !== 'object') cur.userXP = {};
{
  let added = 0;
  for (const k of Object.keys(src.userXP || {})) {
    if (!(k in cur.userXP)) { cur.userXP[k] = src.userXP[k]; added++; }
  }
  log.push(`userXP: +${added} keys`);
}

// 4. taskAssignments: nested submissions (student work results)
{
  let added = 0;
  for (const st of (src.taskAssignments || [])) {
    const dstTask = (cur.taskAssignments || []).find(t => t && t.id === st.id);
    if (!dstTask) { log.push(`taskAssignments ${st.id}: task missing in current, skipped`); continue; }
    if (!Array.isArray(dstTask.submissions)) dstTask.submissions = [];
    const have = new Set(dstTask.submissions.map(x => x && x.id).filter(Boolean));
    for (const sub of (st.submissions || [])) {
      if (!sub || !sub.id || have.has(sub.id)) continue;
      dstTask.submissions.push(sub);
      have.add(sub.id);
      added++;
    }
  }
  log.push(`taskAssignments.submissions: +${added}`);
}

// 5. approvalRequests (pending/approved student submissions)
if (!Array.isArray(cur.approvalRequests)) cur.approvalRequests = [];
mergeById(cur.approvalRequests, src.approvalRequests || [], 'approvalRequests');

// 6. quests: nested submissions (safety — should already match)
{
  let added = 0;
  for (const q of (src.quests || [])) {
    const dstQ = (cur.quests || []).find(x => x && x.id === q.id);
    if (!dstQ) continue;
    if (!Array.isArray(dstQ.submissions)) dstQ.submissions = [];
    const have = new Set(dstQ.submissions.map(x => x && x.id).filter(Boolean));
    for (const sub of (q.submissions || [])) {
      if (!sub || !sub.id || have.has(sub.id)) continue;
      dstQ.submissions.push(sub);
      added++;
    }
  }
  log.push(`quests.submissions: +${added}`);
}

// ---- write back (same formatting as saveDB) ----
fs.writeFileSync(CUR_PATH, JSON.stringify(cur, null, 2), 'utf-8');

console.log('MERGE LOG:');
log.forEach(l => console.log(' ', l));
console.log('\nWritten:', CUR_PATH);

// ---- verification ----
const v = JSON.parse(fs.readFileSync(CUR_PATH, 'utf8'));
console.log('\nVERIFY journal:', JSON.stringify({
  students: v.journal.students.length,
  groups: v.journal.groups.length,
  records: v.journal.records.length,
  homework: v.journal.homework.length,
  awards: Object.keys(v.journal.awards).length
}));
console.log('VERIFY groups:', v.groups.length, '| userXP:', Object.keys(v.userXP).length);
console.log('VERIFY exams:', JSON.stringify(v.exams), '| testResults:', v.testResults.length);
console.log('VERIFY users:', v.users.length, '| history:', v.history.length, '| duels:', v.duels.length);
