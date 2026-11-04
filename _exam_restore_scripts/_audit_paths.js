const fs = require('fs');

function findPaths(obj, keyRe, path = '', out = []) {
  if (Array.isArray(obj)) { obj.forEach((v, i) => findPaths(v, keyRe, path + '[' + i + ']', out)); return out; }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (keyRe.test(k)) out.push(path + '.' + k);
      findPaths(obj[k], keyRe, path + '.' + k, out);
    }
  }
  return out;
}

const files = {
  oct29: 'C:/Users/狮子/qwerty/данные за 29 число.json',
  oct30: 'C:/Users/狮子/qwerty/данные за 30 число.json',
  nov04: 'C:/Users/狮子/qwerty/данные за 4 число.json',
  cur: 'C:/Users/狮子/qwerty/personal-bank 72 03,11,2026 18,31/database.json'
};

for (const [name, f] of Object.entries(files)) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log('===', name);
  const pats = {
    questions: /questions|questionCount|totalQuestions/,
    answers: /^answers$|^answer$|^q$|^options$/,
    testish: /testName|testConfig|testResult|exam/i
  };
  for (const [label, re] of Object.entries(pats)) {
    const paths = findPaths(d, re);
    // summarize unique path shapes
    const shapes = {};
    paths.forEach(p => {
      const s = p.replace(/\[\d+\]/g, '[N]');
      shapes[s] = (shapes[s] || 0) + 1;
    });
    console.log(' ', label + ':');
    Object.entries(shapes).forEach(([s, c]) => console.log('   ', s, 'x' + c));
  }
  console.log();
}
