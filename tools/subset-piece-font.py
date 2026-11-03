"""裁剪棋子字体：只保留棋子上的字（themes.js 里 GLYPHS 用到的字），压到十几 KB。

用法（需要 fonttools：pip3 install fonttools）：
    python3 tools/subset-piece-font.py 下载好的/ChillKai.ttf

字体来源：寒蝉正楷体 ChillKai，SIL Open Font License 1.1
https://github.com/Warren2060/ChillKai
改了 GLYPHS 里的字后重新运行一次。
"""
import pathlib
import re
import sys

from fontTools import subset

root = pathlib.Path(__file__).resolve().parent.parent
themes = (root / 'minigame' / 'js' / 'themes.js').read_text(encoding='utf-8')
block = themes[themes.index('const GLYPHS'):]
block = block[:block.index('};') + 2]
chars = set(re.findall(r"'([^'\x00-\x7f])'", block))

out = root / 'minigame' / 'fonts' / 'piece.ttf'
options = subset.Options()
options.layout_features = ['*']
options.name_IDs = ['*']
options.notdef_outline = True
font = subset.load_font(sys.argv[1], options)
subsetter = subset.Subsetter(options)
subsetter.populate(text=''.join(sorted(chars)))
subsetter.subset(font)
subset.save_font(font, str(out), options)
print(f'{"".join(sorted(chars))}（{len(chars)} 个字）→ {out}（{out.stat().st_size // 1024} KB）')
