const fs = require('fs');
const files = {
  oct29: 'C:/Users/狮子/qwerty/данные за 29 число.json',
  oct30: 'C:/Users/狮子/qwerty/данные за 30 число.json',
  nov04: 'C:/Users/狮子/qwerty/данные за 4 число.json',
  cur: 'C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/database.json'
};
for (const [name, f] of Object.entries(files)) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log('===', name, '| duels:', (d.duels || []).length);
  (d.duels || []).forEach((duel, i) => {
    console.log(` duel[${i}]: id=${duel.id} title=${duel.title} status=${duel.status} q=${(duel.questions || []).length}`);
    console.log('  startedAt:', duel.startedAt, 'finishedAt:', duel.finishedAt);
    (duel.participants || []).forEach((p, j) => {
      console.log(`  participant[${j}]: ${p.userName || p.userId} score=${p.score} answers=${JSON.stringify(p.answers)}`);
    });
    if (duel.questions && duel.questions[0]) {
      console.log('  q0:', JSON.stringify(duel.questions[0]));
    }
  });
  console.log();
}
