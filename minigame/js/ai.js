// 人机对战：迭代加深的 Alpha-Beta 搜索 + 吃子静态搜索
// 搜索内部用"伪合法走法 + 吃掉将帅即胜"，省去每步检查是否送将，速度快很多；
// 根节点只从真正合法的走法里选，所以电脑不会走出违规的棋。
const { ROWS, COLS, pseudoMoves, allLegalMoves, opponent, sideOf } = require('./xiangqi.js');

const LEVELS = {
  easy: { name: '入门', desc: '只算两步，常有失误', maxDepth: 2, timeMs: 300, noise: 100 },
  medium: { name: '业余', desc: '会算两三步', maxDepth: 3, timeMs: 800, noise: 15 },
  hard: { name: '大师', desc: '全力计算，限时 2.5 秒', maxDepth: 20, timeMs: 2500, noise: 0 },
};

const VALUE = { K: 10000, R: 600, C: 300, N: 280, B: 120, A: 120, P: 40 };
const MATE = 100000;

// 位置分。adv 是棋子离本方底线前进了几行（0~9）
function positional(type, side, r, c) {
  const adv = side === 'r' ? 9 - r : r;
  const center = 4 - Math.abs(c - 4);
  switch (type) {
    case 'P':
      if (adv < 5) return 0;
      // 过河兵越靠近九宫越值钱，沉到底线就没什么用了
      if (adv === 9) return 20;
      return 40 + (adv - 5) * 12 + (c >= 3 && c <= 5 ? 20 : 0);
    case 'N':
      return center * 6 + Math.min(adv, 6) * 4 - (c === 0 || c === 8 ? 15 : 0);
    case 'C':
      return (c === 4 ? 15 : 0) + center * 2;
    case 'R':
      return center * 3 + (adv >= 5 ? 15 : 0);
    default:
      return 0;
  }
}

// 站在 side 一方看的局面分
function evaluate(board, side) {
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const type = piece.toUpperCase();
      const s = sideOf(piece);
      const v = VALUE[type] + positional(type, s, r, c);
      score += s === 'r' ? v : -v;
    }
  }
  return side === 'r' ? score : -score;
}

function genMoves(board, side, capturesOnly) {
  const moves = [];
  const king = side === 'r' ? 'K' : 'k';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = board[r][c];
      if (sideOf(piece) !== side) continue;
      const attacker = VALUE[piece.toUpperCase()];
      for (const [tr, tc] of pseudoMoves(board, r, c)) {
        const target = board[tr][tc];
        if (capturesOnly && !target) continue;
        // 先搜吃大子、用小子吃的走法，剪枝效率高
        const score = target ? VALUE[target.toUpperCase()] * 10 - attacker / 10 : 0;
        moves.push({ fr: r, fc: c, tr, tc, score, capture: !!target });
      }
      // 将帅照面：当成可以"飞将"吃掉对方的将，这样送将照面的走法会被立刻惩罚
      if (piece === king) {
        const dir = side === 'r' ? -1 : 1;
        for (let rr = r + dir; rr >= 0 && rr < ROWS; rr += dir) {
          const p = board[rr][c];
          if (!p) continue;
          if (p.toUpperCase() === 'K') moves.push({ fr: r, fc: c, tr: rr, tc: c, score: VALUE.K * 10, capture: true });
          break;
        }
      }
    }
  }
  return moves;
}

function byScore(a, b) {
  return b.score - a.score;
}

// Zobrist 哈希：每种棋子在每个位置一个随机数，局面哈希 = 所有棋子的随机数异或
const PIECE_INDEX = {};
'KABNRCPkabnrcp'.split('').forEach((p, i) => { PIECE_INDEX[p] = i; });
const ZOBRIST = [];
for (let i = 0; i < 14 * 90; i++) ZOBRIST.push((Math.random() * 0x7fffffff) | 0);
const SIDE_KEY = (Math.random() * 0x7fffffff) | 0;

function zobrist(piece, r, c) {
  return ZOBRIST[PIECE_INDEX[piece] * 90 + r * 9 + c];
}

const EXACT = 0, LOWER = 1, UPPER = 2;

class Search {
  constructor(board, deadline) {
    this.board = board.map(row => row.slice());
    this.deadline = deadline;
    this.nodes = 0;
    this.stopped = false;
    this.tt = new Map(); // 置换表：同一局面不重复搜索
    this.killers = []; // 每层引发剪枝的安静走法
    this.history = new Int32Array(90 * 90); // 历史上常引发剪枝的走法
    this.hash = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.board[r][c]) this.hash ^= zobrist(this.board[r][c], r, c);
      }
    }
  }

  timeUp() {
    if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) this.stopped = true;
    return this.stopped;
  }

  make(m) {
    const piece = this.board[m.fr][m.fc];
    const captured = this.board[m.tr][m.tc];
    this.hash ^= zobrist(piece, m.fr, m.fc) ^ zobrist(piece, m.tr, m.tc);
    if (captured) this.hash ^= zobrist(captured, m.tr, m.tc);
    this.board[m.tr][m.tc] = piece;
    this.board[m.fr][m.fc] = null;
    return captured;
  }

  unmake(m, captured) {
    const piece = this.board[m.tr][m.tc];
    this.hash ^= zobrist(piece, m.fr, m.fc) ^ zobrist(piece, m.tr, m.tc);
    if (captured) this.hash ^= zobrist(captured, m.tr, m.tc);
    this.board[m.fr][m.fc] = piece;
    this.board[m.tr][m.tc] = captured;
  }

  // 走法排序：置换表里的最佳走法 > 吃子 > 杀手走法 > 历史分
  order(moves, ttMove, ply) {
    const killers = this.killers[ply] || [];
    for (const m of moves) {
      if (ttMove && m.fr === ttMove.fr && m.fc === ttMove.fc && m.tr === ttMove.tr && m.tc === ttMove.tc) {
        m.score = 1e7;
      } else if (!m.capture) {
        const isKiller = killers.some(k => k.fr === m.fr && k.fc === m.fc && k.tr === m.tr && k.tc === m.tc);
        m.score = isKiller ? 300 : Math.min(250, this.history[(m.fr * 9 + m.fc) * 90 + m.tr * 9 + m.tc]);
      }
    }
    moves.sort(byScore);
  }

  negamax(depth, alpha, beta, side, ply) {
    if (this.timeUp()) return 0;
    if (depth <= 0) return this.quiesce(alpha, beta, side, ply, 0);

    const key = side === 'r' ? this.hash : this.hash ^ SIDE_KEY;
    const entry = this.tt.get(key);
    // 杀棋分和步数有关，不从置换表直接取用
    if (entry && entry.depth >= depth && Math.abs(entry.score) < MATE - 1000) {
      if (entry.flag === EXACT) return entry.score;
      if (entry.flag === LOWER && entry.score >= beta) return entry.score;
      if (entry.flag === UPPER && entry.score <= alpha) return entry.score;
    }

    const moves = genMoves(this.board, side, false);
    if (!moves.length) return -MATE + ply;
    this.order(moves, entry && entry.move, ply);

    const alphaOrig = alpha;
    let best = -Infinity, bestMove = null, first = true;
    for (const m of moves) {
      const target = this.board[m.tr][m.tc];
      if (target && target.toUpperCase() === 'K') return MATE - ply;
      const captured = this.make(m);
      let score;
      if (first) {
        score = -this.negamax(depth - 1, -beta, -alpha, opponent(side), ply + 1);
      } else {
        // 主变搜索：先用零窗口快速证明这步不如已有最佳，证明失败再完整搜索
        score = -this.negamax(depth - 1, -alpha - 1, -alpha, opponent(side), ply + 1);
        if (score > alpha && score < beta) score = -this.negamax(depth - 1, -beta, -alpha, opponent(side), ply + 1);
      }
      this.unmake(m, captured);
      if (this.stopped) return 0;
      first = false;
      if (score > best) {
        best = score;
        bestMove = m;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (!m.capture) {
          const killers = this.killers[ply] || (this.killers[ply] = []);
          killers.unshift(m);
          if (killers.length > 2) killers.pop();
          this.history[(m.fr * 9 + m.fc) * 90 + m.tr * 9 + m.tc] += depth * depth;
        }
        break;
      }
    }

    if (this.tt.size > 400000) this.tt.clear();
    const flag = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
    this.tt.set(key, { depth, score: best, flag, move: bestMove });
    return best;
  }

  // 只看吃子，避免在双方正在兑子时停下来误判
  quiesce(alpha, beta, side, ply, qdepth) {
    if (this.timeUp()) return 0;
    const standPat = evaluate(this.board, side);
    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;
    if (qdepth >= 6) return standPat;
    const moves = genMoves(this.board, side, true);
    moves.sort(byScore);
    for (const m of moves) {
      if (this.board[m.tr][m.tc].toUpperCase() === 'K') return MATE - ply;
      const captured = this.make(m);
      const score = -this.quiesce(-beta, -alpha, opponent(side), ply + 1, qdepth + 1);
      this.unmake(m, captured);
      if (this.stopped) return 0;
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }
}

// 返回 { from, to, score, depth } ；无棋可走时返回 null
function findBestMove(board, side, levelId) {
  const level = LEVELS[levelId] || LEVELS.medium;
  const legal = allLegalMoves(board, side);
  if (!legal.length) return null;

  const search = new Search(board, Date.now() + level.timeMs);
  let rootMoves = legal.map(m => ({ fr: m.from[0], fc: m.from[1], tr: m.to[0], tc: m.to[1], score: 0 }));
  let completed = rootMoves;
  let depthDone = 0;

  for (let depth = 1; depth <= level.maxDepth; depth++) {
    let alpha = -Infinity;
    for (const m of rootMoves) {
      const captured = search.make(m);
      // 带随机扰动的难度需要每个走法的准确分数，所以不收窄窗口
      const window = level.noise ? -Infinity : alpha;
      const score = -search.negamax(depth - 1, -Infinity, -window, opponent(side), 1);
      search.unmake(m, captured);
      if (search.stopped) break;
      m.score = score;
      if (score > alpha) alpha = score;
    }
    // 这一层没算完就用上一层的结果
    if (search.stopped) break;
    rootMoves.sort((a, b) => b.score - a.score);
    completed = rootMoves.map(m => Object.assign({}, m));
    depthDone = depth;
    if (Math.abs(completed[0].score) >= MATE - 100) break; // 已经算出杀棋或被杀
  }

  let best = completed[0];
  if (level.noise) {
    let bestNoisy = -Infinity;
    for (const m of completed) {
      const noisy = m.score + Math.random() * level.noise;
      if (noisy > bestNoisy) {
        bestNoisy = noisy;
        best = m;
      }
    }
  }
  return { from: [best.fr, best.fc], to: [best.tr, best.tc], score: best.score, depth: depthDone, nodes: search.nodes };
}

module.exports = { LEVELS, findBestMove };
