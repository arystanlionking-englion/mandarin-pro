const fs = require('fs');
const p = 'C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/_e2e_exam_check/_run2.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace("socket.on('connect_error', e => console.log('[connect_error]', e && e.message ? e.message : e));",
  "socket.on('connect_error', e => console.log('[connect_error]', e && e.message ? e.message : e));\n  socket.on('connect', () => console.log('[client connected]', socket.id));");
fs.writeFileSync(p, s, 'utf8');
console.log('connect logging added:', s.includes('[client connected]'));
