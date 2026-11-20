// 象棋高级电脑：网页版「棋王 / 棋圣 / 棋神 / 棋仙」四档用，在 Web Worker 里运行，不卡页面。
// 和 minigame/js/ai.js（入门 / 业余 / 大师，小游戏也用）分开：这一份只给网页用，小游戏不加载。
//
// 和大师档相比：
//   - 16×16 一维棋盘、整数编码，走法生成和判断将军快很多（同样时间搜得更深）
//   - 逐子位置分表（增量计算），比大师的估值细
//   - 空着裁剪、后期走法减少搜索深度（LMR）、将军延伸、杀棋距离裁剪
//   - 置换表用定长数组，跨步保留；静态搜索被将军时搜全部应将
//   - 识别重复局面：自己不走长将，其他重复（包括对方长将）算和棋
//   - 按时间迭代加深：到时间就停，用最后一层完整搜完（或已证明更好）的走法
//
// 用法：
//   Node：const { think } = require('./xq-engine.js'); think(board, 'r', 5000, { history })
//   Worker：postMessage({ id, board, side, timeMs, history })，回复 { type: 'info' | 'done', id, from, to, score, depth, nodes }
//   board 是 10×9 数组（和 minigame/js/xiangqi.js 一样，大写红方，小写黑方，空位 null），
//   history 是之前的局面（同样格式的棋盘，从早到晚），用来识别重复局面，可省略。
(function () {
  'use strict';

  // ---------- 常量和棋盘 ----------
  // 格子编号 sq = (行 + 3) * 16 + (列 + 3)；红方在下（行 9），黑方在上（行 0）
  const K = 0, A = 1, B = 2, N = 3, R = 4, C = 5, P = 6;
  const LETTERS = 'KABNRCP';
  const MATE = 10000, BAN = MATE - 100, WIN = MATE - 200, DRAW = 20, ADVANCED = 3;
  const MAX_PLY = 64, MAX_MOVES = 160;

  const IN_BOARD = new Uint8Array(256);
  const IN_FORT = new Uint8Array(256);
  const SQUARES = []; // 90 个棋盘上的格子
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const sq = (r + 3) * 16 + c + 3;
      IN_BOARD[sq] = 1;
      SQUARES.push(sq);
      if (c >= 3 && c <= 5 && (r <= 2 || r >= 7)) IN_FORT[sq] = 1;
    }
  }
  const KING_DELTA = [-16, -1, 1, 16];
  const ADVISOR_DELTA = [-17, -15, 15, 17];
  const KNIGHT_DELTA = [[-33, -31], [-18, 14], [-14, 18], [31, 33]]; // 和 KING_DELTA 的马腿对应
  const KNIGHT_CHECK_DELTA = [[-33, -18], [-31, -14], [14, 31], [18, 33]]; // 和 ADVISOR_DELTA 的马腿对应
  const MVV = [50, 10, 10, 30, 40, 30, 20];

  const sqOf = (r, c) => (r + 3) * 16 + c + 3;
  const rowOf = sq => (sq >> 4) - 3;
  const colOf = sq => (sq & 15) - 3;
  const sideTag = sd => 8 + (sd << 3); // 红 8~14，黑 16~22
  const homeHalf = (sq, sd) => ((sq & 0x80) !== 0) === (sd === 0); // 红方在下半（sq >= 128）
  const forward = sd => (sd === 0 ? -16 : 16);
  const SRC = mv => mv & 255;
  const DST = mv => mv >> 8;
  const MOVE = (src, dst) => src + (dst << 8);

  // ---------- 估值：每种棋子在每个位置的分数（红方视角，含子力） ----------
  function redPst(t, r, c) {
    const adv = 9 - r; // 离本方底线前进了几行
    const center = 4 - Math.abs(c - 4);
    switch (t) {
      case K:
        return [0, -15, -30][9 - r] - (c === 4 ? 0 : 6);
      case A:
        return r === 8 ? 44 : 40;
      case B:
        return r === 7 && c === 4 ? 46 : (c === 0 || c === 8) ? 36 : 40;
      case N: {
        let v = 270 + center * 5 + [0, 0, 0, 5, 10, 18, 25, 28, 20, 5][adv];
        if (c === 0 || c === 8) v -= 15;
        if (adv === 7 && (c === 2 || c === 6)) v += 15; // 卧槽
        if (adv === 9 && (c === 3 || c === 5)) v += 8; // 挂角
        if (adv === 0 && (c === 1 || c === 7)) v -= 5; // 没出动
        return v;
      }
      case C: {
        let v = 285 + (c === 4 ? (adv <= 4 ? 20 : 10) : 0) + (c === 3 || c === 5 ? 5 : 0) - (c === 0 || c === 8 ? 5 : 0);
        if (adv === 9) v += 10; // 沉底炮
        if (adv === 7 && c === 4) v += 10;
        return v;
      }
      case R: {
        let v = 600 + (c >= 3 && c <= 5 ? 10 : 0) + (c === 4 ? 2 : 0);
        if (adv >= 5) v += 15;
        if (adv === 8) v += 20; // 车占二路
        if (adv === 0 && (c === 0 || c === 8)) v -= 12; // 没出车
        return v;
      }
      case P: {
        if (adv <= 3) return 30;
        if (adv === 4) return 36;
        let v = [70, 85, 95, 90, 50][adv - 5];
        if (adv >= 6 && adv <= 8 && c >= 3 && c <= 5) v += 15 + (c === 4 ? 5 : 0);
        if (c === 0 || c === 8) v -= 10;
        return v;
      }
    }
    return 0;
  }
  const PST = [];
  for (let pc = 0; pc < 24; pc++) PST.push(new Int16Array(256));
  for (let t = 0; t < 7; t++) {
    for (const sq of SQUARES) {
      const v = redPst(t, rowOf(sq), colOf(sq));
      PST[8 + t][sq] = v;
      PST[16 + t][254 - sq] = v; // 黑方：上下翻转
    }
  }
  // 进攻子力（车马炮），用来判断能不能空着裁剪
  const ATTACK_VALUE = [0, 0, 0, 3, 6, 3, 0];

  // ---------- Zobrist 哈希（两个 32 位：key 定位，lock 校验） ----------
  let seed = 0x2545f491;
  function rand32() {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return seed | 0;
  }
  const ZKEY = [], ZLOCK = [];
  for (let pc = 0; pc < 24; pc++) {
    const k = new Int32Array(256), l = new Int32Array(256);
    for (let sq = 0; sq < 256; sq++) { k[sq] = rand32(); l[sq] = rand32(); }
    ZKEY.push(k); ZLOCK.push(l);
  }
  const SIDE_KEY = rand32(), SIDE_LOCK = rand32();

  // 置换表：定长数组，2^20 项（约 14 MB），跨步保留
  const TT_BITS = 20, TT_MASK = (1 << TT_BITS) - 1;
  const ttLock = new Int32Array(1 << TT_BITS);
  const ttMove = new Int32Array(1 << TT_BITS);
  const ttValue = new Int16Array(1 << TT_BITS);
  const ttDepth = new Int8Array(1 << TT_BITS);
  const ttFlag = new Uint8Array(1 << TT_BITS); // 0 空 1 上界 2 下界 3 准确
  const UPPER = 1, LOWER = 2, EXACT = 3;

  // ---------- 局面 ----------
  const board = new Uint8Array(256);
  let sd = 0, key = 0, lock = 0, ply = 0;
  const vl = [0, 0];
  const attack = [0, 0];
  const kingSq = [0, 0];
  // 走过的棋（含历史局面），用来悔棋和识别重复
  const STACK = 1024;
  const mvList = new Int32Array(STACK), pcList = new Uint8Array(STACK), chkList = new Uint8Array(STACK);
  const keyList = new Int32Array(STACK);
  let top = 0;

  function addPiece(sq, pc) {
    board[sq] = pc;
    const s = pc >> 4; // 红 0 黑 1
    vl[s] += PST[pc][sq];
    attack[s] += ATTACK_VALUE[pc & 7];
    key ^= ZKEY[pc][sq]; lock ^= ZLOCK[pc][sq];
    if ((pc & 7) === K) kingSq[s] = sq;
  }
  function delPiece(sq, pc) {
    board[sq] = 0;
    const s = pc >> 4;
    vl[s] -= PST[pc][sq];
    attack[s] -= ATTACK_VALUE[pc & 7];
    key ^= ZKEY[pc][sq]; lock ^= ZLOCK[pc][sq];
  }

  function setBoard(rows, side) {
    board.fill(0);
    vl[0] = vl[1] = attack[0] = attack[1] = 0;
    key = lock = 0;
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const ch = rows[r][c];
        if (!ch) continue;
        const upper = ch.toUpperCase();
        addPiece(sqOf(r, c), (ch === upper ? 8 : 16) + LETTERS.indexOf(upper));
      }
    }
    sd = side;
    if (sd) { key ^= SIDE_KEY; lock ^= SIDE_LOCK; }
    top = 0;
    mvList[0] = 0; pcList[0] = 0; chkList[0] = checked() ? 1 : 0; keyList[0] = key;
    ply = 0;
  }

  // sd 一方的帅/将是否被攻击（含将帅照面）
  function checked() {
    const self = sideTag(sd), opp = sideTag(1 - sd);
    const sq = kingSq[sd];
    if (board[sq] !== self + K) return true;
    // 兵/卒
    if (board[sq + forward(sd)] === opp + P || board[sq - 1] === opp + P || board[sq + 1] === opp + P) return true;
    // 马
    for (let i = 0; i < 4; i++) {
      if (board[sq + ADVISOR_DELTA[i]]) continue;
      const d = KNIGHT_CHECK_DELTA[i];
      if (board[sq + d[0]] === opp + N || board[sq + d[1]] === opp + N) return true;
    }
    // 车、炮、对面的将
    for (let i = 0; i < 4; i++) {
      const d = KING_DELTA[i];
      let dst = sq + d;
      while (IN_BOARD[dst] && !board[dst]) dst += d;
      if (!IN_BOARD[dst]) continue;
      const pc = board[dst];
      if (pc === opp + R || pc === opp + K) return true;
      dst += d;
      while (IN_BOARD[dst] && !board[dst]) dst += d;
      if (IN_BOARD[dst] && board[dst] === opp + C) return true;
    }
    return false;
  }

  // 走一步；走完自己被将军就退回并返回 false
  function makeMove(mv) {
    const src = SRC(mv), dst = DST(mv);
    const pc = board[src], cap = board[dst];
    if (cap) delPiece(dst, cap);
    delPiece(src, pc);
    addPiece(dst, pc);
    if (checked()) {
      delPiece(dst, pc);
      addPiece(src, pc);
      if (cap) addPiece(dst, cap);
      return false;
    }
    sd ^= 1; key ^= SIDE_KEY; lock ^= SIDE_LOCK;
    top++;
    mvList[top] = mv; pcList[top] = cap; keyList[top] = key;
    chkList[top] = checked() ? 1 : 0;
    ply++;
    return true;
  }
  function undoMove() {
    const mv = mvList[top], cap = pcList[top];
    top--; ply--;
    sd ^= 1; key ^= SIDE_KEY; lock ^= SIDE_LOCK;
    const src = SRC(mv), dst = DST(mv);
    const pc = board[dst];
    delPiece(dst, pc);
    addPiece(src, pc);
    if (cap) addPiece(dst, cap);
  }
  function nullMove() {
    sd ^= 1; key ^= SIDE_KEY; lock ^= SIDE_LOCK;
    top++;
    mvList[top] = 0; pcList[top] = 0; keyList[top] = key; chkList[top] = 0;
    ply++;
  }
  function undoNull() {
    top--; ply--;
    sd ^= 1; key ^= SIDE_KEY; lock ^= SIDE_LOCK;
  }

  function evaluate() {
    return (sd === 0 ? vl[0] - vl[1] : vl[1] - vl[0]) + ADVANCED;
  }
  function drawValue() {
    return (ply & 1) === 0 ? -DRAW : DRAW; // 电脑不爱和棋
  }

  // 重复局面：返回 0 没有重复；否则 1 + 2(本方长将) + 4(对方长将)
  function repStatus() {
    let self = false, selfCheck = true, oppCheck = true;
    let i = top;
    while (mvList[i] > 0 && pcList[i] === 0) {
      if (self) {
        selfCheck = selfCheck && chkList[i] === 1;
        if (keyList[i - 1] === key) return 1 + (selfCheck ? 2 : 0) + (oppCheck ? 4 : 0);
      } else {
        oppCheck = oppCheck && chkList[i] === 1;
      }
      self = !self;
      i--;
    }
    return 0;
  }
  // 自己长将算输（电脑不走长将）；对方长将只算和：这里的对局不判长将负，对方可以一直将下去
  function repValue(status) {
    return (status & 2) && !(status & 4) ? -BAN : drawValue();
  }

  // ---------- 走法生成 ----------
  const moveBuf = [], scoreBuf = [];
  for (let i = 0; i <= MAX_PLY + 1; i++) { moveBuf.push(new Int32Array(MAX_MOVES)); scoreBuf.push(new Int32Array(MAX_MOVES)); }

  function genMoves(mvs, capOnly) {
    const self = sideTag(sd), opp = sideTag(1 - sd);
    let n = 0;
    for (let i = 0; i < 90; i++) {
      const src = SQUARES[i];
      const pc = board[src];
      if ((pc & self) === 0) continue;
      switch (pc - self) {
        case K:
          for (let j = 0; j < 4; j++) {
            const dst = src + KING_DELTA[j];
            if (!IN_FORT[dst]) continue;
            const t = board[dst];
            if (capOnly ? (t & opp) : (t & self) === 0) mvs[n++] = MOVE(src, dst);
          }
          break;
        case A:
          for (let j = 0; j < 4; j++) {
            const dst = src + ADVISOR_DELTA[j];
            if (!IN_FORT[dst]) continue;
            const t = board[dst];
            if (capOnly ? (t & opp) : (t & self) === 0) mvs[n++] = MOVE(src, dst);
          }
          break;
        case B:
          for (let j = 0; j < 4; j++) {
            const eye = src + ADVISOR_DELTA[j];
            const dst = eye + ADVISOR_DELTA[j];
            if (!IN_BOARD[dst] || !homeHalf(dst, sd) || board[eye]) continue;
            const t = board[dst];
            if (capOnly ? (t & opp) : (t & self) === 0) mvs[n++] = MOVE(src, dst);
          }
          break;
        case N:
          for (let j = 0; j < 4; j++) {
            const pin = src + KING_DELTA[j];
            if (board[pin] || !IN_BOARD[pin]) continue;
            for (let k = 0; k < 2; k++) {
              const dst = src + KNIGHT_DELTA[j][k];
              if (!IN_BOARD[dst]) continue;
              const t = board[dst];
              if (capOnly ? (t & opp) : (t & self) === 0) mvs[n++] = MOVE(src, dst);
            }
          }
          break;
        case R:
          for (let j = 0; j < 4; j++) {
            const d = KING_DELTA[j];
            let dst = src + d;
            while (IN_BOARD[dst]) {
              const t = board[dst];
              if (!t) {
                if (!capOnly) mvs[n++] = MOVE(src, dst);
              } else {
                if (t & opp) mvs[n++] = MOVE(src, dst);
                break;
              }
              dst += d;
            }
          }
          break;
        case C:
          for (let j = 0; j < 4; j++) {
            const d = KING_DELTA[j];
            let dst = src + d;
            while (IN_BOARD[dst] && !board[dst]) {
              if (!capOnly) mvs[n++] = MOVE(src, dst);
              dst += d;
            }
            dst += d;
            while (IN_BOARD[dst] && !board[dst]) dst += d;
            if (IN_BOARD[dst] && (board[dst] & opp)) mvs[n++] = MOVE(src, dst);
          }
          break;
        case P: {
          let dst = src + forward(sd);
          if (IN_BOARD[dst]) {
            const t = board[dst];
            if (capOnly ? (t & opp) : (t & self) === 0) mvs[n++] = MOVE(src, dst);
          }
          if (!homeHalf(src, sd)) {
            for (const d of [-1, 1]) {
              dst = src + d;
              if (!IN_BOARD[dst]) continue;
              const t = board[dst];
              if (capOnly ? (t & opp) : (t & self) === 0) mvs[n++] = MOVE(src, dst);
            }
          }
          break;
        }
      }
    }
    return n;
  }

  // ---------- 搜索 ----------
  const history = new Int32Array(65536);
  const killers = new Int32Array((MAX_PLY + 2) * 2);
  let nodes = 0, deadline = 0, stopped = false;

  function timeUp() {
    if ((++nodes & 1023) === 0 && Date.now() >= deadline) stopped = true;
    return stopped;
  }

  function mvvLva(mv) {
    return (MVV[board[DST(mv)] & 7] << 3) - MVV[board[SRC(mv)] & 7];
  }

  // 从第 i 个起找分数最高的换到第 i 个（边搜边排，剪枝早时省掉排序）
  function pick(mvs, scores, i, n) {
    let best = i;
    for (let j = i + 1; j < n; j++) if (scores[j] > scores[best]) best = j;
    if (best !== i) {
      const m = mvs[i]; mvs[i] = mvs[best]; mvs[best] = m;
      const s = scores[i]; scores[i] = scores[best]; scores[best] = s;
    }
    return mvs[i];
  }

  function probe(alpha, beta, depth, out) {
    const idx = key & TT_MASK;
    if (ttFlag[idx] === 0 || ttLock[idx] !== lock) { out[0] = 0; return null; }
    out[0] = ttMove[idx];
    if (ttDepth[idx] < depth) return null;
    let v = ttValue[idx];
    if (v > WIN) v -= ply;
    else if (v < -WIN) v += ply;
    const f = ttFlag[idx];
    if (f === EXACT) return v;
    if (f === LOWER && v >= beta) return v;
    if (f === UPPER && v <= alpha) return v;
    return null;
  }
  function store(flag, v, depth, mv) {
    // 和走法路径有关的分数（长将判负）不存
    if (v > WIN) { if (v <= BAN) return; v += ply; }
    else if (v < -WIN) { if (v >= -BAN) return; v -= ply; }
    const idx = key & TT_MASK;
    if (ttFlag[idx] && ttLock[idx] === lock && ttDepth[idx] > depth) return;
    ttLock[idx] = lock; ttFlag[idx] = flag; ttValue[idx] = v; ttDepth[idx] = depth; ttMove[idx] = mv;
  }

  const ttOut = [0];

  function quiesce(alpha, beta) {
    if (timeUp()) return 0;
    let v = ply - MATE;
    if (v >= beta) return v;
    const rep = repStatus();
    if (rep) return repValue(rep);
    if (ply >= MAX_PLY) return evaluate();

    const inCheck = chkList[top] === 1;
    const mvs = moveBuf[ply], scores = scoreBuf[ply];
    let best, n;
    if (inCheck) {
      best = ply - MATE;
      n = genMoves(mvs, false);
      for (let i = 0; i < n; i++) scores[i] = board[DST(mvs[i])] ? (1 << 20) + mvvLva(mvs[i]) : history[mvs[i]];
    } else {
      best = evaluate();
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
      n = genMoves(mvs, true);
      for (let i = 0; i < n; i++) scores[i] = mvvLva(mvs[i]);
    }
    for (let i = 0; i < n; i++) {
      const mv = pick(mvs, scores, i, n);
      if (!makeMove(mv)) continue;
      v = -quiesce(-beta, -alpha);
      undoMove();
      if (stopped) return 0;
      if (v > best) {
        best = v;
        if (v >= beta) return v;
        if (v > alpha) alpha = v;
      }
    }
    return best;
  }

  function search(depth, alpha, beta, noNull) {
    if (depth <= 0) return quiesce(alpha, beta);
    if (timeUp()) return 0;
    // 杀棋距离裁剪
    let v = ply - MATE;
    if (v >= beta) return v;
    const rep = repStatus();
    if (rep) return repValue(rep);
    if (ply >= MAX_PLY) return evaluate();

    const hashed = probe(alpha, beta, depth, ttOut);
    const hashMv = ttOut[0];
    if (hashed !== null) return hashed;

    const inCheck = chkList[top] === 1;
    // 空着裁剪：让对方连走一步还压不住，这个局面不用细算。残局子力少时容易误判（等着），不用
    if (!noNull && !inCheck && depth >= 2 && beta - alpha === 1 && attack[sd] >= 6 && beta > -WIN && beta < WIN) {
      nullMove();
      v = -search(depth - 1 - (depth >= 6 ? 3 : 2), -beta, 1 - beta, true);
      undoNull();
      if (stopped) return 0;
      if (v >= beta) return v > WIN ? beta : v;
    }

    const mvs = moveBuf[ply], scores = scoreBuf[ply];
    const n = genMoves(mvs, false);
    const k0 = killers[ply * 2], k1 = killers[ply * 2 + 1];
    for (let i = 0; i < n; i++) {
      const mv = mvs[i];
      if (mv === hashMv) scores[i] = 1 << 30;
      else if (board[DST(mv)]) scores[i] = (1 << 20) + mvvLva(mv);
      else if (mv === k0) scores[i] = (1 << 19) + 1;
      else if (mv === k1) scores[i] = 1 << 19;
      else scores[i] = history[mv];
    }

    const alphaOrig = alpha;
    let best = -MATE, bestMv = 0, legal = 0;
    for (let i = 0; i < n; i++) {
      const mv = pick(mvs, scores, i, n);
      const capture = board[DST(mv)] !== 0;
      if (!makeMove(mv)) continue;
      legal++;
      const givesCheck = chkList[top] === 1;
      const newDepth = givesCheck ? depth : depth - 1; // 将军延伸
      if (legal === 1) {
        v = -search(newDepth, -beta, -alpha, false);
      } else {
        // 排在后面的安静走法先少算一两层，看着有戏再补算
        let reduce = 0;
        if (depth >= 3 && legal > 3 && !capture && !inCheck && !givesCheck && mv !== k0 && mv !== k1) {
          reduce = legal > 12 && depth >= 5 ? 2 : 1;
        }
        v = -search(newDepth - reduce, -alpha - 1, -alpha, false);
        if (v > alpha && reduce) v = -search(newDepth, -alpha - 1, -alpha, false);
        if (v > alpha && v < beta) v = -search(newDepth, -beta, -alpha, false);
      }
      undoMove();
      if (stopped) return 0;
      if (v > best) {
        best = v;
        bestMv = mv;
        if (v > alpha) {
          alpha = v;
          if (v >= beta) {
            if (!capture) {
              if (killers[ply * 2] !== mv) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = mv; }
              history[mv] += depth * depth;
              if (history[mv] > 1 << 18) for (let j = 0; j < 65536; j++) history[j] >>= 1;
            }
            break;
          }
        }
      }
    }
    if (legal === 0) return ply - MATE; // 被将死或困毙都算输
    store(best >= beta ? LOWER : best > alphaOrig ? EXACT : UPPER, best, depth, bestMv);
    return best;
  }

  // ---------- 对外接口 ----------
  function toBoardSq(sq) { return [rowOf(sq), colOf(sq)]; }

  // 把历史局面串起来（找出每两个相邻局面之间走的那步），用于识别重复
  function setPosition(rows, side, past) {
    const boards = (past || []).slice(-100).concat([rows]);
    // 往前推出第一个局面轮到谁走
    const first = (side + boards.length - 1) & 1;
    setBoard(boards[0], first);
    for (let i = 1; i < boards.length; i++) {
      const a = boards[i - 1], b = boards[i];
      let src = -1, dst = -1;
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          if (a[r][c] === b[r][c]) continue;
          if (!b[r][c]) src = sqOf(r, c);
          else dst = sqOf(r, c);
        }
      }
      if (src < 0 || dst < 0 || !makeMove(MOVE(src, dst))) {
        setBoard(rows, side); // 历史接不上（不该发生），就只用当前局面
        return;
      }
    }
    ply = 0;
  }

  // 返回 { from, to, score, depth, nodes }；无棋可走返回 null
  function think(rows, sideChar, timeMs, opts) {
    opts = opts || {};
    const start = Date.now();
    setPosition(rows, sideChar === 'b' ? 1 : 0, opts.history);
    deadline = start + Math.max(50, timeMs);
    stopped = false;
    nodes = 0;
    killers.fill(0);
    for (let i = 0; i < 65536; i++) history[i] >>= 2;

    // 根节点：只留合法走法
    const all = new Int32Array(MAX_MOVES);
    const total = genMoves(all, false);
    let root = [];
    for (let i = 0; i < total; i++) {
      if (makeMove(all[i])) { undoMove(); root.push(all[i]); }
    }
    if (!root.length) return null;
    // 先按吃子排一下
    root.sort((x, y) => (board[DST(y)] ? mvvLva(y) + 1000 : 0) - (board[DST(x)] ? mvvLva(x) + 1000 : 0));
    const hashIdx = key & TT_MASK;
    if (ttFlag[hashIdx] && ttLock[hashIdx] === lock) {
      const i = root.indexOf(ttMove[hashIdx]);
      if (i > 0) root.unshift(root.splice(i, 1)[0]);
    }

    let bestMv = root[0], bestScore = 0, depthDone = 0;
    const report = () => {
      const result = { from: toBoardSq(SRC(bestMv)), to: toBoardSq(DST(bestMv)), score: bestScore, depth: depthDone, nodes, ms: Date.now() - start };
      if (opts.onInfo) opts.onInfo(result);
      return result;
    };
    if (root.length === 1) return report();

    const maxDepth = opts.maxDepth || MAX_PLY - 4;
    for (let depth = 1; depth <= maxDepth; depth++) {
      // 渴望窗口：先在上一层分数附近窄窗口搜，落到窗口外再放宽
      let window = depth >= 4 ? 40 : MATE;
      let alpha = Math.max(-MATE, bestScore - window), beta = Math.min(MATE, bestScore + window);
      let iterBest = 0, iterScore = -MATE;
      for (;;) {
        const alphaStart = alpha;
        iterBest = 0; iterScore = -MATE;
        for (let i = 0; i < root.length; i++) {
          const mv = root[i];
          makeMove(mv);
          const newDepth = chkList[top] ? depth : depth - 1;
          let v;
          if (i === 0) {
            v = -search(newDepth, -beta, -alpha, false);
          } else {
            v = -search(newDepth, -alpha - 1, -alpha, false);
            if (v > alpha && v < beta) v = -search(newDepth, -beta, -alpha, false);
          }
          undoMove();
          if (stopped) break;
          if (v > iterScore) {
            iterScore = v;
            iterBest = mv;
            if (v > alpha) {
              alpha = v;
              // 这一层已经证明比原先的好：没搜完也可以用它
              bestMv = mv; bestScore = v;
              if (i > 0) { root.splice(i, 1); root.unshift(mv); }
              if (v >= beta) break;
            }
          }
        }
        if (stopped) break;
        if (iterScore <= alphaStart && alphaStart > -MATE) { alpha = -MATE; beta = Math.min(MATE, iterScore + 1); continue; }
        if (iterScore >= beta && beta < MATE) { alpha = Math.max(-MATE, iterScore - 1); beta = MATE; continue; }
        break;
      }
      if (stopped) break;
      bestMv = iterBest;
      bestScore = iterScore;
      depthDone = depth;
      store(EXACT, bestScore, depth, bestMv);
      report();
      if (Math.abs(bestScore) > BAN) break; // 已经算出杀棋或被杀
    }
    return report();
  }

  // 所有合法走法（自测用，和规则引擎对照）
  function legalMoves(rows, sideChar) {
    setBoard(rows, sideChar === 'b' ? 1 : 0);
    const all = new Int32Array(MAX_MOVES);
    const n = genMoves(all, false);
    const out = [];
    for (let i = 0; i < n; i++) {
      if (makeMove(all[i])) { undoMove(); out.push({ from: toBoardSq(SRC(all[i])), to: toBoardSq(DST(all[i])) }); }
    }
    return out;
  }

  const api = { think, legalMoves };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    self.onmessage = e => {
      const d = e.data;
      const result = think(d.board, d.side, d.timeMs, {
        history: d.history,
        onInfo: info => self.postMessage(Object.assign({ type: 'info', id: d.id }, info)),
      });
      self.postMessage(Object.assign({ type: 'done', id: d.id }, result || { from: null }));
    };
  }
})();
