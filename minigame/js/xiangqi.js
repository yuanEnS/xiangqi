// 中国象棋规则引擎（小游戏客户端和服务器共用同一份代码）
// 棋盘 10 行 × 9 列：第 0 行在黑方一侧，第 9 行在红方一侧。
// 棋子用一个字母表示，大写为红方，小写为黑方：
//   K 帅/将  A 仕/士  B 相/象  N 马  R 车  C 炮  P 兵/卒

const ROWS = 10;
const COLS = 9;
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

function initialBoard() {
  return [
    'rnbakabnr',
    '.........',
    '.c.....c.',
    'p.p.p.p.p',
    '.........',
    '.........',
    'P.P.P.P.P',
    '.C.....C.',
    '.........',
    'RNBAKABNR',
  ].map(row => row.split('').map(ch => (ch === '.' ? null : ch)));
}

function sideOf(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? 'r' : 'b';
}

function opponent(side) {
  return side === 'r' ? 'b' : 'r';
}

function inBoard(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function inPalace(side, r, c) {
  return c >= 3 && c <= 5 && (side === 'r' ? r >= 7 && r <= 9 : r >= 0 && r <= 2);
}

function onOwnHalf(side, r) {
  return side === 'r' ? r >= 5 : r <= 4;
}

// 不考虑"走完后自己被将军"的走法
function pseudoMoves(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const side = sideOf(piece);
  const moves = [];
  const tryAdd = (nr, nc) => {
    if (!inBoard(nr, nc)) return;
    const target = board[nr][nc];
    if (!target || sideOf(target) !== side) moves.push([nr, nc]);
  };

  switch (piece.toUpperCase()) {
    case 'K':
      for (const [dr, dc] of ORTH) {
        if (inPalace(side, r + dr, c + dc)) tryAdd(r + dr, c + dc);
      }
      break;
    case 'A':
      for (const [dr, dc] of DIAG) {
        if (inPalace(side, r + dr, c + dc)) tryAdd(r + dr, c + dc);
      }
      break;
    case 'B':
      for (const [dr, dc] of DIAG) {
        const nr = r + 2 * dr, nc = c + 2 * dc;
        // 象不能过河，且"象眼"不能被堵
        if (inBoard(nr, nc) && onOwnHalf(side, nr) && !board[r + dr][c + dc]) tryAdd(nr, nc);
      }
      break;
    case 'N':
      for (const [dr, dc] of ORTH) {
        const lr = r + dr, lc = c + dc;
        // "蹩马腿"
        if (!inBoard(lr, lc) || board[lr][lc]) continue;
        if (dr !== 0) {
          tryAdd(r + 2 * dr, c - 1);
          tryAdd(r + 2 * dr, c + 1);
        } else {
          tryAdd(r - 1, c + 2 * dc);
          tryAdd(r + 1, c + 2 * dc);
        }
      }
      break;
    case 'R':
      for (const [dr, dc] of ORTH) {
        let nr = r + dr, nc = c + dc;
        while (inBoard(nr, nc)) {
          if (!board[nr][nc]) {
            moves.push([nr, nc]);
          } else {
            if (sideOf(board[nr][nc]) !== side) moves.push([nr, nc]);
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      break;
    case 'C':
      for (const [dr, dc] of ORTH) {
        let nr = r + dr, nc = c + dc;
        let jumped = false;
        while (inBoard(nr, nc)) {
          const target = board[nr][nc];
          if (!jumped) {
            if (!target) moves.push([nr, nc]);
            else jumped = true;
          } else if (target) {
            // 炮隔一个子吃子
            if (sideOf(target) !== side) moves.push([nr, nc]);
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      break;
    case 'P': {
      const forward = side === 'r' ? -1 : 1;
      tryAdd(r + forward, c);
      // 过河后可以横走
      if (!onOwnHalf(side, r)) {
        tryAdd(r, c - 1);
        tryAdd(r, c + 1);
      }
      break;
    }
  }
  return moves;
}

function findKing(board, side) {
  const king = side === 'r' ? 'K' : 'k';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] === king) return [r, c];
    }
  }
  return null;
}

// side 的帅/将是否被攻击（包括"将帅照面"）
function isInCheck(board, side) {
  const king = findKing(board, side);
  if (!king) return true;
  const [kr, kc] = king;

  const enemyKing = findKing(board, opponent(side));
  if (enemyKing && enemyKing[1] === kc) {
    const lo = Math.min(kr, enemyKing[0]), hi = Math.max(kr, enemyKing[0]);
    let blocked = false;
    for (let r = lo + 1; r < hi; r++) {
      if (board[r][kc]) { blocked = true; break; }
    }
    if (!blocked) return true;
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = board[r][c];
      if (!piece || sideOf(piece) === side || piece.toUpperCase() === 'K') continue;
      if (pseudoMoves(board, r, c).some(([mr, mc]) => mr === kr && mc === kc)) return true;
    }
  }
  return false;
}

function applyMove(board, from, to) {
  const next = board.map(row => row.slice());
  next[to[0]][to[1]] = next[from[0]][from[1]];
  next[from[0]][from[1]] = null;
  return next;
}

function legalMoves(board, r, c) {
  const side = sideOf(board[r][c]);
  if (!side) return [];
  return pseudoMoves(board, r, c).filter(to => !isInCheck(applyMove(board, [r, c], to), side));
}

function allLegalMoves(board, side) {
  const moves = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (sideOf(board[r][c]) !== side) continue;
      for (const to of legalMoves(board, r, c)) moves.push({ from: [r, c], to });
    }
  }
  return moves;
}

function isValidSquare(sq) {
  return Array.isArray(sq) && sq.length === 2 &&
    Number.isInteger(sq[0]) && Number.isInteger(sq[1]) && inBoard(sq[0], sq[1]);
}

// 一盘棋的状态：轮到谁、胜负、悔棋记录
class Game {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = initialBoard();
    this.turn = 'r';
    this.history = [];
    this.lastMove = null;
    this.winner = null;
    this.reason = null; // checkmate 绝杀 / stalemate 困毙 / resign 认输 / left 对方离开
  }

  canMove(from, to) {
    if (this.winner || !isValidSquare(from) || !isValidSquare(to)) return false;
    if (sideOf(this.board[from[0]][from[1]]) !== this.turn) return false;
    return legalMoves(this.board, from[0], from[1]).some(([r, c]) => r === to[0] && c === to[1]);
  }

  move(from, to) {
    if (!this.canMove(from, to)) return false;
    this.history.push({ board: this.board, lastMove: this.lastMove });
    this.board = applyMove(this.board, from, to);
    this.lastMove = { from, to };
    this.turn = opponent(this.turn);
    // 象棋里无子可走就算输（被将死或困毙）
    if (allLegalMoves(this.board, this.turn).length === 0) {
      this.winner = opponent(this.turn);
      this.reason = isInCheck(this.board, this.turn) ? 'checkmate' : 'stalemate';
    }
    return true;
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return false;
    this.board = prev.board;
    this.lastMove = prev.lastMove;
    this.turn = opponent(this.turn);
    this.winner = null;
    this.reason = null;
    return true;
  }

  end(winner, reason) {
    this.winner = winner;
    this.reason = reason;
  }

  inCheck() {
    return isInCheck(this.board, this.turn);
  }
}

module.exports = {
  ROWS,
  COLS,
  Game,
  initialBoard,
  sideOf,
  opponent,
  pseudoMoves,
  legalMoves,
  allLegalMoves,
  applyMove,
  isInCheck,
};
