import re, sys
path = sys.argv[1]
pats = sys.argv[2:]
with open(path, encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        for p in pats:
            if re.search(p, line):
                print(f'{i}: {line[:200].rstrip()}')
                break
