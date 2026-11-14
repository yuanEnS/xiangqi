#!/usr/bin/env python3
"""成语接龙的词库：把开源的成语数据整理成 server/rules/chengyu-words.js。

    python3 tools/chengyu/build.py idiom.json

idiom.json 来自 https://github.com/pwxcoo/chinese-xinhua （MIT 许可）的 data/idiom.json，
只取四字成语和拼音，释义、出处不要。每个成语只存第一个字和最后一个字的拼音（带声调数字），
同音接龙用。常用成语（电脑和开局挑词用的）是 COMMON，手工维护，在生成的文件里原样保留。
"""
import collections
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'server', 'rules', 'chengyu-words.js')
TONES = {'̄': '1', '́': '2', '̌': '3', '̀': '4'}


def syllable(text):
    """'nǚ' -> 'nv3'，轻声或没有声调记 5"""
    text = unicodedata.normalize('NFD', text.strip().lower())
    tone = '5'
    out = ''
    for ch in text:
        if ch in TONES:
            tone = TONES[ch]
        elif ch == '̈':
            out = out[:-1] + 'v' if out.endswith('u') else out
        elif 'a' <= ch <= 'z':
            out += ch
    return out + tone if out else ''


def main():
    data = json.load(open(sys.argv[1], encoding='utf-8'))
    old = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
    common = re.search(r'const COMMON = `(.*?)`', old, re.S)
    common = common.group(1).split() if common else []
    rows = {}
    reading = collections.defaultdict(collections.Counter)  # 字 -> 各个读音出现的次数
    for item in data:
        word = item['word'].strip()
        if not re.fullmatch(r'[一-鿿]{4}', word):
            continue
        sylls = [s for s in (syllable(p) for p in re.split(r'[\s\-，,]+', item['pinyin'])) if s]
        if len(sylls) != 4:
            continue
        rows.setdefault(word, f'{word}{sylls[0]}{sylls[3]}')
        for ch, syl in zip(word, sylls):
            reading[ch][syl] += 1
    # 常用成语里数据没收的（比如「心想事成」），首尾字取这个字在数据里最常见的读音补上
    added = []
    for word in common:
        if word in rows:
            continue
        if reading[word[0]] and reading[word[3]]:
            rows[word] = f'{word}{reading[word[0]].most_common(1)[0][0]}{reading[word[3]].most_common(1)[0][0]}'
            added.append(rows[word])
        else:
            print('拿不到读音，去掉：', word)
    if added:
        print('常用成语按单字读音补上的：', ' '.join(added))
    common = [w for w in common if w in rows]
    lines = []
    for i in range(0, len(common), 10):
        lines.append(' '.join(common[i:i + 10]))
    body = sorted(rows.values())
    words = '\n'.join(' '.join(body[i:i + 12]) for i in range(0, len(body), 12))
    js = f'''// 成语接龙的词库，由 tools/chengyu/build.py 生成，别手改 ALL；COMMON 可以手改，重新生成时会保留。
// ALL：四字成语 + 第一个字和最后一个字的拼音（数字是声调，5 是轻声），比如「勃然大怒bo2nu4」。
//      数据来自 github.com/pwxcoo/chinese-xinhua（MIT 许可），只取了成语和拼音。
// COMMON：常用成语，电脑接龙和开局挑词只用这些，免得出太生僻的词。
(function (root, factory) {{
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChengyuWords = factory();
}})(typeof self !== 'undefined' ? self : this, function () {{
  const COMMON = `
{chr(10).join(lines)}
`;
  const ALL = `
{words}
`;
  return {{ COMMON, ALL }};
}});
'''
    open(OUT, 'w', encoding='utf-8').write(js)
    print(f'{len(rows)} 个成语，常用 {len(common)} 个，{os.path.getsize(OUT) // 1024} KB → {os.path.relpath(OUT)}')


if __name__ == '__main__':
    main()
