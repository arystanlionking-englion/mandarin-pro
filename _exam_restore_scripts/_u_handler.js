const fs = require('fs');
const s = fs.readFileSync('C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/index.html', 'utf8');
const i = s.indexOf("socket.on('user:logged_in'");
console.log('--- user:logged_in handler ---');
console.log(s.slice(i, i + 1200));
console.log();
const j = s.indexOf("socket.on('init'");
console.log('--- init handler ---');
console.log(s.slice(j, j + 900));
console.log();
// find all "U=null" or "U = null" assignments
const re = /U\s*=\s*null/g;
let m;
while ((m = re.exec(s))) {
  console.log('U=null at', m.index, ':', s.slice(m.index - 120, m.index + 60).replace(/\n/g, ' '));
}
