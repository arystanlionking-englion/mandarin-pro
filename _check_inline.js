const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const re = /onclick="([^"]+)"/g;
const fns = new Set();
let m;
while ((m = re.exec(html))) {
  const calls = m[1].match(/([a-zA-Z_$][\w$]*)\s*\(/g);
  if (calls) calls.forEach(c => fns.add(c.replace(/\s*\($/, '')));
}
console.log('Functions called from inline onclick:');
[...fns].sort().forEach(f => {
  const isWindow = html.includes('window.' + f + '=') || html.includes('window.' + f + ' =');
  const isGlobalFn = new RegExp('function\\s+' + f + '\\s*\\(').test(html);
  console.log((isWindow ? ' [window]' : isGlobalFn ? '  [global-fn]' : '  [MISSING?]') , f);
});
