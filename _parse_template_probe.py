import zipfile, re, sys
p = r'C:\Users\狮子\qwerty\personal-bank 60 18,09,2026\шаблон HSK4_урок_1_тест_для_автопроверки.docx'
z = zipfile.ZipFile(p)
xml = z.read('word/document.xml').decode('utf-8')
text = re.sub(r'</w:p>', '\n', xml)
text = re.sub(r'<[^>]+>', '', text)
lines = [l.rstrip() for l in text.splitlines() if l.strip()]
print('TOTAL LINES', len(lines))
out = []
for i, l in enumerate(lines):
    is_q = bool(re.match(r'^\d+\.', l))
    is_opt = bool(re.match(r'^[A-D]\.', l))
    is_ans = bool(re.match(r'^\s*Правильный ответ', l))
    is_mark = bool(re.match(r'^(HSK|Часть|Формат|姓名|日期|班级|得分)', l))
    if is_mark or is_ans or i < 16 or i > len(lines) - 12:
        kind = 'Q' if is_q else ('OPT' if is_opt else ('ANS' if is_ans else 'MARK'))
        out.append(f'{i:4d} [{kind}] {l[:110]}')
print('\n'.join(out[:80]))
# count questions and answer style
qcount = sum(1 for l in lines if re.match(r'^\d+\.', l))
ans = [l for l in lines if re.match(r'^\s*Правильный ответ', l)]
print('---')
print('questions:', qcount, 'answers:', len(ans))
for a in ans[:8]:
    print('  ', repr(a))
print('  ...')
for a in ans[-4:]:
    print('  ', repr(a))
# check numbering sequence
nums = [int(re.match(r'^(\d+)\.', l).group(1)) for l in lines if re.match(r'^\d+\.', l)]
print('num range:', min(nums), '-', max(nums), 'count:', len(nums), 'contiguous:', nums == list(range(min(nums), max(nums)+1)))
