# -*- coding: utf-8 -*-
"""Extract HSK 1 data from xlsx and docx files into JavaScript data structures."""
import openpyxl
import docx
import json
import os
import re

BASE = r"D:\qwerty\8 версия\1 hsk диалоги и слова"
XLSX_PATH = os.path.join(BASE, "СЛОВА 1 hsk", "HSK 1 Слова.xlsx")
DIALOGS_DIR = os.path.join(BASE, "диалоги 1 hsk")

# ===== 1. Extract words from xlsx =====
wb = openpyxl.load_workbook(XLSX_PATH)
ws = wb.active

hsk1_words = []
current_lesson = None

for row in ws.iter_rows(min_row=2, values_only=True):
    a = str(row[0]).strip() if row[0] else ''
    if 'Lesson' in a:
        current_lesson = int(a.replace('Lesson ', '').strip())
    elif row[0] and isinstance(row[0], int) and row[1]:
        hanzi = str(row[1]).strip()
        pinyin = str(row[2]).strip() if row[2] else ''
        pos = str(row[3]).strip() if row[3] else ''
        en = str(row[4]).strip() if row[4] else ''
        ru = str(row[5]).strip() if row[5] else ''
        kz = str(row[6]).strip() if row[6] else ''
        hsk1_words.append({
            'lesson': current_lesson,
            'hanzi': hanzi,
            'pinyin': pinyin,
            'pos': pos,
            'en': en,
            'ru': ru,
            'kz': kz
        })

print(f"Extracted {len(hsk1_words)} words from HSK 1 xlsx")

# ===== 2. Extract dialogues from docx =====
hsk1_dialogues = {}

for fname in sorted(os.listdir(DIALOGS_DIR)):
    if not fname.endswith('.docx') or fname.startswith('~$'):
        continue
    m = re.match(r'(\d+)\s*урок\.docx', fname)
    if not m:
        continue
    lesson_num = int(m.group(1))
    fpath = os.path.join(DIALOGS_DIR, fname)
    doc = docx.Document(fpath)
    
    dialogues_for_lesson = []
    current_dialogue = []
    current_title = ""
    
    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        
        # Check if this is a dialogue line (starts with A: or B: with half-width or full-width colon)
        speaker_match = re.match(r'^([AB])[：:]\s*(.+)', text)
        # Check if this is a section header (starts with a number + dot, or is a short location phrase)
        section_match = re.match(r'^(\d+)\.\s*(.+)', text)
        is_section_header = section_match or (
            len(text) < 20 and not speaker_match and 
            not re.search(r'[？?！!。]', text) and
            not any(c in text for c in ['，', '、', '的', '了', '在'])
        )
        
        if speaker_match:
            speaker = speaker_match.group(1)
            content = speaker_match.group(2)
            current_dialogue.append({
                'speaker': speaker,
                'text': content
            })
        elif is_section_header:
            # Save current dialogue if exists
            if current_dialogue:
                title = current_title or f'Диалог {len(dialogues_for_lesson) + 1}'
                dialogues_for_lesson.append({
                    'type': 'dialogue',
                    'title': title,
                    'lines': current_dialogue
                })
                current_dialogue = []
            # Use section title for next dialogue
            if section_match:
                current_title = section_match.group(2).strip()
            else:
                current_title = text
        else:
            # Standalone phrase - save current dialogue if exists
            if current_dialogue:
                title = current_title or f'Диалог {len(dialogues_for_lesson) + 1}'
                dialogues_for_lesson.append({
                    'type': 'dialogue',
                    'title': title,
                    'lines': current_dialogue
                })
                current_dialogue = []
                current_title = ""
            dialogues_for_lesson.append({
                'type': 'phrase',
                'title': text,
                'text': text
            })
    
    # Don't forget last dialogue
    if current_dialogue:
        title = current_title or f'Диалог {len(dialogues_for_lesson) + 1}'
        dialogues_for_lesson.append({
            'type': 'dialogue',
            'title': title,
            'lines': current_dialogue
        })
    
    hsk1_dialogues[lesson_num] = dialogues_for_lesson
    print(f"  Lesson {lesson_num}: {len(dialogues_for_lesson)} dialogues/phrases")

# ===== 3. Generate JavaScript =====
js_output = []

# HSK1 Words
js_output.append("// ===== HSK 1 WORDS =====")
js_output.append("const HSK1_WORDS_RAW = [")
for w in hsk1_words:
    ru_escaped = w['ru'].replace("'", "\\'").replace('"', '\\"')
    kz_escaped = w['kz'].replace("'", "\\'").replace('"', '\\"')
    en_escaped = w['en'].replace("'", "\\'").replace('"', '\\"')
    pinyin_escaped = w['pinyin'].replace("'", "\\'")
    js_output.append(f"  {{lesson:{w['lesson']},hanzi:'{w['hanzi']}',pinyin:'{pinyin_escaped}',pos:'{w['pos']}',en:'{en_escaped}',ru:'{ru_escaped}',kz:'{kz_escaped}'}},")
js_output.append("];")
js_output.append("")

# HSK1 Dialogues - use JSON.stringify for safety
js_output.append("// ===== HSK 1 DIALOGUES =====")
dialogues_json = json.dumps(hsk1_dialogues, ensure_ascii=False, indent=None)
js_output.append(f"const HSK1_DIALOGUES_DATA = {dialogues_json};")
js_output.append("")

# Write to file
output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hsk1_data.js")
with open(output_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(js_output))

print(f"\nJavaScript data written to: {output_path}")
print(f"Total words: {len(hsk1_words)}")
print(f"Total lessons with dialogues: {len(hsk1_dialogues)}")

# Also print word count by lesson
from collections import Counter
lesson_counts = Counter(w['lesson'] for w in hsk1_words)
for l in sorted(lesson_counts.keys()):
    print(f"  Lesson {l}: {lesson_counts[l]} words")