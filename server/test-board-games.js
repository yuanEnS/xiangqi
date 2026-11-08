// 网页新棋（黑白棋、四子连珠、斗兽棋）的规则和联网房间自测：node test-board-games.js
const fs = require('fs');
const path = require('path');
const Othello = require('./rules/othello.js');
const Connect4 = require('./rules/connect4.js');
const Jungle = require('./rules/jungle.js');
const { Lobby } = require('./lobby.js');

function check(cond, label) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) process.exitCode = 1;
}

// ---------- 黑白棋 ----------
{
  const g = new Othello.Game();
  check(g.legalMoves().length === 4, '黑白棋开局黑方有 4 个位置可下');
  check(!g.move([0, 0]), '翻不了子的地方不能下');
  check(g.move([2, 3]) && g.board[3][3] === 'b' && g.turn === 'w', '落子会翻转被夹住的子');
  g.undo();
  check(g.board[3][3] === 'w' && g.turn === 'b', '悔棋恢复');
  // 白方最后一个子被翻掉，双方都没处下
  const p = new Othello.Game();
  p.board = Array.from({ length: 8 }, () => Array(8).fill(''));
  p.board[7][6] = 'w';
  p.board[7][5] = 'b';
  p.turn = 'b';
  check(p.move([7, 7]) && p.winner === 'b', '双方都没处下时数子定胜负');
}

// ---------- 四子连珠 ----------
{
  const g = new Connect4.Game();
  [3, 4, 3, 4, 3, 4].forEach(c => g.move(c));
  check(!g.winner && g.move(3) && g.winner === 'r' && g.reason === 'four', '竖着连成四子就赢');
  const f = new Connect4.Game();
  for (let i = 0; i < 6; i++) f.move(0);
  check(!f.canMove(0), '满了的列不能再放');
  const d = new Connect4.Game();
  // 斜线：红 (5,0) (4,1) (3,2) (2,3)
  [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3].forEach(c => d.move(c));
  check(d.winner === 'r', '斜着连成四子就赢');
}

// ---------- 斗兽棋 ----------
{
  const empty = () => {
    const g = new Jungle.Game();
    g.board = Array.from({ length: 9 }, () => Array(7).fill(null));
    return g;
  };
  let g = empty();
  g.board[4][0] = { side: 'r', rank: 1 };
  g.board[3][0] = { side: 'b', rank: 8 };
  g.board[8][6] = { side: 'b', rank: 2 };
  check(g.move([[4, 0], [3, 0]]), '鼠能吃象');
  g = empty();
  g.board[4][0] = { side: 'r', rank: 8 };
  g.board[3][0] = { side: 'b', rank: 1 };
  g.board[0][6] = { side: 'b', rank: 2 };
  check(!g.canMove([[4, 0], [3, 0]]), '象不能吃鼠');
  g = empty();
  g.board[4][1] = { side: 'r', rank: 1 };
  g.board[4][0] = { side: 'b', rank: 8 };
  g.board[0][6] = { side: 'b', rank: 2 };
  check(!g.canMove([[4, 1], [4, 0]]), '河里的鼠不能吃岸上的象');
  g = empty();
  g.board[6][1] = { side: 'r', rank: 7 };
  g.board[0][6] = { side: 'b', rank: 2 };
  check(g.canMove([[6, 1], [2, 1]]), '狮子能竖着跳河');
  g.board[4][1] = { side: 'b', rank: 1 };
  check(!g.canMove([[6, 1], [2, 1]]), '河里有鼠就不能跳');
  g = empty();
  g.board[3][0] = { side: 'r', rank: 6 };
  g.board[0][6] = { side: 'b', rank: 2 };
  check(g.canMove([[3, 0], [3, 3]]), '老虎能横着跳河');
  g = empty();
  g.board[0][2] = { side: 'r', rank: 8 }; // 红象掉进蓝方陷阱
  g.board[0][1] = { side: 'b', rank: 1 };
  g.board[5][6] = { side: 'r', rank: 2 };
  g.turn = 'b';
  check(g.canMove([[0, 1], [0, 2]]), '掉进对方陷阱的动物谁都能吃');
  g = empty();
  g.board[1][3] = { side: 'r', rank: 2 };
  g.board[5][6] = { side: 'b', rank: 3 };
  check(g.move([[1, 3], [0, 3]]) && g.winner === 'r' && g.reason === 'den', '走进对方兽穴就赢');
  g = empty();
  g.board[7][3] = { side: 'r', rank: 2 };
  g.board[2][6] = { side: 'b', rank: 3 };
  check(!g.canMove([[7, 3], [8, 3]]), '不能进自己的兽穴');
  const start = new Jungle.Game();
  check(start.legalMoves().length > 0 && start.board[6][0].rank === 8 && start.board[2][6].rank === 8, '开局摆放对称');
}

// ---------- 联网房间 ----------
{
  const sent = [];
  const client = name => ({ name, inbox: [], send(msg) { this.inbox.push(msg); sent.push([name, msg]); } });
  const lobby = new Lobby();
  const a = client('a'), b = client('b');
  lobby.connect(a);
  lobby.connect(b);
  lobby.message(a, { t: 'create', game: 'connect4' });
  const room = a.inbox.find(m => m.t === 'created').room;
  lobby.message(b, { t: 'join', room, game: 'othello' });
  check(b.inbox.some(m => m.t === 'error' && m.msg.includes('四子连珠')), '加入别的棋种的房间会提示');
  lobby.message(b, { t: 'join', room, game: 'connect4' });
  const red = [a, b].find(c => c.inbox.some(m => m.t === 'start' && m.color === 'r'));
  const yellow = red === a ? b : a;
  check(!!red, '四子连珠房间能开局');
  lobby.message(yellow, { t: 'move', move: 3 });
  check(yellow.inbox.some(m => m.t === 'error' && m.msg === '还没轮到你'), '没轮到不能走');
  lobby.message(red, { t: 'move', move: 9 });
  check(red.inbox.some(m => m.t === 'error' && m.msg === '走法不合法'), '不合法的走法被服务器拒绝');
  for (const [who, col] of [[red, 3], [yellow, 4], [red, 3], [yellow, 4], [red, 3], [yellow, 4], [red, 3]]) lobby.message(who, { t: 'move', move: col });
  check(yellow.inbox.some(m => m.t === 'move' && m.move === 3), '走法广播给对手');
  check(a.inbox.some(m => m.t === 'over' && m.winner === 'r' && m.reason === 'four'), '服务器判红方连成四子获胜');
  const c = client('c'), d = client('d');
  lobby.connect(c);
  lobby.connect(d);
  lobby.message(c, { t: 'match', game: 'jungle' });
  lobby.message(d, { t: 'match', game: 'jungle' });
  check(c.inbox.some(m => m.t === 'start') && d.inbox.some(m => m.t === 'start' && m.matched), '斗兽棋快速匹配能配对');
  const e = client('e'), f = client('f');
  lobby.connect(e);
  lobby.connect(f);
  lobby.message(e, { t: 'match', game: 'othello' });
  lobby.message(f, { t: 'match', game: 'connect4' });
  check(!f.inbox.some(m => m.t === 'start'), '不同棋种不会配到一起');
}

// ---------- 网站仓库里的规则和这里一样 ----------
{
  const site = path.join(__dirname, '..', '..', 'yuanEnS.github.io', 'games', 'rules');
  if (fs.existsSync(site)) {
    for (const name of ['othello.js', 'connect4.js', 'jungle.js']) {
      const same = fs.readFileSync(path.join(__dirname, 'rules', name), 'utf8') === fs.readFileSync(path.join(site, name), 'utf8');
      check(same, `网站上的 ${name} 和服务器一致（不一致就运行 node tools/copy-rules.js）`);
    }
  }
}
