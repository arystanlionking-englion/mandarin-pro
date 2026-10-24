const fs = require('fs');
const path = require('path');
const root = 'C:\\Users\\狮子\\qwerty\\personal-bank 60 18,09,2026';
const files = [
    'party.js',
    'journal.js',
    'server.js'
];
let ok = true;
for (const f of files) {
    const p = path.join(root, f);
    try {
        const src = fs.readFileSync(p, 'utf8');
        // strip BOM
        new Function(src.replace(/^\uFEFF/, ''));
        console.log('OK  ', f);
    } catch (e) {
        ok = false;
        console.log('FAIL', f, e.message);
    }
}
// Check index.html inline script extraction is too heavy; instead check key strings exist
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const checks = [
    ['no dict card on home', !html.includes('<div class="act-btn" onclick="go(\'dictionary\')"><div class="ic" style="background:rgba(59,130,246')],
    ['dict nav sidebar kept', html.includes('data-s="dictionary"')],
    ['dict iframe kept', html.includes('id="dictFrame"')],
    ['dict load hint timeout', html.includes('dictLoadHint')],
    ['closeDictionary no about:blank', !html.includes('fr.setAttribute(\'src\',\'about:blank\')')],
    ['diary subtitle homework', html.includes('домашнее задание и история занятий')],
];
for (const [name, pass] of checks) {
    if (!pass) ok = false;
    console.log((pass ? 'OK  ' : 'FAIL'), name);
}
// party.js checks
const party = fs.readFileSync(path.join(root, 'party.js'), 'utf8');
const pchecks = [
    ['createRoom action', party.includes("case 'createRoom'")],
    ['openRoom action', party.includes("case 'openRoom'")],
    ['createRoom emit', party.includes("emit('party:createRoom'")],
    ['openRoom emit', party.includes("emit('party:openRoom'")],
    ['myCards clear on !hasCard', party.includes('myCards[d.mode] = null')],
    ['no activeMode overwrite for other mode', party.includes('d.mode === activeMode || page === \'home\'')],
];
for (const [name, pass] of pchecks) {
    if (!pass) ok = false;
    console.log((pass ? 'OK  ' : 'FAIL'), name);
}
// journal.js checks
const journal = fs.readFileSync(path.join(root, 'journal.js'), 'utf8');
const jchecks = [
    ['diary hw section title', journal.includes('Домашнее задание</div>')],
    ['diary group label', journal.includes('задания от преподавателя')],
    ['init guard', journal.includes('_journalInited')],
];
for (const [name, pass] of jchecks) {
    if (!pass) ok = false;
    console.log((pass ? 'OK  ' : 'FAIL'), name);
}
// dict html checks
const dict = fs.readFileSync(path.join(root, '12 версия FINALL', 'DLK AI V1 3 хск 2026 словарь кит.html'), 'utf8');
const dchecks = [
    ['hanzi-writer async', dict.includes('script async src="https://cdn.jsdelivr.net/npm/hanzi-writer')],
    ['examples cached', dict.includes('word._ex')],
    ['search key precomputed', dict.includes('w._sk')],
];
for (const [name, pass] of dchecks) {
    if (!pass) ok = false;
    console.log((pass ? 'OK  ' : 'FAIL'), name);
}
// server.js checks
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const schecks = [
    ['hsk4a route', server.includes("app.get('/hsk4a_data.js'")],
    ['party:createRoom still there', server.includes("socket.on('party:createRoom'")],
];
for (const [name, pass] of schecks) {
    if (!pass) ok = false;
    console.log((pass ? 'OK  ' : 'FAIL'), name);
}
console.log(ok ? 'ALL OK' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
