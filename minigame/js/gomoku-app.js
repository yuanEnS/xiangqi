// 五子棋：首页、人机设置、联网流程、对局画面
// 手机上格子小，落子要点两下：第一下放一枚半透明的预览子，再点同一处才落下。
const { SIZE, Game } = require('./gomoku.js');
const { drawGoBoard, drawStone, drawGoPreview } = require('./draw.js');
const { LEVELS, findBestMove } = require('./gomoku-ai.js');
const Net = require('./net.js');
const { SERVER_URL } = require('./config.js');
const ui = require('./ui.js');

const { W, ctx, contentTop, ACTION_H, settings, saveSettings, theme, text, button, buttonRow, header } = ui;
const render = ui.render;

// 15 路棋盘，四周各留 0.6 格放边框
const L = ui.playLayout(SIZE + 0.2, SIZE + 0.2);
const cell = L.cell;
const boardX = W / 2 - ((SIZE - 1) / 2) * cell; // 左上角交叉点
const boardY = L.boardTop + cell * 0.6;

if (!LEVELS[settings.gomokuLevel]) settings.gomokuLevel = 'medium';
if (!['b', 'w', 'random'].includes(settings.gomokuSide)) settings.gomokuSide = 'b';

function stoneIcon(side) {
  return (x, y, r) => drawStone(ctx, theme(), side, x, y, r * 0.9);
}

// ---------- 状态 ----------
const net = new Net();
let onExit = null;
const state = {
  scene: 'menu', // menu | aiSetup | matching | connecting | waiting | playing
  mode: null, // online | ai | local
  aiThinking: false,
  aiToken: 0,
  roomCode: '',
  matched: false,
  matchStart: 0,
  matchOnline: 0,
  myColor: 'b',
  game: new Game(),
  pending: null, // 点了一下、还没确认的落点
  resultAt: 0, // 分出胜负后过一会儿再弹结算框，先让人看清连成的五子
  awaitingServer: false,
  rematchSent: false,
  opponentWantsRematch: false,
  opponentLeft: false,
};

function colorName(color) {
  return color === 'b' ? '黑' : '白';
}

function cancelAi() {
  state.aiToken++;
  state.aiThinking = false;
}

function goMenu() {
  net.close();
  cancelAi();
  state.scene = 'menu';
  state.mode = null;
  state.pending = null;
  render();
}

// ---------- 联网 ----------
net.onMessage = msg => {
  switch (msg.t) {
    case 'created':
      state.scene = 'waiting';
      state.roomCode = msg.room;
      break;
    case 'matching':
      state.scene = 'matching';
      state.matchOnline = msg.online;
      break;
    case 'start':
      state.mode = 'online';
      state.scene = 'playing';
      state.roomCode = msg.room;
      state.matched = !!msg.matched;
      state.myColor = msg.color;
      state.game = new Game();
      state.pending = null;
      state.awaitingServer = false;
      state.rematchSent = false;
      state.opponentWantsRematch = false;
      state.opponentLeft = false;
      state.me = msg.me;
      state.opponent = msg.opponent;
      state.ratingChange = null;
      ui.toast(`${msg.matched ? '匹配成功' : '开局'}！你执${colorName(msg.color)}`);
      break;
    case 'move':
      state.game.move(msg.at);
      state.awaitingServer = false;
      state.pending = null;
      break;
    case 'over':
      if (!state.game.winner) state.game.end(msg.winner, msg.reason);
      state.pending = null;
      break;
    case 'rating':
      state.ratingChange = msg;
      if (state.me) state.me.rating = msg.rating;
      break;
    case 'rematch_request':
      state.opponentWantsRematch = true;
      ui.toast('对方想再来一局');
      break;
    case 'opponent_left':
      state.opponentLeft = true;
      if (state.scene === 'playing' && !state.game.winner) state.game.end(state.myColor, 'left');
      ui.toast('对方已离开');
      break;
    case 'error':
      state.awaitingServer = false;
      ui.toast(msg.msg);
      if (state.scene === 'connecting') {
        goMenu();
        return;
      }
      break;
  }
  render();
};

net.onClose = () => {
  if (state.mode === 'local' || state.scene === 'menu') return;
  if (state.scene === 'playing' && state.game.winner) {
    state.opponentLeft = true;
    render();
    return;
  }
  ui.toast('连接服务器失败或已断开');
  goMenu();
};

function startMatch() {
  state.scene = 'matching';
  state.matchStart = Date.now();
  state.matchOnline = 0;
  net.send({ t: 'match', game: 'gomoku' });
  render();
}

function createRoom() {
  state.scene = 'connecting';
  net.send({ t: 'create', game: 'gomoku' });
  render();
}

function joinRoom() {
  ui.askRoomCode(code => {
    state.scene = 'connecting';
    net.send({ t: 'join', room: code, game: 'gomoku' });
    render();
  });
}

function startLocal() {
  state.mode = 'local';
  state.scene = 'playing';
  state.game = new Game();
  state.pending = null;
  render();
}

// ---------- 人机对战 ----------
function startAi() {
  cancelAi();
  state.mode = 'ai';
  state.scene = 'playing';
  state.myColor = settings.gomokuSide === 'random' ? (Math.random() < 0.5 ? 'b' : 'w') : settings.gomokuSide;
  state.game = new Game();
  state.pending = null;
  render();
  maybeAiMove();
}

function maybeAiMove() {
  const game = state.game;
  if (state.mode !== 'ai' || game.winner || game.turn === state.myColor) return;
  state.aiThinking = true;
  const token = ++state.aiToken;
  render();
  setTimeout(() => {
    if (token !== state.aiToken) return;
    const m = findBestMove(game.board, game.turn, settings.gomokuLevel);
    game.move(m.at);
    state.aiThinking = false;
    state.pending = null;
    render();
  }, 60);
}

function undoAi() {
  const game = state.game;
  cancelAi();
  do {
    if (!game.undo()) break;
  } while (game.turn !== state.myColor);
  state.pending = null;
  render();
  maybeAiMove();
}

// 提示：把建议的落点放成预览子，再点一下就落下
function showHint() {
  const game = state.game;
  const m = findBestMove(game.board, state.myColor, 'medium');
  state.pending = m.at;
  render();
}

function openMenu() {
  const game = state.game;
  if (state.mode === 'local' || state.mode === 'ai') {
    ui.actionSheet([
      ['重新开始', () => ui.confirmThen('重新开始这一局？', state.mode === 'ai' ? startAi : startLocal)],
      ['返回首页', goMenu],
    ]);
  } else if (game.winner) {
    ui.actionSheet([['返回首页', goMenu]]);
  } else {
    ui.actionSheet([
      ['认输', () => ui.confirmThen('确定认输吗？', () => net.send({ t: 'resign' }))],
      ['离开房间', () => ui.confirmThen('现在离开会判负，确定吗？', goMenu)],
    ]);
  }
}

// ---------- 点击 ----------
function toScreen(r, c) {
  return [boardX + c * cell, boardY + r * cell];
}

function fromScreen(x, y) {
  const c = Math.round((x - boardX) / cell);
  const r = Math.round((y - boardY) / cell);
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
  return [r, c];
}

function onBoardTap(r, c) {
  const game = state.game;
  if (game.winner || state.awaitingServer || state.aiThinking) return;
  if (state.mode !== 'local' && game.turn !== state.myColor) return;
  if (game.board[r][c]) return;

  const p = state.pending;
  if (!p || p[0] !== r || p[1] !== c) {
    state.pending = [r, c];
  } else if (state.mode === 'online') {
    state.awaitingServer = true;
    net.send({ t: 'move', at: [r, c] });
  } else {
    game.move([r, c]);
    state.pending = null;
    maybeAiMove();
  }
  render();
}

// ---------- 首页 ----------
function drawHome() {
  ui.drawDecor();
  if (onExit) {
    header('五子棋', onExit);
  } else {
    stoneIcon('b')(33, ui.titleY, 17);
    text('五子棋', 60, ui.titleY, 22, theme().ui.primary, { bold: true, align: 'left' });
  }
  ui.accountButton();
  const entries = [
    { side: 'b', title: '快速匹配', sub: '自动匹配正在找棋友的人', onTap: startMatch, online: true },
    { side: 'w', title: '创建房间', sub: '生成房间号，邀请好友联网对战', onTap: createRoom, online: true },
    { side: 'b', title: '加入房间', sub: '输入好友发来的房间号', onTap: joinRoom, online: true },
    { side: 'w', title: '人机对战', sub: '和电脑下棋 · 入门 / 业余 / 大师', onTap: () => { state.scene = 'aiSetup'; render(); } },
    { side: 'b', title: '本地双人', sub: '同一台设备，轮流落子', onTap: startLocal },
    { side: 'w', title: '棋盘主题', sub: ui.THEMES.map(t => t.name).join(' · '), onTap: ui.openThemes },
  ].filter(entry => SERVER_URL || !entry.online);
  ui.entryCards(entries.map(entry => ({ ...entry, icon: stoneIcon(entry.side) })));
}

function drawAiSetup() {
  ui.drawDecor();
  header('人机对战', goMenu);
  const colors = theme().ui;
  const x = 16, w = W - 32;
  let y = contentTop + 6;

  text('难度', x, y + 10, 16, colors.text, { bold: true, align: 'left' });
  y += 28;
  for (const id of Object.keys(LEVELS)) {
    ui.levelCard(x, y, w, LEVELS[id], settings.gomokuLevel === id, () => {
      settings.gomokuLevel = id;
      saveSettings();
      render();
    });
    y += 66;
  }

  y += 8;
  text('执子', x, y + 10, 16, colors.text, { bold: true, align: 'left' });
  y += 28;
  const sides = [['b', '执黑先手'], ['random', '随机'], ['w', '执白后手']];
  const bw = (w - 20) / 3;
  sides.forEach(([id, label], i) => {
    button(label, x + i * (bw + 10), y, bw, 42, () => {
      settings.gomokuSide = id;
      saveSettings();
      render();
    }, settings.gomokuSide !== id);
  });

  y += 72;
  button('开始对局', x, y, w, 50, startAi);
}

// ---------- 对局 ----------
function playerBar(y, side) {
  const game = state.game;
  const mine = side === state.myColor;
  let name, sub;
  if (state.mode === 'ai') {
    name = mine ? '我' : `电脑 · ${LEVELS[settings.gomokuLevel].name}`;
    sub = `执${colorName(side)}`;
  } else if (state.mode === 'online') {
    const player = mine ? state.me : state.opponent;
    name = mine ? '我' : (player ? player.name : '对手');
    sub = `执${colorName(side)}${player ? ` · 积分 ${player.rating}` : ''}${mine ? '' : state.matched ? ' · 随机匹配' : ` · 房间 ${state.roomCode}`}`;
  } else {
    name = `${colorName(side)}方`;
    sub = '本地双人';
  }
  let label = null;
  if (game.turn === side && !game.winner) {
    if (state.mode !== 'local' && !mine) label = '思考中';
    else label = state.pending ? '再点一次落子' : '落子中';
  }
  ui.playerBar(y, { icon: stoneIcon(side), name, sub, label });
}

function drawStones() {
  const t = theme();
  const game = state.game;
  const radius = cell * 0.45;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const side = game.board[r][c];
      if (!side) continue;
      const [x, y] = toScreen(r, c);
      drawStone(ctx, t, side, x, y, radius);
    }
  }

  // 上一手：棋子中间一个和它反色的小点
  if (game.lastMove) {
    const [r, c] = game.lastMove;
    const [x, y] = toScreen(r, c);
    ctx.fillStyle = t.stones[game.board[r][c] === 'b' ? 'w' : 'b'].fill;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2.5, cell * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }

  // 连成五的那几颗子外面画圈
  if (game.winLine) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = t.mark.select;
    for (const [r, c] of game.winLine) {
      const [x, y] = toScreen(r, c);
      ctx.beginPath();
      ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 预览子：半透明，外面一圈虚线
  if (state.pending && !game.winner) {
    const [r, c] = state.pending;
    const [x, y] = toScreen(r, c);
    ctx.save();
    ctx.globalAlpha = 0.5;
    drawStone(ctx, t, game.turn, x, y, radius);
    ctx.restore();
    ctx.save();
    if (ctx.setLineDash) ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = t.mark.hint;
    ctx.beginPath();
    ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function overText() {
  const { winner, reason } = state.game;
  if (winner === 'draw') return ['平局', '棋盘下满了'];
  const reasons = { five: '五子连珠', left: '对方离开了房间' };
  if (state.mode === 'local') return [`${colorName(winner)}方胜`, reasons[reason] || ''];
  const iWin = winner === state.myColor;
  const why = reason === 'resign' ? (iWin ? '对方认输' : '你认输了') : reasons[reason];
  return [iWin ? '你赢了！' : '你输了', why];
}

function rematchButton() {
  if (state.opponentLeft) return { label: '对方已离开', onTap: null };
  if (state.rematchSent) return { label: '等待对方…', onTap: null };
  return {
    label: state.opponentWantsRematch ? '同意再战' : '再来一局',
    onTap() {
      state.rematchSent = true;
      net.send({ t: 'rematch' });
      render();
    },
  };
}

function drawOverlay() {
  const [title, sub] = overText();
  if (state.mode === 'local') {
    ui.resultBox(title, sub, [{ label: '再来一局', onTap: startLocal }, { label: '返回首页', onTap: goMenu, outline: true }]);
  } else if (state.mode === 'ai') {
    ui.resultBox(title, sub, [
      { label: '悔棋', onTap: undoAi, outline: true },
      { label: '再来一局', onTap: startAi },
      { label: '返回首页', onTap: goMenu, outline: true },
    ]);
  } else {
    ui.resultBox(title, ui.withRating(sub, state.ratingChange), [rematchButton(), { label: '返回首页', onTap: goMenu, outline: true }]);
  }
}

function drawPlaying() {
  const game = state.game;
  // 自己的一方放在下面；本地双人黑方在下
  const bottomSide = state.mode === 'local' ? 'b' : state.myColor;
  const topSide = bottomSide === 'b' ? 'w' : 'b';
  playerBar(L.topBarY, topSide);
  drawGoBoard(ctx, theme(), { ox: boardX, oy: boardY, cell, size: SIZE });
  drawStones();

  const actions = [{ label: '菜单', onTap: openMenu, outline: true }];
  if (state.mode === 'local') {
    actions.push({
      label: '悔棋',
      outline: true,
      onTap: game.history.length && !game.winner ? () => { game.undo(); state.pending = null; render(); } : null,
    });
  } else if (state.mode === 'ai') {
    const myTurn = game.turn === state.myColor && !game.winner && !state.aiThinking;
    actions.push({ label: '悔棋', outline: true, onTap: game.history.length && !state.aiThinking ? undoAi : null });
    actions.push({ label: '提示', outline: true, onTap: myTurn ? showHint : null });
  }
  actions.push({ label: '主题', onTap: ui.openThemes, outline: true });
  buttonRow(actions, 12, L.actionY, W - 24, ACTION_H);

  playerBar(L.bottomBarY, bottomSide);
  // 平局 game.winner 是 'draw'，也弹结算框
  if (!game.winner) {
    state.resultAt = 0;
  } else if (!state.resultAt) {
    state.resultAt = Date.now() + 1000;
    setTimeout(render, 1000);
  } else if (Date.now() >= state.resultAt) {
    drawOverlay();
  }
}

const app = {
  render() {
    if (state.scene === 'menu') drawHome();
    else if (state.scene === 'aiSetup') drawAiSetup();
    else if (state.scene === 'matching') ui.matchingScreen(state.matchStart, state.matchOnline, stoneIcon('b'), goMenu);
    else if (state.scene === 'connecting') ui.connectingScreen(goMenu);
    else if (state.scene === 'waiting') ui.waitingScreen(state.roomCode, goMenu);
    else drawPlaying();
  },
  onTouch(x, y) {
    if (state.scene !== 'playing') return;
    const sq = fromScreen(x, y);
    if (sq) onBoardTap(sq[0], sq[1]);
  },
  animating() {
    return state.scene === 'matching';
  },
  drawThemePreview(t, x, y, w, h) {
    drawGoPreview(ctx, t, x, y, w, h);
  },
};

function open(exit) {
  onExit = exit || null;
  state.scene = 'menu';
  ui.show(app);
}

module.exports = { open };
