# -*- coding: utf-8 -*-
import re

with open(r'D:\qwerty\8 версия\DLK AI V1 3 хск 2026 словарь кит.html', 'r', encoding='utf-8') as f:
    content = f.read()

scripts = re.findall(r'<script>(.*?)</script>', content, re.DOTALL)
for i, s in enumerate(scripts):
    braces = s.count('{') - s.count('}')
    parens = s.count('(') - s.count(')')
    print('Script %d: %d chars, braces=%d, parens=%d' % (i+1, len(s), braces, parens))

print('Has dictLevelFilter var:', 'dictLevelFilter =' in content)
print('Has old data-level lessons:', 'data-level=\x22lessons\x22' in content)
print('Total lines:', content.count('\n')+1)

funcs = ['refreshCurrentView', 'showLessonsList', 'showRandomPhrase', 'renderDict']
for fn in funcs:
    print('  Has %s: %s' % (fn, ('function ' + fn) in content))