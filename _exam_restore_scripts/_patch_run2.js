const fs = require('fs');
const p = 'C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/_e2e_exam_check/_run2.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace("socket.waitEvent = (ev, timeout = 6000)", "socket.waitEvent = (ev, timeout = 10000)");
s = s.replace("socket.on('connect_error', e => console.log('[connect_error]', e && e.message ? e.message : e));", "");
s = s.replace("const socket = io('http://localhost:' + PORT, { transports: ['websocket'] });",
  "const socket = io('http://localhost:' + PORT, { transports: ['websocket'] });\n  socket.on('connect_error', e => console.log('[connect_error]', e && e.message ? e.message : e));");
s = s.replace("let server = startServer();\n  await sleep(1800);", "let server = startServer();\n  await sleep(2500);");
s = s.replace("server = startServer();\n  await sleep(1800);", "server = startServer();\n  await sleep(2500);");
fs.writeFileSync(p, s, 'utf8');
console.log('patched');
