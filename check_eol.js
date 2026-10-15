const fs = require('fs');
const c = fs.readFileSync(String.raw`C:\Users\狮子\qwerty\personal-bank\index.html`);
console.log('Has CRLF:', c.includes('\r\n'));
console.log('Has LF only:', c.includes('\n') && !c.includes('\r\n'));
