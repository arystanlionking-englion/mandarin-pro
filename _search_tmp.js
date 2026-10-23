const fs = require('fs');
const t = JSON.parse(fs.readFileSync(__dirname + '/database.json', 'utf8'));
const names = (t.users || []).map(u => u.name);
console.log('users', names.length, names.slice(0, 20));
for (const n of ['Аружан', 'Дияра', 'Ахмедьяр', 'Айзере', 'Тестовый']) {
  console.log(n, names.includes(n));
}
console.log('has mafia key', !!t.mafia);
