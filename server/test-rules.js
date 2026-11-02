// 规则自测：从开局数所有走法（perft），和公认结果对比
const { initialBoard, allLegalMoves, applyMove, opponent, Game } = require('../minigame/js/xiangqi.js');

function perft(board, side, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of allLegalMoves(board, side)) n += perft(applyMove(board, m.from, m.to), opponent(side), depth - 1);
  return n;
}

const expected = [44, 1920, 79666];
let ok = true;
expected.forEach((want, i) => {
  const got = perft(initialBoard(), 'r', i + 1);
  console.log(`perft(${i + 1}) = ${got}，应为 ${want}`);
  if (got !== want) ok = false;
});

// 简单杀：红车 + 帅，测绝杀判定
const g = new Game();
g.board = Array.from({ length: 10 }, () => Array(9).fill(null));
g.board[0][3] = 'k';
g.board[9][4] = 'K';
g.board[2][0] = 'R';
g.board[1][8] = 'R';
g.move([2, 0], [0, 0]);
console.log('车杀结果：', g.winner, g.reason);
if (g.winner !== 'r' || g.reason !== 'checkmate') ok = false;

console.log(ok ? '全部通过' : '有失败');
process.exit(ok ? 0 : 1);
