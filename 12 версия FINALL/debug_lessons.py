#!/usr/bin/env python3
"""Debug specific lesson dialogue extraction."""
import os
import re
from docx import Document
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE = r"D:\qwerty\11 версия FINALL"
DIALOG_DIR = os.path.join(BASE, "4 hsk 1 A -  1 часть диалоги и слова", "Диалоги")

# Check problematic lessons
for lesson_num in [12, 15, 20]:
    fname = f"{lesson_num} урок.docx"
    filepath = os.path.join(DIALOG_DIR, fname)
    if not os.path.exists(filepath):
        print(f"\n=== Lesson {lesson_num}: FILE NOT FOUND ===")
        continue
    
    doc = Document(filepath)
    print(f"\n=== Lesson {lesson_num}: ALL TEXT ===")
    for i, para in enumerate(doc.paragraphs):
        t = para.text.strip()
        if t:
            print(f"  [{i:3d}] {t[:120]}")