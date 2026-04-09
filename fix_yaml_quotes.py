"""
扫描 _words/*.md，找出 YAML front matter 中单行 note/definition/meaning/etymology 字段
里混用了中文弯引号（\u201c \u201d）且被 ASCII 双引号包裹的行，并自动修复。

修复策略：将该行的外层 ASCII 双引号改为单引号，或将内部弯引号替换为直角引号「」。
这里选择将内部弯引号替换为直角引号，保持外层双引号不变，YAML 可以正确解析。
"""
import os, re

WORDS_DIR = os.path.join(os.path.dirname(__file__), '_words')

# 中文弯引号
OPEN_CURLY  = '\u201c'  # "
CLOSE_CURLY = '\u201d'  # "
OPEN_SINGLE = '\u2018'  # '
CLOSE_SINGLE= '\u2019'  # '

def fix_file(path):
    with open(path, encoding='utf-8') as f:
        content = f.read()

    # 只处理 YAML front matter（两个 --- 之间）
    parts = content.split('---', 2)
    if len(parts) < 3:
        return False

    yaml_raw = parts[1]

    # 找出 YAML 中被双引号包裹且内部含弯引号的行，替换弯引号为直角引号
    def replace_line(m):
        line = m.group(0)
        # 替换弯双引号为直角引号
        line = line.replace(OPEN_CURLY, '\u300c').replace(CLOSE_CURLY, '\u300d')
        # 替换弯单引号为普通单引号（不会破坏YAML，因为外层是双引号）
        line = line.replace(OPEN_SINGLE, "'").replace(CLOSE_SINGLE, "'")
        return line

    # 匹配单行 YAML 字段：  key: "...内容..."
    pattern = re.compile(r'(?m)^( {2,}\w[^:\n]*:\s*")([^"\n]*)("[ \t]*$)')

    def fix_value(m):
        prefix, value, suffix = m.group(1), m.group(2), m.group(3)
        new_value = value.replace(OPEN_CURLY, '\u300c').replace(CLOSE_CURLY, '\u300d')
        new_value = new_value.replace(OPEN_SINGLE, "'").replace(CLOSE_SINGLE, "'")
        if new_value != value:
            return prefix + new_value + suffix
        return m.group(0)

    new_yaml = pattern.sub(fix_value, yaml_raw)

    if new_yaml == yaml_raw:
        return False

    new_content = '---' + new_yaml + '---' + parts[2]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    return True

fixed = []
for fn in sorted(os.listdir(WORDS_DIR)):
    if fn.endswith('.md'):
        path = os.path.join(WORDS_DIR, fn)
        if fix_file(path):
            fixed.append(fn)

print(f"Fixed {len(fixed)} file(s):")
for fn in fixed:
    print(f"  {fn}")
