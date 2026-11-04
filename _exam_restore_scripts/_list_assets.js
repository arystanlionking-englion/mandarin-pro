const fs = require('fs');
const src = fs.readFileSync('C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/index.html', 'utf8');
const re = /<script[^>]+src=["']([^"']+)["']/g;
let m;
while ((m = re.exec(src))) console.log(m[1]);
// also css links
const re2 = /<link[^>]+href=["']([^"']+)["']/g;
while ((m = re2.exec(src))) console.log('CSS:', m[1]);
// images
const re3 = /<img[^>]+src=["']([^"']+)["']/g;
const imgs = new Set();
while ((m = re3.exec(src))) imgs.add(m[1]);
console.log('IMGS:', [...imgs].join(' | '));
