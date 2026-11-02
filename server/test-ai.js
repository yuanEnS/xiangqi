// AI 自测：一步杀能不能找到、着法是否都合法、每步耗时、不同难度对弈结果
const { Game } = require('../minigame/js/xiangqi.js');
const { findBestMove } = require('../minigame/js/ai.js');

let ok = true;
function check(cond, label) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) ok = false;
}

// 一步杀（闷宫）：黑将两边被自己的马堵住，红车进到将前，有红马保护
for (const level of ['easy', 'medium', 'hard']) {
  const game = new Game();
  game.board = Array.from({ length: 10 }, () => Array(9).fill(null));
  game.board[0][4] = 'k';
  game.board[0][3] = 'n';
  game.board[0][5] = 'n';
  game.board[9][3] = 'K';
  game.board[1][0] = 'R';
  game.board[3][5] = 'N';
  game.board[3][8] = 'p';
  const m = findBestMove(game.board, 'r', level);
  game.move(m.from, m.to);
  check(game.winner === 'r', `${level} 找到一步杀 (${m.from} → ${m.to})`);
}

// 红车送到黑卒嘴边（没有任何保护），电脑执黑要吃
for (const level of ['medium', 'hard']) {
  const game = new Game();
  game.board[9][0] = null;
  game.board[4][4] = 'R';
  const m = findBestMove(game.board, 'b', level);
  check(String(m.to) === '4,4', `${level} 吃掉送上门的车 (${m.from} → ${m.to})`);
}

// 对弈：redLevel 执红，blackLevel 执黑
function play(redLevel, blackLevel, maxPlies) {
  const game = new Game();
  const times = { r: [], b: [] };
  for (let ply = 0; ply < maxPlies && !game.winner; ply++) {
    const side = game.turn;
    const t0 = Date.now();
    const m = findBestMove(game.board, side, side === 'r' ? redLevel : blackLevel);
    times[side].push(Date.now() - t0);
    if (!game.move(m.from, m.to)) {
      check(false, `非法走法 ${m.from} → ${m.to}`);
      return null;
    }
  }
  const avg = arr => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  const max = arr => Math.max(...arr);
  console.log(`  红(${redLevel}) 平均 ${avg(times.r)}ms 最长 ${max(times.r)}ms；黑(${blackLevel}) 平均 ${avg(times.b)}ms 最长 ${max(times.b)}ms`);
  return game.winner || 'draw';
}

const tally = {};
for (const [r, b] of [['medium', 'easy'], ['easy', 'medium'], ['hard', 'medium'], ['medium', 'hard'], ['hard', 'easy']]) {
  const result = play(r, b, 160);
  const winner = result === 'r' ? r : result === 'b' ? b : '和';
  tally[winner] = (tally[winner] || 0) + 1;
  console.log(`红 ${r} vs 黑 ${b}：${result === 'draw' ? '160 步内未分胜负' : (result === 'r' ? '红胜' : '黑胜')}`);
}

console.log('胜局统计：', tally);

// 开局一步看看搜索深度
const m = findBestMove(new Game().board, 'r', 'hard');
console.log(`大师开局：${m.from} → ${m.to}，深度 ${m.depth}，节点 ${m.nodes}`);

console.log(ok ? '全部通过' : '有失败');
process.exit(ok ? 0 : 1);
