const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const start = html.indexOf("(function(){\n'use strict';");
const end = html.indexOf('})();\n</script>', start);
console.log('start', start, 'end', end);
const body = html.slice(start, end + 5);
try {
  new Function(body);
  console.log('main IIFE syntax OK, length', body.length);
} catch (e) {
  console.log('SYNTAX ERROR:', e.message);
}
