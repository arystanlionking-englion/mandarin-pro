const fs = require('fs');
const path = require('path');

const refPath = String.raw`C:\Users\狮子\Desktop\futcion\сканер_кьр_терминал_игровой_банк_работает_отилчно.html`;
const outDir = String.raw`C:\Users\狮子\qwerty\personal-bank`;

const content = fs.readFileSync(refPath, 'utf-8');
const lines = content.split('\n');
console.log('Total lines:', lines.length);

// Line 608 (index 607) = QRCode.js
const qrcodeLine = lines[607];
console.log('Line 608 length:', qrcodeLine.length);

// Find jsQR end (closing </script> after line 611)
let jsqrEnd = -1;
for (let i = 610; i < lines.length; i++) {
    if (lines[i].trim() === '</script>') {
        jsqrEnd = i;
        break;
    }
}
console.log('jsQR script ends at line:', jsqrEnd + 1);

// Extract jsQR content (lines 611 to jsqrEnd, indices 610 to jsqrEnd)
const jsqrLines = lines.slice(610, jsqrEnd + 1);
const jsqrContent = jsqrLines.join('\n');

// Write QRCode.js line
fs.writeFileSync(path.join(outDir, 'qrcode_lib.txt'), qrcodeLine, 'utf-8');
console.log('QRCode.js written, length:', qrcodeLine.length);

// Write jsQR content
fs.writeFileSync(path.join(outDir, 'jsqr_lib.txt'), jsqrContent, 'utf-8');
console.log('jsQR written, length:', jsqrContent.length);

// Also extract scanner CSS from the reference file
// Find the <style> block that contains scanner styles
const styleStart = content.indexOf('.scanner-overlay');
if (styleStart >= 0) {
    // Find the start of the line/block
    const blockStart = content.lastIndexOf('{', styleStart);
    // Just extract from .scanner-overlay to the end of that rule set
    console.log('Scanner CSS found at char offset:', styleStart);
}

// Extract scanner JS functions
const scannerFuncStart = content.indexOf('function openScanner');
if (scannerFuncStart >= 0) {
    console.log('Scanner JS functions found at char offset:', scannerFuncStart);
}

console.log('Done');
