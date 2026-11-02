"""裁剪楷体字体：只保留小游戏代码里出现过的字，把 20 多 MB 的字体压到几十 KB。

用法（需要 fonttools：pip3 install fonttools）：
    python3 tools/subset-font.py 下载好的/LXGWWenKai-Medium.ttf

字体来源：霞鹜文楷 LXGW WenKai，SIL Open Font License 1.1
https://github.com/lxgw/LxgwWenKai
改了界面文字后重新运行一次，新加的字才会用楷体显示。
"""
import pathlib
import sys

from fontTools import subset

root = pathlib.Path(__file__).resolve().parent.parent
source_files = sorted((root / 'minigame' / 'js').glob('*.js'))

chars = set()
for path in source_files:
    chars.update(path.read_text(encoding='utf-8'))
# 常用的 ASCII 和中文标点，房间号、比分等动态内容也能显示
chars.update(chr(c) for c in range(0x20, 0x7F))
chars.update('，。！？、：；「」（）…·—')
chars = {ch for ch in chars if ch.isprintable()}

out = root / 'minigame' / 'fonts' / 'kai.ttf'
out.parent.mkdir(exist_ok=True)
options = subset.Options()
options.layout_features = ['*']
options.name_IDs = ['*']
options.notdef_outline = True
font = subset.load_font(sys.argv[1], options)
subsetter = subset.Subsetter(options)
subsetter.populate(text=''.join(chars))
subsetter.subset(font)
subset.save_font(font, str(out), options)
print(f'{len(chars)} 个字符 → {out}（{out.stat().st_size // 1024} KB）')
