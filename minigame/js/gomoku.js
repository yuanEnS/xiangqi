// 五子棋规则：15×15 棋盘，黑先白后，横竖斜连成五子（或更多）获胜，不设禁手。
// 棋盘 board[r][c]：'' 空，'b' 黑子，'w' 白子。

const SIZE = 15;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

function opponent(side) {
  return side === 'b' ? 'w' : 'b';
}

function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(''));
}

function inside(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

// 在 (r, c) 落子后，这一方有没有连成五子；有就返回这条线上的所有棋子
function fiveAt(board, r, c) {
  const side = board[r][c];
  if (!side) return null;
  for (const [dr, dc] of DIRS) {
    const line = [[r, c]];
    for (const s of [1, -1]) {
      let rr = r + dr * s, cc = c + dc * s;
      while (inside(rr, cc) && board[rr][cc] === side) {
        line.push([rr, cc]);
        rr += dr * s;
        cc += dc * s;
      }
    }
    if (line.length >= 5) return line;
  }
  return null;
}

class Game {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = emptyBoard();
    this.turn = 'b';
    this.history = [];
    this.lastMove = null;
    this.winner = null; // 'b' | 'w' | 'draw'
    this.reason = null; // five | full | resign | left
    this.winLine = null;
  }

  canMove(at) {
    if (this.winner || !Array.isArray(at)) return false;
    const [r, c] = at;
    return Number.isInteger(r) && Number.isInteger(c) && inside(r, c) && !this.board[r][c];
  }

  move(at) {
    if (!this.canMove(at)) return false;
    const [r, c] = at;
    this.board[r][c] = this.turn;
    this.history.push([r, c]);
    this.lastMove = [r, c];
    const line = fiveAt(this.board, r, c);
    if (line) {
      this.end(this.turn, 'five');
      this.winLine = line;
    } else if (this.history.length === SIZE * SIZE) {
      this.end('draw', 'full');
    }
    this.turn = opponent(this.turn);
    return true;
  }

  undo() {
    const last = this.history.pop();
    if (!last) return false;
    this.board[last[0]][last[1]] = '';
    this.turn = opponent(this.turn);
    this.lastMove = this.history[this.history.length - 1] || null;
    this.winner = null;
    this.reason = null;
    this.winLine = null;
    return true;
  }

  end(winner, reason) {
    this.winner = winner;
    this.reason = reason;
  }
}

module.exports = { SIZE, DIRS, Game, opponent, emptyBoard, inside, fiveAt };
