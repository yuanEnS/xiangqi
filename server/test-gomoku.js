// 五子棋自测：胜负判定、悔棋、电脑会成五和挡五、各档难度互相对弈
// 用法：node server/test-gomoku.js
const { Game } = require('../minigame/js/gomoku.js');
const { LEVELS, findBestMove } = require('../minigame/js/gomoku-ai.js');

function check(cond, label) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) process.exitCode = 1;
}

// 按顺序落子，黑白交替
function play(moves) {
  const g = new Game();
  for (const m of moves) g.move(m);
  return g;
}

// 横、竖、斜都能判赢
for (const [name, dr, dc] of [['横', 0, 1], ['竖', 1, 0], ['斜', 1, 1], ['反斜', 1, -1]]) {
  const moves = [];
  for (let i = 0; i < 5; i++) {
    moves.push([5 + dr * i, 7 + dc * i]);
    if (i < 4) moves.push([0, i * 2]);
  }
  const g = play(moves);
  check(g.winner === 'b' && g.reason === 'five' && g.winLine.length === 5, `${name}连五判黑胜`);
}

{
  const g = play([[7, 7], [7, 8]]);
  check(!g.move([7, 7]), '不能下在已有棋子的位置');
  check(!g.move([15, 0]) && !g.move([-1, 3]), '不能下到棋盘外');
  check(g.turn === 'b' && g.history.length === 2, '黑先白后轮流');
  g.undo();
  check(g.turn === 'w' && !g.board[7][8] && g.lastMove[0] === 7 && g.lastMove[1] === 7, '悔棋退回一步');
}

{
  // 长连（六子）也算赢
  const g = play([[3, 0], [9, 0], [3, 1], [9, 2], [3, 2], [9, 4], [3, 4], [9, 6], [3, 5], [9, 8], [3, 3]]);
  check(g.winner === 'b' && g.winLine.length === 6, '六子长连也算赢');
}

// 黑有四子 (7,3)-(7,6)，白要么成五要么必须挡
for (const level of Object.keys(LEVELS)) {
  if (level === 'easy') continue;
  const g = play([[7, 3], [0, 0], [7, 4], [0, 2], [7, 5], [14, 14], [7, 6]]);
  const m = findBestMove(g.board, 'w', level);
  check((m.at[0] === 7 && (m.at[1] === 2 || m.at[1] === 7)), `${LEVELS[level].name}：会挡住对方的四`);
}

for (const level of Object.keys(LEVELS)) {
  // 白有四子可以直接成五
  const g = play([[0, 0], [7, 3], [0, 2], [7, 4], [0, 4], [7, 5], [14, 14], [7, 6], [14, 12]]);
  const m = findBestMove(g.board, 'w', level);
  check(m.at[0] === 7 && (m.at[1] === 2 || m.at[1] === 7), `${LEVELS[level].name}：能成五就成五`);
}

{
  // 黑有活三 (7,5)(7,6)(7,7)，白（业余）要挡
  const g = play([[7, 5], [3, 3], [7, 6], [11, 11], [7, 7]]);
  const m = findBestMove(g.board, 'w', 'medium');
  check(m.at[0] === 7 && [3, 4, 8, 9].includes(m.at[1]), '业余：会挡活三');
}

// 两种难度对下，各执黑白一次
function match(black, white) {
  const g = new Game();
  while (!g.winner) {
    const m = findBestMove(g.board, g.turn, g.turn === 'b' ? black : white);
    g.move(m.at);
  }
  return g.winner === 'b' ? black : g.winner === 'w' ? white : 'draw';
}

const pairs = [['medium', 'easy'], ['hard', 'medium']];
for (const [strong, weak] of pairs) {
  let wins = 0;
  const games = strong === 'hard' ? 2 : 6;
  const t0 = Date.now();
  for (let i = 0; i < games; i++) {
    if ((i % 2 ? match(weak, strong) : match(strong, weak)) === strong) wins++;
  }
  check(wins > games / 2, `${LEVELS[strong].name} 对 ${LEVELS[weak].name}：${wins}/${games} 胜（${Math.round((Date.now() - t0) / 1000)} 秒）`);
}
