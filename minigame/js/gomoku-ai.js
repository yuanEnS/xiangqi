// 五子棋电脑：按棋形（连五、活四、冲四、活三……）给每个空点打分。
// 入门、业余只看一步；大师在分数最高的几个点里做 α-β 搜索，限时计算。

const { SIZE, DIRS, inside, opponent } = require('./gomoku.js');

const LEVELS = {
  easy: { name: '入门', desc: '只顾自己，常漏看对方', depth: 0, defend: 0.4, pick: 4, timeMs: 0 },
  medium: { name: '业余', desc: '会攻会守，看一步', depth: 0, defend: 0.9, pick: 1, timeMs: 0 },
  hard: { name: '大师', desc: '往后多算几步，限时 1.5 秒', depth: 6, defend: 0.9, pick: 1, timeMs: 1500 },
};

// 棋形和分数：x 己方，o 对方或棋盘外，. 空
const FIVE = 1000000;
const SHAPES = [
  [FIVE, ['xxxxx']],
  [50000, ['.xxxx.']], // 活四：两头都能成五，挡不住
  [6000, ['xxxx.', '.xxxx', 'xxx.x', 'x.xxx', 'xx.xx']], // 冲四
  [5000, ['.xxx..', '..xxx.', '.xx.x.', '.x.xx.']], // 活三
  [600, ['xxx..', '..xxx', '.xxx.', 'xx.x.', '.x.xx', 'x.xx.', '.xx.x', 'xx..x', 'x..xx', 'x.x.x']], // 眠三
  [400, ['..xx..', '.x.x..', '..x.x.', '.x..x.']], // 活二
  [60, ['xx...', '...xx', '.xx..', '..xx.', 'x.x..', '..x.x', '.x.x.', 'x..x.', '.x..x']], // 眠二
];

// 一条线（字符串）里所有棋形的总分，用来给整盘棋打分
function lineValue(str) {
  let total = 0;
  for (const [score, patterns] of SHAPES) {
    for (const p of patterns) {
      let i = str.indexOf(p);
      while (i >= 0) {
        total += score;
        i = str.indexOf(p, i + 1);
      }
    }
  }
  return total;
}

// 只看经过中心点的棋形，取最大的那个
function centerShape(str) {
  for (const [score, patterns] of SHAPES) {
    for (const p of patterns) {
      let i = str.indexOf(p);
      while (i >= 0) {
        if (i <= 4 && i + p.length > 4) return score;
        i = str.indexOf(p, i + 1);
      }
    }
  }
  return 0;
}

// 在 (r, c) 下 side 方的子，四个方向能形成什么棋形；两个冲四、冲四加活三、双活三都算必胜
function pointValue(board, r, c, side) {
  let total = 0, fours = 0, threes = 0;
  for (const [dr, dc] of DIRS) {
    let str = '';
    for (let k = -4; k <= 4; k++) {
      const rr = r + dr * k, cc = c + dc * k;
      if (k === 0) str += 'x';
      else if (!inside(rr, cc)) str += 'o';
      else str += board[rr][cc] === side ? 'x' : board[rr][cc] ? 'o' : '.';
    }
    const v = centerShape(str);
    if (v >= FIVE) return FIVE;
    if (v >= 6000) fours++;
    else if (v >= 5000) threes++;
    total += v;
  }
  if (fours >= 2 || (fours && threes)) total += 40000;
  else if (threes >= 2) total += 20000;
  return total;
}

// 已有棋子周围两格内的空点；空棋盘下天元
function candidates(board) {
  const seen = new Set();
  const out = [];
  let any = false;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!board[r][c]) continue;
      any = true;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr, cc = c + dc;
          const key = rr * SIZE + cc;
          if (inside(rr, cc) && !board[rr][cc] && !seen.has(key)) {
            seen.add(key);
            out.push([rr, cc]);
          }
        }
      }
    }
  }
  if (!any) out.push([7, 7]);
  return out;
}

// 候选点按「进攻 + 防守」排序
function ranked(board, side, defend) {
  const opp = opponent(side);
  return candidates(board)
    .map(([r, c]) => {
      const attack = pointValue(board, r, c, side);
      const block = pointValue(board, r, c, opp);
      // 自己能成五最优先，其次是挡住对方的五
      const score = attack >= FIVE ? FIVE * 4 : block >= FIVE ? FIVE * 2 : attack + block * defend;
      return { at: [r, c], score };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------- 大师：增量打分 + α-β 搜索 ----------
// 所有长度 ≥ 5 的横、竖、斜线，记下每个格子经过哪几条线
const LINES = [];
const CELL_LINES = Array.from({ length: SIZE * SIZE }, () => []);
(function buildLines() {
  const add = cells => {
    if (cells.length < 5) return;
    const id = LINES.length;
    LINES.push(cells);
    for (const [r, c] of cells) CELL_LINES[r * SIZE + c].push(id);
  };
  for (let i = 0; i < SIZE; i++) {
    add(Array.from({ length: SIZE }, (_, k) => [i, k]));
    add(Array.from({ length: SIZE }, (_, k) => [k, i]));
  }
  for (let d = -(SIZE - 1); d < SIZE; d++) {
    const diag = [], anti = [];
    for (let r = 0; r < SIZE; r++) {
      const c = r - d;
      if (c >= 0 && c < SIZE) diag.push([r, c]);
      const c2 = d + SIZE - 1 - r;
      if (c2 >= 0 && c2 < SIZE) anti.push([r, c2]);
    }
    add(diag);
    add(anti);
  }
})();

class Searcher {
  constructor(board, deadline) {
    this.board = board.map(row => row.slice());
    this.deadline = deadline;
    this.nodes = 0;
    this.timeUp = false;
    this.score = { b: 0, w: 0 };
    this.lineScore = LINES.map(() => ({ b: 0, w: 0 }));
    for (let id = 0; id < LINES.length; id++) this.rescore(id);
  }

  lineString(id, side) {
    let s = 'o';
    for (const [r, c] of LINES[id]) {
      const v = this.board[r][c];
      s += v === side ? 'x' : v ? 'o' : '.';
    }
    return s + 'o';
  }

  rescore(id) {
    const old = this.lineScore[id];
    const next = { b: lineValue(this.lineString(id, 'b')), w: lineValue(this.lineString(id, 'w')) };
    this.score.b += next.b - old.b;
    this.score.w += next.w - old.w;
    this.lineScore[id] = next;
  }

  play(r, c, side) {
    this.board[r][c] = side;
    for (const id of CELL_LINES[r * SIZE + c]) this.rescore(id);
  }

  unplay(r, c) {
    this.board[r][c] = '';
    for (const id of CELL_LINES[r * SIZE + c]) this.rescore(id);
  }

  // 轮到 side 走时的局面分：先手方的棋形更值钱
  evaluate(side) {
    return this.score[side] * 1.2 - this.score[opponent(side)];
  }

  negamax(depth, alpha, beta, side) {
    if (++this.nodes % 256 === 0 && Date.now() > this.deadline) this.timeUp = true;
    if (this.timeUp) return 0;
    // 对方上一步已经连成五：这一方输了
    if (this.score[opponent(side)] >= FIVE) return -(FIVE * 10 + depth);
    if (depth === 0) return this.evaluate(side);

    const moves = ranked(this.board, side, 0.9).slice(0, depth >= 4 ? 10 : 7);
    if (!moves.length) return 0;
    // 能直接成五就不用再算了
    if (moves[0].score >= FIVE * 4) return FIVE * 10 + depth;

    let best = -Infinity;
    for (const { at: [r, c] } of moves) {
      this.play(r, c, side);
      const v = -this.negamax(depth - 1, -beta, -alpha, opponent(side));
      this.unplay(r, c);
      if (this.timeUp) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }
}

function searchBest(board, side, level) {
  const deadline = Date.now() + level.timeMs;
  const root = ranked(board, side, level.defend).slice(0, 12);
  // 成五、挡五不用搜
  if (root[0].score >= FIVE * 2) return { at: root[0].at, depth: 0 };
  let best = root[0].at, bestDepth = 0;
  for (let depth = 2; depth <= level.depth; depth += 2) {
    const s = new Searcher(board, deadline);
    let alpha = -Infinity, choice = null;
    for (const { at: [r, c] } of root) {
      s.play(r, c, side);
      const v = -s.negamax(depth - 1, -Infinity, -alpha, opponent(side));
      s.unplay(r, c);
      if (s.timeUp) break;
      if (v > alpha) {
        alpha = v;
        choice = [r, c];
      }
    }
    if (s.timeUp) break;
    best = choice || best;
    bestDepth = depth;
  }
  return { at: best, depth: bestDepth };
}

function findBestMove(board, side, levelId) {
  const level = LEVELS[levelId] || LEVELS.medium;
  if (level.depth) return searchBest(board, side, level);
  const list = ranked(board, side, level.defend);
  // 入门在前几名里随机挑一个，但看到能成五一定会下
  if (level.pick > 1 && list[0].score < FIVE * 4) {
    const top = list.slice(0, level.pick);
    return { at: top[Math.floor(Math.random() * top.length)].at, depth: 0 };
  }
  return { at: list[0].at, depth: 0 };
}

module.exports = { LEVELS, findBestMove, pointValue, FIVE };
