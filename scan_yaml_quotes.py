import os

WORDS_DIR = r'D:\Workspace\EnStory\_words'
OPEN_CURLY  = '\u201c'
CLOSE_CURLY = '\u201d'

problems = []
for fn in sorted(os.listdir(WORDS_DIR)):
    if not fn.endswith('.md'):
        continue
    path = os.path.join(WORDS_DIR, fn)
    text = open(path, encoding='utf-8').read()
    parts = text.split('---', 2)
    if len(parts) < 3:
        continue
    yaml_part = parts[1]
    for lineno, line in enumerate(yaml_part.split('\n'), 1):
        has_curly = OPEN_CURLY in line or CLOSE_CURLY in line
        has_ascii_dquote = '"' in line
        if has_curly and has_ascii_dquote:
            problems.append((fn, lineno, line.strip()))

print(f'Total problem lines: {len(problems)}')
for fn, ln, l in problems:
    print(f'  {fn}:{ln}  {l[:100]}')
