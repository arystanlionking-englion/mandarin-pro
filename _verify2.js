const fs = require('fs');
const h = fs.readFileSync('C:/Users/狮子/qwerty/personal-bank 60 18,09,2026/index.html', 'utf8');
const a = h.indexOf('window.reloadDictionary=function');
const b = h.indexOf('window.doAuth=function');
if (a < 0 || b < 0) { console.log('markers not found', a, b); process.exit(1); }
const code = h.slice(a, b);
try { new Function(code); console.log('dict open/close JS OK, len', code.length); }
catch (e) { console.log('SYNTAX FAIL', e.message); process.exit(1); }

const c = h.indexOf("if(s==='dictionary'){");
const d = h.indexOf("if(s==='notifications'){");
if (c < 0 || d < 0) { console.log('go markers not found', c, d); process.exit(1); }
try { new Function('s', "const $=id=>document.getElementById(id);" + h.slice(c, d)); console.log('go dictionary branch OK'); }
catch (e) { console.log('go SYNTAX FAIL', e.message); process.exit(1); }

// journal.js renderDiary extract check already done via new Function on whole file
const journal = fs.readFileSync('C:/Users/狮子/qwerty/personal-bank 60 18,09,2026/journal.js', 'utf8');
if (!journal.includes('Домашнее задание</div>')) { console.log('FAIL diary hw title'); process.exit(1); }
if (!journal.includes('hwForStudent(s)')) { console.log('FAIL diary uses hwForStudent'); process.exit(1); }
console.log('diary homework section present');

// party.js: ensure createRoom emits correct event and htmlLobby has create button
const party = fs.readFileSync('C:/Users/狮子/qwerty/personal-bank 60 18,09,2026/party.js', 'utf8');
if (!party.includes('data-act="createRoom"')) { console.log('FAIL createRoom button'); process.exit(1); }
if (!party.includes("emit('party:createRoom'")) { console.log('FAIL createRoom emit'); process.exit(1); }
console.log('party createRoom UI + emit present');
console.log('ALL SYNTAX OK');
