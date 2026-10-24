const fs = require('fs');
const base = 'C:/Users/狮子/qwerty/personal-bank 60 18,09,2026/';
const html = fs.readFileSync(base + 'index.html', 'utf8');
const s = fs.readFileSync(base + 'server.js', 'utf8');
const j = fs.readFileSync(base + 'journal.js', 'utf8');
const checks = [
  ['server: homework:submit', s.includes("socket.on('homework:submit'")],
  ['server: homework:review', s.includes("socket.on('homework:review'")],
  ['server: homeworkSubmissions in publicJournal admin', s.includes('homeworkSubmissions: j.homeworkSubmissions')],
  ['server: student filter own submissions', s.includes('s.studentId === myId')],
  ['server: submissions persisted in journal', s.includes('Array.isArray(db.journal.homeworkSubmissions)')],
  ['journal: emptyDb has submissions', j.includes('homeworkSubmissions: []')],
  ['journal: applyServerData submissions', j.includes('data.homeworkSubmissions')],
  ['journal: student submit form', j.includes('data-hwsub')],
  ['journal: getData exposes submissions', j.includes('getData: function')],
  ['html: hwReviewWrap', html.includes('id="hwReviewWrap"')],
  ['html: renderHwReview', html.includes('function renderHwReview')],
  ['html: hwReviewSubmit', html.includes('hwReviewSubmit')],
  ['html: approve/reject buttons', html.includes('Одобрить') && html.includes('Отказать')],
  ['html: reject requires comment', html.includes("status==='rejected'&&!comment")],
  ['html: status badges', html.includes('hw-badge')],
  ['html: filter tabs', html.includes('setHwReviewFilter')],
  ['html: wide layout CSS', html.includes('.hw-review-wrap') && (html.includes('main-wide') || html.includes('max-width:1400px') || html.includes('max-width:1200px'))],
  ['html: mobile responsive', html.includes('@media(max-width:640px)') && html.includes('.hw-actions')],
  ['html: no horizontal scroll', html.includes('overflow-x:hidden') && html.includes('word-break:break-word')],
  ['html: answer scrollable', html.includes('overflow-y:auto') && html.includes('hw-block-body')],
  ['html: homework:reviewed handler', html.includes("socket.on('homework:reviewed'")],
  ['html: BP.homeworkSubmit', html.includes('homeworkSubmit:function')],
  ['html: BP.homeworkReview', html.includes('homeworkReview:function')],
];
let fail = 0;
for (const [n, ok] of checks) {
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + n);
  if (!ok) fail++;
}

// Data flow simulation
function upsertSub(list, homeworkId, studentId, answer) {
  const next = list.slice();
  const i = next.findIndex(s => s.homeworkId === homeworkId && s.studentId === studentId);
  const now = 'T';
  if (i >= 0) {
    if (next[i].status && next[i].status !== 'pending') return next; // no resubmit after review
    next[i] = Object.assign({}, next[i], { answer, updatedAt: now });
  } else {
    next.push({ id: 's' + next.length, homeworkId, studentId, answer, status: 'pending', adminComment: '', createdAt: now, reviewedAt: null });
  }
  return next;
}
function reviewSub(list, id, status, comment) {
  const next = list.slice();
  const i = next.findIndex(s => s.id === id);
  if (i < 0) return next;
  next[i] = Object.assign({}, next[i], { status, adminComment: comment || '', reviewedAt: 'R' });
  return next;
}
let subs = [];
subs = upsertSub(subs, 'hw1', 'st1', 'Answer A');
subs = upsertSub(subs, 'hw1', 'st1', 'Answer A2'); // resubmit while pending
console.log((subs[0].answer === 'Answer A2' && subs.length === 1 ? 'OK  ' : 'FAIL') + ' resubmit while pending');
subs = reviewSub(subs, subs[0].id, 'rejected', 'need more detail');
console.log((subs[0].status === 'rejected' && subs[0].adminComment === 'need more detail' ? 'OK  ' : 'FAIL') + ' reject with comment');
subs = upsertSub(subs, 'hw1', 'st1', 'try again');
console.log((subs[0].status === 'rejected' && subs[0].answer === 'Answer A2' ? 'OK  ' : 'FAIL') + ' no resubmit after review');
subs = upsertSub(subs, 'hw1', 'st2', 'Answer B');
console.log((subs.length === 2 ? 'OK  ' : 'FAIL') + ' multiple students');
const pending = subs.filter(s => s.status === 'pending');
const done = subs.filter(s => s.status !== 'pending');
console.log((pending.length === 1 && done.length === 1 ? 'OK  ' : 'FAIL') + ' status filter works');

process.exit(fail ? 1 : 0);
