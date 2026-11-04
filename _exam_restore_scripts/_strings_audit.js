const fs = require('fs');
const files = {
  oct29: 'C:/Users/狮子/qwerty/данные за 29 число.json',
  oct30: 'C:/Users/狮子/qwerty/данные за 30 число.json',
  nov04: 'C:/Users/狮子/qwerty/данные за 4 число.json'
};
const re = /результат|оценк|сдал|сдач|тест|провер|вопрос|ответ|правильн|ошибк|балл|процент|экз|quiz|grade|percent|passed|correct|wrong/i;

for (const [name, f] of Object.entries(files)) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log('======', name, '======');
  const seen = new Set();
  function walk(obj, path) {
    if (seen.size > 60) return;
    if (typeof obj === 'string') {
      if (re.test(obj)) {
        const key = path.replace(/\[\d+\]/g, '[N]');
        if (!seen.has(key + '::' + obj.slice(0, 40))) {
          seen.add(key + '::' + obj.slice(0, 40));
          console.log(path, '=>', obj.slice(0, 140).replace(/\n/g, ' '));
        }
      }
    } else if (Array.isArray(obj)) obj.forEach((v, i) => walk(v, path + '[' + i + ']'));
    else if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) walk(obj[k], path + '.' + k);
    }
  }
  walk(d, '');
  console.log('--- strings with matches:', seen.size);
  console.log();
}

// also dump notifications titles/texts from oct29
const d29 = JSON.parse(fs.readFileSync(files.oct29, 'utf8'));
console.log('=== oct29 notifications sample (first 10):');
(d29.notifications || []).slice(0, 10).forEach(n => console.log(JSON.stringify(n).slice(0, 220)));
console.log();
console.log('=== oct29 approvalRequests sample (first 5):');
(d29.approvalRequests || []).slice(0, 5).forEach(n => console.log(JSON.stringify(n).slice(0, 260)));
