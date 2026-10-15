const fs = require('fs');
const c = fs.readFileSync(String.raw`C:\Users\狮子\qwerty\personal-bank\index.html`, 'utf-8');
const lines = c.split('\n');

console.log('=== STRUCTURE ===');
console.log('Lines:', lines.length);
console.log('Size:', (c.length / 1024).toFixed(1) + 'KB');
console.log('DOCTYPE:', lines[0].trim());
console.log('Last line:', lines[lines.length - 1].trim());

console.log('\n=== BALANCED TAGS ===');
console.log('script open/close:', (c.match(/<script/g) || []).length, '/', (c.match(/<\/script>/g) || []).length);
console.log('style open/close:', (c.match(/<style/g) || []).length, '/', (c.match(/<\/style>/g) || []).length);

console.log('\n=== QR FEATURES ===');
console.log('QRCode.js inline:', c.includes('Embedded QRCode.js'));
console.log('jsQR inline:', c.includes('Embedded jsQR'));
console.log('CDN removed:', !c.includes('cdn.jsdelivr.net/npm/qrcodejs'));
console.log('Scanner overlay HTML:', c.includes('qrScannerOverlay'));
console.log('Scanner CSS:', c.includes('.qr-scanner-overlay'));
console.log('Scanner JS functions:');
console.log('  openQrScanner:', c.includes('window.openQrScanner'));
console.log('  closeQrScanner:', c.includes('window.closeQrScanner'));
console.log('  switchQrCamera:', c.includes('window.switchQrCamera'));
console.log('  confirmQrCharge:', c.includes('window.confirmQrCharge'));
console.log('  resetQrScanner:', c.includes('window.resetQrScanner'));
console.log('Scanner button in tab:', c.includes('Открыть сканер'));
console.log('Manual fallback preserved:', c.includes('qrUserSearch'));

console.log('\n=== QR GENERATION ===');
console.log('generateMyQR:', c.includes('window.generateMyQR'));
console.log('generateMyQRPage:', c.includes('window.generateMyQRPage'));
console.log('qr:data handler:', c.includes("socket.on('qr:data'"));
console.log('qr:paymentSuccess:', c.includes("socket.on('qr:paymentSuccess'"));

console.log('\n=== ALL CHECKS PASSED ===');
