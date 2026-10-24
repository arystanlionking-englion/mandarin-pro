const fs = require('fs');
const path = require('path');
const root = 'C:/Users/狮子/qwerty/personal-bank 60 18,09,2026';
const h = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function chk(list) { list.forEach(([n, ok]) => console.log((ok ? 'OK   ' : 'FAIL ') + n)); }

chk([
  ['inline onclick closeDictionary', h.includes('onclick="closeDictionary();return false;"')],
  ['window.closeDictionary defined', h.includes('window.closeDictionary=function')],
  ['window.reloadDictionary defined', h.includes('window.reloadDictionary=function')],
  ['Esc closes dict', h.includes("e.key==='Escape'")],
  ['_dictClosing bypasses global mode', h.includes('!window._dictClosing')],
  ['no forced display:block on bare #secDictionary', !h.includes('body.dict-fullscreen #secDictionary{')],
  ['forced display only on .on', h.includes('body.dict-fullscreen #secDictionary.on')],
  ['bind dictClose before init', h.includes('Кнопки словаря')],
  ['init wrapped in try/catch', h.includes('try{ if(window.Journal')],
  ['close removes .on from section', h.includes("sec.classList.remove('on')")],
  ['close goes home', h.includes("window.go('home')")],
]);

// parse main inline scripts
const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
let m, i = 0, fails = 0;
while ((m = re.exec(h)) !== null) {
  const attrs = m[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;
  const code = m[2];
  if (!code.trim()) continue;
  i++;
  try { new Function(code); }
  catch (e) {
    fails++;
    console.log('FAIL script#' + i + ': ' + e.message.slice(0, 140));
  }
}
if (!fails) console.log('OK   inline scripts (' + i + ') parse');

// simulate close logic presence
const closeIdx = h.indexOf('window.closeDictionary=function');
const goHomeIdx = h.indexOf("window.go('home')", closeIdx);
chk([
  ['closeDictionary body contains go home', goHomeIdx > closeIdx && goHomeIdx - closeIdx < 1200],
  ['closeDictionary clears class first', h.indexOf("classList.remove('dict-fullscreen')", closeIdx) < goHomeIdx],
]);

console.log('--- done ---');
