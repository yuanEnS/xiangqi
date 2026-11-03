// 中国象棋：首页、人机设置、联网流程、对局画面
const { Game, sideOf, legalMoves } = require('./xiangqi.js');
const { drawBoard, drawPiece, drawThemePreview } = require('./draw.js');
const { LEVELS, findBestMove } = require('./ai.js');
const Net = require('./net.js');
const { SERVER_URL } = require('./config.js');
const ui = require('./ui.js');

const { W, ctx, contentTop, ACTION_H, settings, saveSettings, theme, text, button, buttonRow, header } = ui;
const render = ui.render;

// 棋盘 9 列 10 行（棋子在交叉点上，四周各留半格）
const L = ui.playLayout(9, 10);
const cell = L.cell;
const boardX = W / 2 - 4 * cell; // 左上角交叉点
const boardY = L.boardTop + cell / 2;

if (!LEVELS[settings.aiLevel]) settings.aiLevel = 'medium';
if (!['r', 'b', 'random'].includes(settings.aiSide)) settings.aiSide = 'r';

function glyph(piece) {
  return ui.GLYPHS[settings.glyphs][piece];
}

function pieceIcon(piece) {
  return (x, y, r) => drawPiece(ctx, theme(), piece, x, y, r, glyph(piece), false);
}

// ---------- 状态 ----------
const net = new Net();
let onExit = null; // 小游戏里有多个游戏时，首页左上角可以返回游戏列表
const state = {
  scene: 'menu', // menu | aiSetup | matching | connecting | waiting | playing
  mode: null, // online | ai | local
  aiThinking: false,
  aiToken: 0, // 每次开局、悔棋、离开都加一，丢弃过时的电脑走法
  roomCode: '',
  matched: false, // 这一局是自动匹配来的（不是好友房间）
  matchStart: 0,
  matchOnline: 0,
  myColor: 'r',
  game: new Game(),
  selected: null,
  hints: [],
  awaitingServer: false, // 已发出走法，等服务器确认
  rematchSent: false,
  opponentWantsRematch: false,
  opponentLeft: false,
};

function colorName(color) {
  return color === 'r' ? '红' : '黑';
}

function clearSelection() {
  state.selected = null;
  state.hints = [];
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
  clearSelection();
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
      state.awaitingServer = false;
      state.rematchSent = false;
      state.opponentWantsRematch = false;
      state.opponentLeft = false;
      clearSelection();
      ui.toast(`${msg.matched ? '匹配成功' : '开局'}！你执${colorName(msg.color)}`);
      break;
    case 'move':
      state.game.move(msg.from, msg.to);
      state.awaitingServer = false;
      clearSelection();
      break;
    case 'over':
      if (!state.game.winner) state.game.end(msg.winner, msg.reason);
      clearSelection();
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
      // 加入房间失败，回到首页
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
  net.send({ t: 'match', game: 'xiangqi' });
  render();
}

function createRoom() {
  state.scene = 'connecting';
  net.send({ t: 'create', game: 'xiangqi' });
  render();
}

function joinRoom() {
  ui.askRoomCode(code => {
    state.scene = 'connecting';
    net.send({ t: 'join', room: code, game: 'xiangqi' });
    render();
  });
}

function startLocal() {
  state.mode = 'local';
  state.scene = 'playing';
  state.game = new Game();
  clearSelection();
  render();
}

// ---------- 人机对战 ----------
function openAiSetup() {
  state.scene = 'aiSetup';
  render();
}

function startAi() {
  cancelAi();
  state.mode = 'ai';
  state.scene = 'playing';
  state.myColor = settings.aiSide === 'random' ? (Math.random() < 0.5 ? 'r' : 'b') : settings.aiSide;
  state.game = new Game();
  clearSelection();
  render();
  maybeAiMove();
}

// 轮到电脑时，先把"思考中"画出来，再开始计算（计算期间画面不会刷新）
function maybeAiMove() {
  const game = state.game;
  if (state.mode !== 'ai' || game.winner || game.turn === state.myColor) return;
  state.aiThinking = true;
  const token = ++state.aiToken;
  render();
  setTimeout(() => {
    if (token !== state.aiToken) return;
    const m = findBestMove(game.board, game.turn, settings.aiLevel);
    if (m) game.move(m.from, m.to);
    state.aiThinking = false;
    clearSelection();
    render();
  }, 60);
}

// 悔棋退回到轮到自己走：一般要退两步（电脑一步、自己一步）
function undoAi() {
  const game = state.game;
  cancelAi();
  do {
    if (!game.undo()) break;
  } while (game.turn !== state.myColor);
  clearSelection();
  render();
  maybeAiMove();
}

function showHint() {
  const game = state.game;
  wx.showToast({ title: '计算中…', icon: 'loading' });
  setTimeout(() => {
    const m = findBestMove(game.board, state.myColor, 'medium');
    wx.hideToast();
    if (!m || game.turn !== state.myColor || game.winner) return;
    state.selected = m.from;
    state.hints = [m.to];
    render();
  }, 60);
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

// ---------- 坐标换算 ----------
// 执黑时把棋盘倒过来，让自己的棋子在下方
function flipped() {
  return state.mode !== 'local' && state.myColor === 'b';
}

function toScreen(r, c) {
  const dr = flipped() ? 9 - r : r;
  const dc = flipped() ? 8 - c : c;
  return [boardX + dc * cell, boardY + dr * cell];
}

function fromScreen(x, y) {
  const dc = Math.round((x - boardX) / cell);
  const dr = Math.round((y - boardY) / cell);
  if (dr < 0 || dr > 9 || dc < 0 || dc > 8) return null;
  if (Math.hypot(x - (boardX + dc * cell), y - (boardY + dr * cell)) > cell * 0.5) return null;
  return flipped() ? [9 - dr, 8 - dc] : [dr, dc];
}

// ---------- 点击 ----------
function onBoardTap(r, c) {
  const game = state.game;
  if (game.winner || state.awaitingServer || state.aiThinking) return;
  if (state.mode !== 'local' && game.turn !== state.myColor) return;

  const piece = game.board[r][c];
  if (sideOf(piece) === game.turn) {
    state.selected = [r, c];
    state.hints = legalMoves(game.board, r, c);
  } else if (state.selected && state.hints.some(([hr, hc]) => hr === r && hc === c)) {
    const from = state.selected;
    if (state.mode === 'online') {
      state.awaitingServer = true;
      net.send({ t: 'move', from, to: [r, c] });
    } else {
      game.move(from, [r, c]);
      clearSelection();
      maybeAiMove();
    }
  } else {
    clearSelection();
  }
  render();
}

// ---------- 首页 ----------
function drawHome() {
  ui.drawDecor();
  if (onExit) {
    header('中国象棋', onExit);
  } else {
    pieceIcon('B')(33, ui.titleY, 17);
    text('象棋对战', 60, ui.titleY, 22, theme().ui.primary, { bold: true, align: 'left' });
  }

  const entries = [
    { piece: 'P', title: '快速匹配', sub: '自动匹配正在找棋友的人', onTap: startMatch, online: true },
    { piece: 'K', title: '创建房间', sub: '生成房间号，邀请好友联网对战', onTap: createRoom, online: true },
    { piece: 'n', title: '加入房间', sub: '输入好友发来的房间号', onTap: joinRoom, online: true },
    { piece: 'R', title: '人机对战', sub: '和电脑下棋 · 入门 / 业余 / 大师', onTap: openAiSetup },
    { piece: 'C', title: '本地双人', sub: '同一台设备，轮流走棋', onTap: startLocal },
    { piece: 'b', title: '棋盘主题', sub: ui.THEMES.map(t => t.name).join(' · '), onTap: ui.openThemes },
  ].filter(entry => SERVER_URL || !entry.online); // 没配服务器（比如小游戏版）就不显示联网入口
  ui.entryCards(entries.map(entry => ({ ...entry, icon: pieceIcon(entry.piece) })));
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
    const level = LEVELS[id];
    const selected = settings.aiLevel === id;
    ui.levelCard(x, y, w, level, selected, () => {
      settings.aiLevel = id;
      saveSettings();
      render();
    });
    y += 66;
  }

  y += 8;
  text('执子', x, y + 10, 16, colors.text, { bold: true, align: 'left' });
  y += 28;
  const sides = [['r', '执红先走'], ['random', '随机'], ['b', '执黑后走']];
  const bw = (w - 20) / 3;
  sides.forEach(([id, label], i) => {
    button(label, x + i * (bw + 10), y, bw, 42, () => {
      settings.aiSide = id;
      saveSettings();
      render();
    }, settings.aiSide !== id);
  });

  y += 72;
  button('开始对局', x, y, w, 50, startAi);
}

// ---------- 对局 ----------
function playerBar(y, side) {
  const game = state.game;
  let name, sub;
  const mine = side === state.myColor;
  if (state.mode === 'ai') {
    name = mine ? '我' : `电脑 · ${LEVELS[settings.aiLevel].name}`;
    sub = `执${colorName(side)}`;
  } else if (state.mode === 'online') {
    name = mine ? '我' : '对手';
    sub = `执${colorName(side)}${mine ? '' : state.matched ? ' · 随机匹配' : ` · 房间 ${state.roomCode}`}`;
  } else {
    name = `${colorName(side)}方`;
    sub = '本地双人';
  }
  let label = null;
  if (game.turn === side && !game.winner) {
    label = '走棋中';
    if (game.inCheck()) label = '将军！';
    else if (state.mode !== 'local' && !mine) label = '思考中';
  }
  ui.playerBar(y, { icon: pieceIcon(side === 'r' ? 'K' : 'k'), name, sub, label });
}

// 上一步的起点和终点画四个角框
function cornerMarks(x, y) {
  const s = cell * 0.48, l = s * 0.32;
  ctx.strokeStyle = theme().mark.last;
  ctx.lineWidth = 2;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + sx * s, y + sy * (s - l));
      ctx.lineTo(x + sx * s, y + sy * s);
      ctx.lineTo(x + sx * (s - l), y + sy * s);
      ctx.stroke();
    }
  }
}

function drawPieces() {
  const t = theme();
  const { board, lastMove } = state.game;
  const radius = cell * 0.46;

  if (lastMove) {
    for (const sq of [lastMove.from, lastMove.to]) {
      const [x, y] = toScreen(sq[0], sq[1]);
      cornerMarks(x, y);
    }
  }

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const isSelected = state.selected && state.selected[0] === r && state.selected[1] === c;
      const [x, y0] = toScreen(r, c);
      const y = isSelected ? y0 - 3 : y0;
      drawPiece(ctx, t, piece, x, y, radius, glyph(piece), isSelected);
      if (isSelected) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = t.mark.select;
        ctx.beginPath();
        ctx.arc(x, y, radius + 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  for (const [r, c] of state.hints) {
    const [x, y] = toScreen(r, c);
    ctx.beginPath();
    if (board[r][c]) {
      // 能吃的子画虚线圈，和"选中"的实线圈区分开
      ctx.save();
      if (ctx.setLineDash) ctx.setLineDash([5, 4]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = t.mark.hint;
      ctx.arc(x, y, radius + 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = t.mark.hint;
      ctx.arc(x, y, cell * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function overText() {
  const { winner, reason } = state.game;
  const reasons = {
    checkmate: '绝杀',
    stalemate: '困毙（无子可走）',
    left: '对方离开了房间',
  };
  if (state.mode === 'local') return [`${colorName(winner)}方胜`, reasons[reason] || ''];
  const iWin = winner === state.myColor;
  const why = reason === 'resign' ? (iWin ? '对方认输' : '你认输了') : reasons[reason];
  return [iWin ? '你赢了！' : '你输了', why];
}

function drawOverlay() {
  const [title, sub] = overText();
  if (state.mode === 'local') {
    ui.resultBox(title, sub, [{ label: '再来一局', onTap: startLocal }, { label: '返回首页', onTap: goMenu, outline: true }]);
  } else if (state.mode === 'ai') {
    // 输给电脑可以悔棋接着下
    ui.resultBox(title, sub, [
      { label: '悔棋', onTap: undoAi, outline: true },
      { label: '再来一局', onTap: startAi },
      { label: '返回首页', onTap: goMenu, outline: true },
    ]);
  } else {
    ui.resultBox(title, sub, [rematchButton(), { label: '返回首页', onTap: goMenu, outline: true }]);
  }
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

function drawPlaying() {
  const game = state.game;
  const bottomSide = flipped() ? 'b' : 'r';
  const topSide = bottomSide === 'r' ? 'b' : 'r';
  playerBar(L.topBarY, topSide);
  drawBoard(ctx, theme(), { ox: boardX, oy: boardY, cell });
  drawPieces();

  const actions = [{ label: '菜单', onTap: openMenu, outline: true }];
  if (state.mode === 'local') {
    actions.push({
      label: '悔棋',
      outline: true,
      onTap: game.history.length && !game.winner ? () => { game.undo(); clearSelection(); render(); } : null,
    });
  } else if (state.mode === 'ai') {
    const myTurn = game.turn === state.myColor && !game.winner && !state.aiThinking;
    actions.push({ label: '悔棋', outline: true, onTap: game.history.length && !state.aiThinking ? undoAi : null });
    actions.push({ label: '提示', outline: true, onTap: myTurn ? showHint : null });
  }
  actions.push({ label: '主题', onTap: ui.openThemes, outline: true });
  buttonRow(actions, 12, L.actionY, W - 24, ACTION_H);

  playerBar(L.bottomBarY, bottomSide);
  if (game.winner) drawOverlay();
}

const app = {
  glyphOption: true,
  render() {
    if (state.scene === 'menu') drawHome();
    else if (state.scene === 'aiSetup') drawAiSetup();
    else if (state.scene === 'matching') ui.matchingScreen(state.matchStart, state.matchOnline, pieceIcon('K'), goMenu);
    else if (state.scene === 'connecting') ui.connectingScreen(goMenu);
    else if (state.scene === 'waiting') ui.waitingScreen(state.roomCode, goMenu);
    else drawPlaying();
  },
  onTouch(x, y) {
    if (state.scene !== 'playing') return;
    const sq = fromScreen(x, y);
    if (sq) onBoardTap(sq[0], sq[1]);
  },
  // 匹配画面有动画，需要定时重画
  animating() {
    return state.scene === 'matching';
  },
  drawThemePreview(t, x, y, w, h) {
    drawThemePreview(ctx, t, ui.GLYPHS[settings.glyphs], x, y, w, h);
  },
};

// exit：返回游戏列表的回调；只有一个游戏时（网页版）不传
function open(exit) {
  onExit = exit || null;
  state.scene = 'menu';
  ui.show(app);
}

module.exports = { open };
