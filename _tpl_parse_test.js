// Test: parse HSK template text (from docx) with the server parser
const fs = require('fs');
const zlib = require('zlib');
const { execSync } = require('child_process');

// --- copy of extractDocxXml / docxXmlToText / parseTemplateText from server.js ---
function extractDocxXml(buf) {
    let i = 0;
    while (i < buf.length - 30) {
        if (buf.readUInt32LE(i) === 0x04034b50) {
            const method = buf.readUInt16LE(i + 8);
            let compSize = buf.readUInt32LE(i + 18);
            const nameLen = buf.readUInt16LE(i + 26);
            const extraLen = buf.readUInt16LE(i + 28);
            const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
            const dataStart = i + 30 + nameLen + extraLen;
            if (name === 'word/document.xml') {
                if (!compSize) {
                    let j = dataStart;
                    while (j < buf.length - 4) {
                        if (buf.readUInt32LE(j) === 0x04034b50 || buf.readUInt32LE(j) === 0x02014b50 || buf.readUInt32LE(j) === 0x06054b50) break;
                        j++;
                    }
                    compSize = j - dataStart;
                }
                const data = buf.slice(dataStart, dataStart + compSize);
                return method === 0 ? data.toString('utf8') : zlib.inflateRawSync(data).toString('utf8');
            }
            i = dataStart + (compSize || 0);
            if (i <= dataStart) i = dataStart + 1;
        } else {
            i++;
        }
    }
    throw new Error('word/document.xml не найден — это не DOCX');
}

function docxXmlToText(xml) {
    return String(xml || '')
        .replace(/<w:tab[^>]*\/>/g, '\t')
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function parseTemplateText(text) {
    const lines = String(text || '').split(/\r?\n/);
    const questions = [];
    const errors = [];
    let title = '';
    let cur = null;

    const flush = () => {
        if (!cur) return;
        const opts = cur.options.map(o => String(o || '').trim());
        const filled = opts.filter(Boolean);
        if (!String(cur.text || '').trim()) {
            errors.push('Строка ' + cur.line + ': нет текста вопроса.');
            cur = null;
            return;
        }
        if (filled.length < 2) {
            errors.push('Вопрос ' + cur.num + ': нужно минимум 2 варианта ответа.');
            cur = null;
            return;
        }
        if (!cur.answer) {
            errors.push('Вопрос ' + cur.num + ': нет строки «Правильный ответ».');
            cur = null;
            return;
        }
        let answer = cur.answer;
        const mLetter = answer.match(/^([A-Da-d])[.)]?\s*(.*)$/);
        if (mLetter) {
            const L = mLetter[1].toUpperCase();
            const idx = L.charCodeAt(0) - 65;
            if (opts[idx]) {
                answer = L;
            } else if (mLetter[2] && opts.indexOf(mLetter[2].trim()) >= 0) {
                answer = L;
            } else if (mLetter[2]) {
                answer = mLetter[2].trim();
            }
        } else {
            const ix = opts.findIndex(o => o.toLowerCase() === answer.toLowerCase());
            if (ix >= 0) answer = 'ABCD'.charAt(ix);
        }
        questions.push({
            id: 'q' + (questions.length + 1),
            text: String(cur.text).trim(),
            options: filled,
            answer,
            points: 1,
            explanation: ''
        });
        cur = null;
    };

    for (let i = 0; i < lines.length; i++) {
        const raw = String(lines[i] || '').replace(/\u00a0/g, ' ').trim();
        if (!raw) continue;
        if (!title && /^HSK/i.test(raw)) { title = raw; continue; }
        if (/^(姓名|日期|班级|得分|Формат|Вопрос варианты|Итого)/.test(raw)) continue;
        if (/^____/.test(raw)) continue;
        if (/^Часть\s+\d+/i.test(raw)) { flush(); continue; }

        const am = raw.match(/^Правильный\s+ответ\s*:\s*(.+)$/i);
        if (am && cur) {
            cur.answer = am[1].trim();
            flush();
            continue;
        }

        const om = raw.match(/^([A-Da-d])[.)]\s*(.*)$/);
        if (om && cur && !/^\d/.test(raw)) {
            cur.options[om[1].toUpperCase().charCodeAt(0) - 65] = om[2];
            continue;
        }

        const qm = raw.match(/^(\d{1,3})\.\s+(.*)$/);
        if (qm) {
            flush();
            cur = { num: qm[1], text: qm[2], options: ['', '', '', ''], answer: '', line: i + 1 };
            continue;
        }

        if (cur) cur.text += (cur.text ? ' ' : '') + raw;
    }
    flush();
    return { title, questions, errors };
}

// --- run ---
const p = 'C:/Users/狮子/qwerty/personal-bank 60 18,09,2026/шаблон HSK4_урок_1_тест_для_автопроверки.docx';
const buf = fs.readFileSync(p);
const xml = extractDocxXml(buf);
const text = docxXmlToText(xml);
const parsed = parseTemplateText(text);

console.log('title:', parsed.title);
console.log('questions:', parsed.questions.length);
console.log('errors:', parsed.errors.length);
if (parsed.errors.length) console.log(parsed.errors.slice(0, 10).join('\n'));

const qs = parsed.questions;
console.log('first:', JSON.stringify({ t: qs[0].text, o: qs[0].options, a: qs[0].answer }));
console.log('q16:', JSON.stringify({ t: qs[15] && qs[15].text, a: qs[15] && qs[15].answer }));
console.log('q66:', JSON.stringify({ t: qs[65] && qs[65].text, o: qs[65] && qs[65].options, a: qs[65] && qs[65].answer }));
console.log('last:', JSON.stringify({ t: qs[qs.length - 1].text, a: qs[qs.length - 1].answer }));

// validate: every question has 4 options and a letter answer A-D
let bad = 0;
for (const q of qs) {
    if (q.options.length !== 4) { console.log('NOT4:', q.text, q.options); bad++; }
    if (!/^[A-D]$/.test(q.answer)) { console.log('BADANS:', q.text, '->', q.answer); bad++; }
}
console.log('bad:', bad);
if (qs.length !== 75 || bad > 0 || parsed.errors.length) {
    console.log('FAIL');
    process.exit(1);
}
console.log('TEMPLATE PARSE OK — 75 questions');
