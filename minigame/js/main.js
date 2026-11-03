// 小游戏入口：有多个游戏时先显示游戏列表，只有一个游戏（网页版）就直接进去
const ui = require('./ui.js');
const { drawPiece, drawStone } = require('./draw.js');
const { GAMES } = require('./config.js');

const APPS = {
  xiangqi: {
    app: require('./xiangqi-app.js'),
    title: '中国象棋',
    sub: '人机对战 · 本地双人 · 五套主题',
    icon: (x, y, r) => drawPiece(ui.ctx, ui.theme(), 'K', x, y, r, ui.GLYPHS[ui.settings.glyphs].K, false),
  },
  gomoku: {
    app: require('./gomoku-app.js'),
    title: '五子棋',
    sub: '人机对战 · 本地双人 · 15 路棋盘',
    icon: (x, y, r) => drawStone(ui.ctx, ui.theme(), 'b', x, y, r * 0.9),
  },
};

const games = GAMES.filter(id => APPS[id]);

const hub = {
  render() {
    ui.drawDecor();
    ui.text('游戏园', 16, ui.titleY, 22, ui.theme().ui.primary, { bold: true, align: 'left' });
    ui.entryCards(games.map(id => ({ ...APPS[id], onTap: () => APPS[id].app.open(showHub) })));
  },
};

function showHub() {
  ui.show(hub);
}

if (games.length === 1) APPS[games[0]].app.open();
else showHub();
