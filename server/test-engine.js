// 网页版高级电脑（web/xq-engine.js，棋王以上四档）自测
//   node server/test-engine.js                         走法对照、杀棋、限时（约半分钟）
//   node server/test-engine.js match 5000 hard 4 0     新引擎每步 5 秒 对 大师，下 4 局（第 0 个开局起），红黑轮换
//   node server/test-engine.js self 2000 1000 4 0      新引擎自己对下：每步 2 秒 对 每步 1 秒（看加时间是否更强）
const { Game, allLegalMoves } = require('../minigame/js/xiangqi.js');
const { findBestMove } = require('../minigame/js/ai.js');
const engine = require('../web/xq-engine.js');

let ok = true;
function check(cond, label) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) ok = false;
}
const key = m => `${m.from}-${m.to}`;

// 开局前两步（红一步、黑一步），让对局不总是同一盘
const RED_OPEN = [
  [[7, 7], [7, 4]], [[7, 1], [7, 4]], [[6, 2], [5, 2]], [[6, 6], [5, 6]], [[9, 6], [7, 4]], [[9, 7], [7, 6]], [[9, 1], [7, 2]],
];
const BLACK_OPEN = [
  [[0, 7], [2, 6]], [[0, 1], [2, 2]], [[2, 7], [2, 4]], [[3, 6], [4, 6]], [[3, 2], [4, 2]], [[0, 2], [2, 4]], [[0, 6], [2, 4]],
];
function opening(i) {
  return [RED_OPEN[i % RED_OPEN.length], BLACK_OPEN[(i * 3 + Math.floor(i / RED_OPEN.length)) % BLACK_OPEN.length]];
}

function material(board) {
  const V = { R: 9, N: 4, C: 4.5, B: 2, A: 2, P: 1, K: 0 };
  let s = 0;
  for (const row of board) for (const p of row) if (p) s += (p === p.toUpperCase() ? 1 : -1) * V[p.toUpperCase()];
  return s;
}

// 新引擎执 newSide，对手用 ai.js 的 oldLevel
function play(newMs, oldLevel, newSide, open, maxPlies) {
  const game = new Game();
  for (const [from, to] of open) game.move(from, to);
  const times = [], depths = [];
  for (let ply = 0; ply < maxPlies && !game.winner; ply++) {
    const side = game.turn;
    let m;
    if (side === newSide) {
      const t0 = Date.now();
      m = engine.think(game.board, side, newMs, { history: game.history.map(h => h.board) });
      times.push(Date.now() - t0);
      depths.push(m.depth);
    } else {
      m = findBestMove(game.board, side, oldLevel);
    }
    if (!game.move(m.from, m.to)) {
      check(false, `非法走法 ${m.from} → ${m.to}`);
      return null;
    }
  }
  const avg = a => (a.reduce((x, y) => x + y, 0) / a.length);
  return {
    winner: game.winner, plies: game.history.length, material: material(game.board),
    avgMs: Math.round(avg(times)), maxMs: Math.max(...times), avgDepth: avg(depths).toFixed(1),
  };
}

// 新引擎自己对下：两份独立的引擎（各自的置换表），A 每步 msA，B 每步 msB
if (process.argv[2] === 'self') {
  const [msA, msB, games, offset] = process.argv.slice(3).map(Number);
  const engineA = engine;
  delete require.cache[require.resolve('../web/xq-engine.js')];
  const engineB = require('../web/xq-engine.js');
  for (let g = offset; g < offset + games; g++) {
    const sideA = g % 2 === 0 ? 'r' : 'b';
    const game = new Game();
    for (const [from, to] of opening(Math.floor(g / 2))) game.move(from, to);
    for (let ply = 0; ply < 240 && !game.winner; ply++) {
      const a = game.turn === sideA;
      const m = (a ? engineA : engineB).think(game.board, game.turn, a ? msA : msB, { history: game.history.map(h => h.board) });
      game.move(m.from, m.to);
    }
    const mat = (sideA === 'r' ? 1 : -1) * material(game.board);
    const result = !game.winner ? '和' : game.winner === sideA ? `${msA}ms 胜` : `${msB}ms 胜`;
    console.log(`第 ${g} 局 ${msA}ms 执${sideA === 'r' ? '红' : '黑'} 对 ${msB}ms：${result}，${game.history.length} 步，${msA}ms 一方子力差 ${mat >= 0 ? '+' : ''}${mat}`);
  }
  process.exit(0);
}

if (process.argv[2] === 'match') {
  const newMs = Number(process.argv[3] || 5000);
  const oldLevel = process.argv[4] || 'hard';
  const games = Number(process.argv[5] || 2);
  const offset = Number(process.argv[6] || 0);
  for (let g = offset; g < offset + games; g++) {
    const newSide = g % 2 === 0 ? 'r' : 'b';
    const open = opening(Math.floor(g / 2));
    const r = play(newMs, oldLevel, newSide, open, 240);
    if (!r) continue;
    const result = !r.winner ? '和（240 步内未分胜负）' : r.winner === newSide ? '新引擎胜' : `${oldLevel} 胜`;
    const mat = (newSide === 'r' ? 1 : -1) * r.material;
    console.log(`第 ${g} 局 新引擎执${newSide === 'r' ? '红' : '黑'} ${newMs}ms 对 ${oldLevel}：${result}，${r.plies} 步，新引擎子力差 ${mat >= 0 ? '+' : ''}${mat}，平均 ${r.avgMs}ms 最长 ${r.maxMs}ms 平均深度 ${r.avgDepth}`);
  }
  process.exit(0);
}

// 1. 合法走法和规则引擎完全一致（随机对局里的每个局面）
{
  let positions = 0, mismatch = 0;
  for (let g = 0; g < 40; g++) {
    const game = new Game();
    for (let p = 0; p < 150 && !game.winner; p++) {
      const a = allLegalMoves(game.board, game.turn).map(key).sort().join();
      const b = engine.legalMoves(game.board, game.turn).map(key).sort().join();
      positions++;
      if (a !== b) mismatch++;
      const legal = allLegalMoves(game.board, game.turn);
      const m = legal[Math.floor(Math.random() * legal.length)];
      game.move(m.from, m.to);
    }
  }
  check(mismatch === 0, `合法走法和规则引擎一致（${positions} 个局面，不一致 ${mismatch}）`);
}

// 2. 一步杀（闷宫）
{
  const game = new Game();
  game.board = Array.from({ length: 10 }, () => Array(9).fill(null));
  game.board[0][4] = 'k';
  game.board[0][3] = 'n';
  game.board[0][5] = 'n';
  game.board[9][3] = 'K';
  game.board[1][0] = 'R';
  game.board[3][5] = 'N';
  game.board[3][8] = 'p';
  const m = engine.think(game.board, 'r', 1000);
  game.move(m.from, m.to);
  check(game.winner === 'r', `找到一步杀 (${m.from} → ${m.to})，${m.ms}ms`);
}

// 3. 送上门的车要吃
{
  const game = new Game();
  game.board[9][0] = null;
  game.board[4][4] = 'R';
  const m = engine.think(game.board, 'b', 1000);
  check(String(m.to) === '4,4', `吃掉送上门的车 (${m.from} → ${m.to})`);
}

// 4. 限时：开局和中局都在时限附近出棋，不超时
for (const ms of [1000, 3000]) {
  const game = new Game();
  for (const [from, to] of opening(3)) game.move(from, to);
  const t0 = Date.now();
  const m = engine.think(game.board, game.turn, ms, { history: game.history.map(h => h.board) });
  const used = Date.now() - t0;
  check(used <= ms + 100, `限时 ${ms}ms：用了 ${used}ms，深度 ${m.depth}，${m.nodes} 个节点`);
}

// 5. 只有一步可走时马上出棋
{
  const game = new Game();
  game.board = Array.from({ length: 10 }, () => Array(9).fill(null));
  game.board[0][4] = 'k';
  game.board[9][3] = 'K';
  game.board[1][3] = 'R'; // 将只能往右走
  game.board[5][0] = 'R';
  const legal = allLegalMoves(game.board, 'b');
  const t0 = Date.now();
  const m = engine.think(game.board, 'b', 5000);
  check(legal.length === 1 && Date.now() - t0 < 200, `只有一步可走时马上出棋（${Date.now() - t0}ms）`);
  check(String(m.to) === String(legal[0].to), '走的是那唯一一步');
}

// 6. 短对局：新引擎每步 0.5 秒对大师（2.5 秒），各执一次红
{
  for (const newSide of ['r', 'b']) {
    const r = play(500, 'hard', newSide, opening(0), 200);
    const result = !r.winner ? '和' : r.winner === newSide ? '新引擎胜' : '大师胜';
    console.log(`  新引擎 0.5 秒执${newSide === 'r' ? '红' : '黑'} 对 大师：${result}，${r.plies} 步，平均深度 ${r.avgDepth}`);
  }
}

console.log(ok ? '全部通过' : '有失败');
process.exit(ok ? 0 : 1);
