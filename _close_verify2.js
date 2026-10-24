const fs = require('fs');
const h = fs.readFileSync('C:/Users/狮子/qwerty/personal-bank 60 18,09,2026/index.html', 'utf8');

const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
let m, i = 0, fails = 0;
while ((m = re.exec(h)) !== null) {
  const attrs = m[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;
  const code = m[2];
  if (!code.trim()) continue;
  i++;
  try { new Function(code); }
  catch (e) { fails++; console.log('FAIL script#' + i + ': ' + e.message.slice(0, 160)); }
}
console.log(fails ? 'FAILURES: ' + fails : 'OK all ' + i + ' inline scripts parse');

const closeIdx = h.indexOf('window.closeDictionary=function');
const body = h.slice(closeIdx, closeIdx + 1800);
const checks = [
  ['close clears iframe session', body.includes("about:blank") && body.includes('removeAttribute')],
  ['close force-shows secHome', body.includes("getElementById('secHome')") && body.includes("classList.add('on')")],
  ['close sets curSec=home', body.includes("curSec='home'")],
  ['close go() in try/catch', body.includes("try{window.go('home');}catch(e){}")],
  ['close long exit if GM=dict', body.includes("section==='dictionary'") && body.includes('24*60*60*1000')],
  ['close removes dict-fullscreen', body.includes("classList.remove('dict-fullscreen')")],
  ['close removes section .on', body.includes("sec.classList.remove('on')")],
  ['applyGM respects temp exit', h.includes('if(Date.now()>=_gmTempExitUntil)enforceGlobalMode(true)')],
  ['button capture binding', h.includes('dictClose.addEventListener')],
  ['inline onclick still present', h.includes('onclick="closeDictionary();return false;"')],
  ['Esc still closes', h.includes("e.key==='Escape'")],
];
checks.forEach(([n, ok]) => console.log((ok ? 'OK   ' : 'FAIL ') + n));
console.log('--- done ---');
