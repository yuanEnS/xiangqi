// 游戏主逻辑：界面绘制、点击处理、联网对战流程
const { Game, sideOf, legalMoves } = require('./xiangqi.js');
const { THEMES, GLYPHS, getTheme } = require('./themes.js');
const { fontFamily, useFont, usePieceFont, roundRect, drawBoard, drawPiece, drawThemePreview } = require('./draw.js');
const { LEVELS, findBestMove } = require('./ai.js');
const Net = require('./net.js');
const { SERVER_URL } = require('./config.js');

// 界面用霞鹜文楷，棋子用寒蝉正楷体（都只保留用到的字）
if (wx.loadFont) {
  const family = wx.loadFont('fonts/kai.ttf');
  if (family) useFont(family);
  const pieceFamily = wx.loadFont('fonts/piece.ttf');
  if (pieceFamily) usePieceFont(pieceFamily);
}

// ---------- 画布与布局 ----------
const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
const W = info.windowWidth;
const H = info.windowHeight;
const dpr = info.pixelRatio || 2;
const safeTop = info.safeArea ? info.safeArea.top : info.statusBarHeight || 20;
const safeBottom = info.safeArea ? H - info.safeArea.bottom : 0;

const canvas = wx.createCanvas();
canvas.width = W * dpr;
canvas.height = H * dpr;
const ctx = canvas.getContext('2d');
ctx.scale(dpr, dpr);

// 右上角是微信的"胶囊"按钮：标题和它对齐，内容从它下方开始
const capsule = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
const titleY = capsule ? (capsule.top + capsule.bottom) / 2 : safeTop + 22;
const contentTop = capsule ? capsule.bottom + 14 : safeTop + 56;

// 对局画面从上到下：对手栏、棋盘、操作栏、我方栏
const BAR_H = 52;
const ACTION_H = 44;
const GAP = 10;
const FIXED_H = BAR_H * 2 + ACTION_H + GAP * 3;
const availH = H - contentTop - safeBottom - 12;
const cell = Math.min(W / 9, (availH - FIXED_H) / 10);
const topBarY = contentTop + Math.max(0, (availH - FIXED_H - 10 * cell) / 2);
const boardTop = topBarY + BAR_H + GAP;
const boardX = W / 2 - 4 * cell; // 左上角交叉点
const boardY = boardTop + cell / 2;
const actionY = boardTop + 10 * cell + GAP;
const bottomBarY = actionY + ACTION_H + GAP;

// ---------- 设置（主题、字体），存在本地 ----------
function loadSettings() {
  try {
    const saved = wx.getStorageSync('settings');
    if (saved && typeof saved === 'object') return saved;
  } catch (e) {}
  return {};
}

const saved = loadSettings();
const settings = {
  theme: getTheme(saved.theme).id,
  glyphs: saved.glyphs === 'simp' ? 'simp' : 'trad',
  aiLevel: LEVELS[saved.aiLevel] ? saved.aiLevel : 'medium',
  aiSide: ['r', 'b', 'random'].includes(saved.aiSide) ? saved.aiSide : 'r',
};
let theme = getTheme(settings.theme);

function saveSettings() {
  try {
    wx.setStorageSync('settings', settings);
  } catch (e) {}
}

function glyph(piece) {
  return GLYPHS[settings.glyphs][piece];
}

// ---------- 状态 ----------
const net = new Net();
const state = {
  scene: 'menu', // menu | aiSetup | matching | connecting | waiting | playing
  mode: null, // online | ai | local
  aiThinking: false,
  aiToken: 0, // 每次开局、悔棋、离开都加一，丢弃过时的电脑走法
  themeOpen: false, // 主题页盖在当前画面上，不打断联网对局
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
let buttons = [];

function toast(title) {
  wx.showToast({ title, icon: 'none' });
}

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
      toast(`${msg.matched ? '匹配成功' : '开局'}！你执${colorName(msg.color)}`);
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
      toast('对方想再来一局');
      break;
    case 'opponent_left':
      state.opponentLeft = true;
      if (state.scene === 'playing' && !state.game.winner) state.game.end(state.myColor, 'left');
      toast('对方已离开');
      break;
    case 'error':
      state.awaitingServer = false;
      toast(msg.msg);
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
  toast('连接服务器失败或已断开');
  goMenu();
};

function startMatch() {
  state.scene = 'matching';
  state.matchStart = Date.now();
  state.matchOnline = 0;
  net.send({ t: 'match' });
  render();
}

function createRoom() {
  state.scene = 'connecting';
  net.send({ t: 'create' });
  render();
}

function joinRoom() {
  wx.showModal({
    title: '加入房间',
    editable: true,
    placeholderText: '输入 4 位房间号',
    success(res) {
      const code = (res.content || '').trim();
      if (!res.confirm || !code) return;
      state.scene = 'connecting';
      net.send({ t: 'join', room: code });
      render();
    },
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

function confirmThen(content, action) {
  wx.showModal({
    title: '提示',
    content,
    success(res) {
      if (res.confirm) action();
    },
  });
}

function openMenu() {
  const game = state.game;
  let items;
  if (state.mode === 'local' || state.mode === 'ai') {
    items = [
      ['重新开始', () => confirmThen('重新开始这一局？', state.mode === 'ai' ? startAi : startLocal)],
      ['返回首页', goMenu],
    ];
  } else if (game.winner) {
    items = [['返回首页', goMenu]];
  } else {
    items = [
      ['认输', () => confirmThen('确定认输吗？', () => net.send({ t: 'resign' }))],
      ['离开房间', () => confirmThen('现在离开会判负，确定吗？', goMenu)],
    ];
  }
  wx.showActionSheet({
    itemList: items.map(item => item[0]),
    success(res) {
      items[res.tapIndex][1]();
    },
  });
}

function openThemes() {
  state.themeOpen = true;
  render();
}

function closeThemes() {
  state.themeOpen = false;
  render();
}

function selectTheme(id) {
  settings.theme = id;
  theme = getTheme(id);
  saveSettings();
  render();
}

function selectGlyphs(kind) {
  settings.glyphs = kind;
  saveSettings();
  render();
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

wx.onTouchStart(e => {
  const touch = e.touches[0] || e.changedTouches[0];
  if (!touch) return;
  const x = touch.clientX, y = touch.clientY;
  for (const btn of buttons) {
    if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
      btn.onTap();
      return;
    }
  }
  if (state.scene === 'playing' && !state.themeOpen) {
    const sq = fromScreen(x, y);
    if (sq) onBoardTap(sq[0], sq[1]);
  }
});

// ---------- 界面元素 ----------
function text(str, x, y, size, color, opts) {
  const o = opts || {};
  ctx.fillStyle = color;
  ctx.font = `${o.bold ? 'bold ' : ''}${size}px ${fontFamily()}`;
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

function hit(x, y, w, h, onTap) {
  if (onTap) buttons.push({ x, y, w, h, onTap });
}

// 实心按钮或描边按钮；onTap 为空时显示为不可点
function button(label, x, y, w, h, onTap, outline) {
  const ui = theme.ui;
  ctx.save();
  if (!onTap) ctx.globalAlpha = 0.4;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fillStyle = outline ? ui.card : ui.primary;
  ctx.fill();
  if (outline) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ui.primary;
    ctx.stroke();
  }
  text(label, x + w / 2, y + h / 2, 16, outline ? ui.primary : ui.onPrimary, { bold: true });
  ctx.restore();
  hit(x, y, w, h, onTap);
}

function buttonRow(items, x, y, w, h) {
  const gap = 10;
  const bw = (w - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => button(item.label, x + i * (bw + gap), y, bw, h, item.onTap, item.outline));
}

function pill(label, rightX, y) {
  ctx.font = `bold 13px ${fontFamily()}`;
  const w = ctx.measureText(label).width + 20;
  roundRect(ctx, rightX - w, y - 13, w, 26, 13);
  ctx.fillStyle = theme.ui.primary;
  ctx.fill();
  text(label, rightX - w / 2, y, 13, theme.ui.onPrimary, { bold: true });
}

function card(x, y, w, h) {
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = theme.ui.card;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = theme.ui.primary;
  ctx.stroke();
}

// 页面底部淡淡的远山
function drawDecor() {
  if (!theme.ui.decor) return;
  ctx.fillStyle = theme.ui.decor;
  for (const [base, peak] of [[0.8, 0.7], [0.88, 0.8]]) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H * base);
    ctx.quadraticCurveTo(W * 0.14, H * peak, W * 0.3, H * (base - 0.01));
    ctx.quadraticCurveTo(W * 0.46, H * (peak - 0.02), W * 0.64, H * (base - 0.02));
    ctx.quadraticCurveTo(W * 0.82, H * (peak - 0.03), W, H * (base - 0.03));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }
}

function header(title, onBack) {
  let x = 16;
  if (onBack) {
    text('‹', 22, titleY - 2, 34, theme.ui.primary, { bold: true });
    hit(0, titleY - 22, 56, 44, onBack);
    x = 44;
  }
  text(title, x, titleY, 20, theme.ui.primary, { bold: true, align: 'left' });
}

// ---------- 首页 ----------
function drawHome() {
  drawDecor();
  drawPiece(ctx, theme, 'B', 33, titleY, 17, glyph('B'), false);
  text('象棋对战', 60, titleY, 22, theme.ui.primary, { bold: true, align: 'left' });

  const entries = [
    { piece: 'P', title: '快速匹配', sub: '自动匹配正在找棋友的人', onTap: startMatch, online: true },
    { piece: 'K', title: '创建房间', sub: '生成房间号，邀请好友联网对战', onTap: createRoom, online: true },
    { piece: 'n', title: '加入房间', sub: '输入好友发来的房间号', onTap: joinRoom, online: true },
    { piece: 'R', title: '人机对战', sub: '和电脑下棋 · 入门 / 业余 / 大师', onTap: openAiSetup },
    { piece: 'C', title: '本地双人', sub: '同一台设备，轮流走棋', onTap: startLocal },
    { piece: 'b', title: '棋盘主题', sub: THEMES.map(t => t.name).join(' · '), onTap: openThemes },
  ].filter(entry => SERVER_URL || !entry.online); // 没配服务器（比如网页版）就不显示联网入口
  // 入口多的时候卡片矮一点，小屏手机也放得下
  const x = 16, w = W - 32;
  const h = Math.max(64, Math.min(80, (H - contentTop - 20) / entries.length - 14));
  let y = contentTop + 10;
  for (const entry of entries) {
    card(x, y, w, h);
    drawPiece(ctx, theme, entry.piece, x + 40, y + h / 2, 22, glyph(entry.piece), false);
    text(entry.title, x + 76, y + h / 2 - 11, 20, theme.ui.primary, { bold: true, align: 'left' });
    text(entry.sub, x + 76, y + h / 2 + 15, 13, theme.ui.muted, { align: 'left' });
    hit(x, y, w, h, entry.onTap);
    y += h + 14;
  }
}

function drawAiSetup() {
  drawDecor();
  header('人机对战', goMenu);
  const ui = theme.ui;
  const x = 16, w = W - 32;
  let y = contentTop + 6;

  text('难度', x, y + 10, 16, ui.text, { bold: true, align: 'left' });
  y += 28;
  for (const id of Object.keys(LEVELS)) {
    const level = LEVELS[id];
    const selected = settings.aiLevel === id;
    roundRect(ctx, x, y, w, 56, 10);
    ctx.fillStyle = selected ? ui.primary : ui.card;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ui.primary;
    ctx.stroke();
    text(level.name, x + 18, y + 28, 19, selected ? ui.onPrimary : ui.primary, { bold: true, align: 'left' });
    text(level.desc, x + 78, y + 28, 14, selected ? ui.onPrimary : ui.muted, { align: 'left' });
    hit(x, y, w, 56, () => {
      settings.aiLevel = id;
      saveSettings();
      render();
    });
    y += 66;
  }

  y += 8;
  text('执子', x, y + 10, 16, ui.text, { bold: true, align: 'left' });
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

function drawMatching() {
  drawDecor();
  header('快速匹配', goMenu);
  const ui = theme.ui;
  const elapsed = (Date.now() - state.matchStart) / 1000;
  const cx = W / 2, cy = contentTop + 130;

  // 中间一枚棋子，外面一圈转动的弧线
  ctx.lineWidth = 4;
  ctx.strokeStyle = ui.primary;
  ctx.beginPath();
  ctx.arc(cx, cy, 58, elapsed * 3, elapsed * 3 + Math.PI * 1.3);
  ctx.stroke();
  drawPiece(ctx, theme, 'K', cx, cy, 42, glyph('K'), false);

  const dots = '.'.repeat(Math.floor(elapsed * 2) % 4);
  text(`正在寻找对手${dots}`, cx, cy + 100, 20, ui.text, { bold: true });
  text(`已等待 ${Math.floor(elapsed)} 秒`, cx, cy + 132, 15, ui.muted);
  if (state.matchOnline) text(`当前在线 ${state.matchOnline} 人`, cx, cy + 156, 15, ui.muted);
  text('人少的时候，可以把网址发给朋友一起点「快速匹配」', cx, cy + 196, 13, ui.muted);
  button('取消', (W - 160) / 2, cy + 230, 160, 44, goMenu, true);
}

function drawConnecting() {
  drawDecor();
  header('联网对战', goMenu);
  text('正在连接服务器…', W / 2, H * 0.4, 18, theme.ui.text);
  button('取消', (W - 160) / 2, H * 0.4 + 50, 160, 44, goMenu, true);
}

function drawWaiting() {
  drawDecor();
  header('等待对手', goMenu);
  const x = 16, w = W - 32, y = contentTop + 20, h = 250;
  card(x, y, w, h);
  text('房间号', W / 2, y + 36, 15, theme.ui.muted);
  text(state.roomCode, W / 2, y + 94, 60, theme.ui.primary, { bold: true });
  text('把房间号发给好友', W / 2, y + 152, 15, theme.ui.muted);
  text('对方点「加入房间」输入即可', W / 2, y + 176, 15, theme.ui.muted);
  text('等待对手加入…', W / 2, y + 220, 17, theme.ui.text, { bold: true });
  button('取消', (W - 160) / 2, y + h + 24, 160, 44, goMenu, true);
}

// ---------- 对局 ----------
function playerBar(y, side) {
  const game = state.game;
  const x = 12, w = W - 24;
  roundRect(ctx, x, y, w, BAR_H, 10);
  ctx.fillStyle = theme.ui.card;
  ctx.fill();
  // 卡片和背景同色时（黑白主题）加描边，否则看不出边界
  if (theme.ui.card === theme.ui.bg) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.ui.muted;
    ctx.stroke();
  }

  const active = game.turn === side && !game.winner;
  const kx = x + 28, ky = y + BAR_H / 2;
  if (active) {
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = theme.ui.primary;
    ctx.beginPath();
    ctx.arc(kx, ky, 21, 0, Math.PI * 2);
    ctx.stroke();
  }
  const king = side === 'r' ? 'K' : 'k';
  drawPiece(ctx, theme, king, kx, ky, 17, glyph(king), false);

  let name, sub;
  if (state.mode === 'ai') {
    const mine = side === state.myColor;
    name = mine ? '我' : `电脑 · ${LEVELS[settings.aiLevel].name}`;
    sub = `执${colorName(side)}`;
  } else if (state.mode === 'online') {
    const mine = side === state.myColor;
    name = mine ? '我' : '对手';
    sub = `执${colorName(side)}${mine ? '' : state.matched ? ' · 随机匹配' : ` · 房间 ${state.roomCode}`}`;
  } else {
    name = `${colorName(side)}方`;
    sub = '本地双人';
  }
  text(name, x + 58, ky - 9, 16, theme.ui.text, { bold: true, align: 'left' });
  text(sub, x + 58, ky + 12, 12, theme.ui.muted, { align: 'left' });

  if (active) {
    let label = '走棋中';
    if (game.inCheck()) label = '将军！';
    else if (state.mode !== 'local' && side !== state.myColor) label = '思考中';
    pill(label, x + w - 12, ky);
  }
}

// 上一步的起点和终点画四个角框
function cornerMarks(x, y) {
  const s = cell * 0.48, l = s * 0.32;
  ctx.strokeStyle = theme.mark.last;
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
      drawPiece(ctx, theme, piece, x, y, radius, glyph(piece), isSelected);
      if (isSelected) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = theme.mark.select;
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
      ctx.strokeStyle = theme.mark.hint;
      ctx.arc(x, y, radius + 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = theme.mark.hint;
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
  // 结算框弹出时只响应框里的按钮
  buttons = [];
  ctx.fillStyle = theme.id === 'pao' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, H);
  const w = Math.min(320, W - 48), h = 200;
  const x = (W - w) / 2, y = (H - h) / 2;
  card(x, y, w, h);

  const [title, sub] = overText();
  text(title, W / 2, y + 54, 30, theme.ui.primary, { bold: true });
  text(sub, W / 2, y + 94, 15, theme.ui.muted);

  let again;
  if (state.mode === 'local') {
    again = { label: '再来一局', onTap: startLocal };
  } else if (state.mode === 'ai') {
    // 输给电脑可以悔棋接着下
    buttonRow([
      { label: '悔棋', onTap: undoAi, outline: true },
      { label: '再来一局', onTap: startAi },
      { label: '返回首页', onTap: goMenu, outline: true },
    ], x + 16, y + h - 68, w - 32, 44);
    return;
  } else if (state.opponentLeft) {
    again = { label: '对方已离开', onTap: null };
  } else if (state.rematchSent) {
    again = { label: '等待对方…', onTap: null };
  } else {
    again = {
      label: state.opponentWantsRematch ? '同意再战' : '再来一局',
      onTap() {
        state.rematchSent = true;
        net.send({ t: 'rematch' });
        render();
      },
    };
  }
  buttonRow([again, { label: '返回首页', onTap: goMenu, outline: true }], x + 20, y + h - 68, w - 40, 44);
}

function drawPlaying() {
  const game = state.game;
  const bottomSide = flipped() ? 'b' : 'r';
  const topSide = bottomSide === 'r' ? 'b' : 'r';
  playerBar(topBarY, topSide);
  drawBoard(ctx, theme, { ox: boardX, oy: boardY, cell });
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
  actions.push({ label: '主题', onTap: openThemes, outline: true });
  buttonRow(actions, 12, actionY, W - 24, ACTION_H);

  playerBar(bottomBarY, bottomSide);
  if (game.winner) drawOverlay();
}

// ---------- 主题页 ----------
function drawThemes() {
  header('棋盘与棋子', closeThemes);
  const ui = theme.ui;
  let y = contentTop + 6;

  text('棋子文字', 16, y + 10, 16, ui.text, { bold: true, align: 'left' });
  y += 28;
  const half = (W - 32 - 10) / 2;
  button('繁體', 16, y, half, 40, () => selectGlyphs('trad'), settings.glyphs !== 'trad');
  button('简体', 16 + half + 10, y, half, 40, () => selectGlyphs('simp'), settings.glyphs !== 'simp');
  y += 58;
  text('繁体字红黑双方用字都不同，黑白屏上也容易分清', 16, y, 12, ui.muted, { align: 'left' });

  y += 32;
  text('选择主题', 16, y, 16, ui.text, { bold: true, align: 'left' });
  y += 22;
  const cols = 3, gap = 12;
  const cw = (W - 32 - gap * (cols - 1)) / cols, ch = cw * 0.85;
  THEMES.forEach((t, i) => {
    const cx = 16 + (i % cols) * (cw + gap);
    const cy = y + Math.floor(i / cols) * (ch + 42);
    const selected = t.id === theme.id;
    drawThemePreview(ctx, t, GLYPHS[settings.glyphs], cx, cy, cw, ch);
    if (selected) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = ui.primary;
      roundRect(ctx, cx - 4, cy - 4, cw + 8, ch + 8, 13);
      ctx.stroke();
    }
    text(`${t.name} · ${t.desc}`, cx + cw / 2, cy + ch + 18, 14, selected ? ui.primary : ui.text, { bold: selected });
    hit(cx, cy, cw, ch + 30, () => selectTheme(t.id));
  });
}

function render() {
  buttons = [];
  ctx.fillStyle = theme.ui.bg;
  ctx.fillRect(0, 0, W, H);
  if (state.themeOpen) drawThemes();
  else if (state.scene === 'menu') drawHome();
  else if (state.scene === 'aiSetup') drawAiSetup();
  else if (state.scene === 'matching') drawMatching();
  else if (state.scene === 'connecting') drawConnecting();
  else if (state.scene === 'waiting') drawWaiting();
  else drawPlaying();
  updateMatchTimer();
}

// 匹配画面有动画，需要定时重画；离开匹配画面就停掉
let matchTimer = null;
function updateMatchTimer() {
  const animating = state.scene === 'matching' && !state.themeOpen;
  if (animating && !matchTimer) {
    matchTimer = setInterval(render, 100);
  } else if (!animating && matchTimer) {
    clearInterval(matchTimer);
    matchTimer = null;
  }
}

render();
