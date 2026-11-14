// 网页新棋（黑白棋、四子连珠、斗兽棋、成语接龙）的规则和联网房间自测：node test-board-games.js
const fs = require('fs');
const path = require('path');
const Othello = require('./rules/othello.js');
const Connect4 = require('./rules/connect4.js');
const Jungle = require('./rules/jungle.js');
const Chengyu = require('./rules/chengyu.js');
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

// ---------- 成语接龙 ----------
{
  const g = new Chengyu.Game({ start: '一心一意' });
  check(g.start === '一心一意' && g.need().char === '意' && g.turn === 'a', '按 setup 的成语开局');
  check(g.problem('三心二意') === '要用「意」开头', '开头的字不对不能接');
  check(Chengyu.SET.has('勃然大怒') && Chengyu.SET.has('天壤之别') && Chengyu.LIST.length > 20000, '词库够大，有勃然大怒、天壤之别');
  check(g.problem('意气') === '要四个字的成语', '不是四个字不能接');
  check(g.problem('意意意意').includes('不在词库里'), '词库外的词不算');
  const word = g.options()[0];
  check(g.move(word) && g.turn === 'b' && g.last() === word, '接上以后轮到对方');
  const back = new Chengyu.Game({ start: '风卷残云' });
  check(!new Chengyu.Game({ start: '不是成语' }).start.includes('不是'), '开局的成语不在词库里就重新挑');
  // 接完以后对方无词可接，直接赢：找一个最后一个字在词库里没有开头的成语
  const none = new Set();
  const dead = Chengyu.LIST.find(w => !Chengyu.options(w, none).length && Chengyu.LIST.some(v => v[3] === w[0] && v !== w));
  const before = Chengyu.LIST.find(v => v[3] === dead[0] && v !== dead);
  if (dead && before) {
    const s = new Chengyu.Game({ start: before });
    check(s.move(dead) && s.winner === 'a' && s.reason === 'stuck', '对方无词可接时直接获胜');
  }
  check(back.start === '风卷残云', '词库里的开局成语照用');
  // 同音：一心一意（yì）后面能接「义」「亿」开头的，同音同调不能接「一 yī」
  const yin = new Chengyu.Game({ start: '一心一意', rule: 'yin' });
  check(yin.rule === 'yin' && !yin.problem('义不容辞') && !yin.problem('一帆风顺') && yin.problem('三心二意'), '同音：声调不同也能接，读音不同不行');
  const diao = new Chengyu.Game({ start: '一心一意', rule: 'diao' });
  check(!diao.problem('义不容辞') && diao.problem('一帆风顺') === '要用读 yì 的字开头', '同音同调：声调要相同');
  check(new Chengyu.Game({ start: '一心一意', rule: 'zi' }).problem('义不容辞') === '要用「意」开头', '同字：同音字不行');
  check(Chengyu.pretty('nv3') === 'nǚ' && Chengyu.pretty('gui4') === 'guì' && Chengyu.pretty('liu2') === 'liú', '拼音声调标在对的字母上');
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

// ---------- 成语接龙联网 ----------
{
  const client = name => ({ name, inbox: [], send(msg) { this.inbox.push(msg); } });
  const lobby = new Lobby();
  const a = client('a'), b = client('b');
  lobby.connect(a);
  lobby.connect(b);
  lobby.message(a, { t: 'match', game: 'chengyu' });
  lobby.message(b, { t: 'match', game: 'chengyu' });
  const sa = a.inbox.find(m => m.t === 'start'), sb = b.inbox.find(m => m.t === 'start');
  check(sa && sb && sa.setup.start === sb.setup.start && sa.turnMs === 60000, '双方开局的成语一样，带步时');
  const first = sa.color === 'a' ? a : b, second = first === a ? b : a;
  const game = new Chengyu.Game(sa.setup);
  lobby.message(first, { t: 'move', move: '意意意意' });
  check(first.inbox.some(m => m.t === 'error' && m.msg === '走法不合法'), '服务器拒绝词库外的词');
  // 挑一个对方还能接的，免得一步就无词可接直接结束
  const word = game.options().find(w => Chengyu.options(w, new Set([game.start, w])).length > 1);
  lobby.message(first, { t: 'move', move: word });
  check(second.inbox.some(m => m.t === 'move' && m.move === word), '接的成语广播给对手');
  lobby.message(first, { t: 'timeout' });
  check(!first.inbox.some(m => m.t === 'over'), '没到时间报超时不算');
  const room = first.room;
  room.turnAt -= 61000;
  lobby.message(first, { t: 'timeout' });
  check(first.inbox.some(m => m.t === 'over' && m.reason === 'timeout' && m.winner === 'a'), '超时判没超时的一方赢');
  lobby.message(a, { t: 'rematch' });
  lobby.message(b, { t: 'rematch' });
  const again = a.inbox.filter(m => m.t === 'start');
  check(again.length === 2 && again[1].color !== again[0].color, '再来一局交换先后');
  const c = client('c'), d = client('d'), e = client('e');
  [c, d, e].forEach(x => lobby.connect(x));
  lobby.message(c, { t: 'match', game: 'chengyu', variant: 'yin' });
  lobby.message(d, { t: 'match', game: 'chengyu', variant: 'zi' });
  check(!c.inbox.some(m => m.t === 'start'), '接法不同的不会配到一起');
  lobby.message(e, { t: 'match', game: 'chengyu', variant: 'yin' });
  const se = e.inbox.find(m => m.t === 'start');
  check(se && se.setup.rule === 'yin' && c.inbox.some(m => m.t === 'start'), '同音接法能配对，开局带接法');
  lobby.message(d, { t: 'create', game: 'chengyu', variant: 'diao' });
  const code = d.inbox.find(m => m.t === 'created').room;
  const f = client('f');
  lobby.connect(f);
  lobby.message(f, { t: 'join', room: code, game: 'chengyu' });
  check(f.inbox.find(m => m.t === 'start').setup.rule === 'diao', '加入房间按房主选的接法');
}

// ---------- 网站仓库里的规则和这里一样 ----------
{
  const site = path.join(__dirname, '..', '..', 'yuanEnS.github.io', 'games', 'rules');
  if (fs.existsSync(site)) {
    for (const name of ['othello.js', 'connect4.js', 'jungle.js', 'chengyu.js', 'chengyu-words.js']) {
      const same = fs.readFileSync(path.join(__dirname, 'rules', name), 'utf8') === fs.readFileSync(path.join(site, name), 'utf8');
      check(same, `网站上的 ${name} 和服务器一致（不一致就运行 node tools/copy-rules.js）`);
    }
  }
}
