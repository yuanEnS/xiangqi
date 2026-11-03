// 各个游戏共用的界面：画布、布局、设置、按钮和卡片、主题页、点击分发
const { THEMES, GLYPHS, getTheme } = require('./themes.js');
const { fontFamily, useFont, usePieceFont, roundRect } = require('./draw.js');

// 界面用霞鹜文楷，象棋棋子用寒蝉正楷体（都只保留用到的字）
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

// 棋盘占 rows 行格子高时，算出格子大小和各栏的位置
function playLayout(cols, rows) {
  const cell = Math.min(W / cols, (availH - FIXED_H) / rows);
  const topBarY = contentTop + Math.max(0, (availH - FIXED_H - rows * cell) / 2);
  const boardTop = topBarY + BAR_H + GAP;
  const actionY = boardTop + rows * cell + GAP;
  return { cell, topBarY, boardTop, actionY, bottomBarY: actionY + ACTION_H + GAP };
}

// ---------- 设置（主题、字体、难度），存在本地 ----------
function loadSettings() {
  try {
    const saved = wx.getStorageSync('settings');
    if (saved && typeof saved === 'object') return saved;
  } catch (e) {}
  return {};
}

const settings = loadSettings();
settings.theme = getTheme(settings.theme).id;
settings.glyphs = settings.glyphs === 'simp' ? 'simp' : 'trad';

function saveSettings() {
  try {
    wx.setStorageSync('settings', settings);
  } catch (e) {}
}

function theme() {
  return getTheme(settings.theme);
}

// ---------- 当前画面 ----------
// 每个游戏是一个 app：{ render(), onTouch(x, y), animating(), drawThemePreview?, glyphOption? }
let current = null;
let buttons = [];
let themeOpen = false; // 主题页盖在当前画面上，不打断联网对局
let animTimer = null;

function show(app) {
  current = app;
  themeOpen = false;
  render();
}

function render() {
  buttons = [];
  ctx.fillStyle = theme().ui.bg;
  ctx.fillRect(0, 0, W, H);
  if (themeOpen) drawThemes();
  else current.render();
  // 有动画的画面（比如匹配中）定时重画
  const animating = !themeOpen && current.animating && current.animating();
  if (animating && !animTimer) {
    animTimer = setInterval(render, 100);
  } else if (!animating && animTimer) {
    clearInterval(animTimer);
    animTimer = null;
  }
}

// 弹出结算框等覆盖层时，先清掉下面那层的按钮
function clearButtons() {
  buttons = [];
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
  if (!themeOpen && current.onTouch) current.onTouch(x, y);
});

// ---------- 提示与弹窗 ----------
function toast(title) {
  wx.showToast({ title, icon: 'none' });
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

function actionSheet(items) {
  wx.showActionSheet({
    itemList: items.map(item => item[0]),
    success(res) {
      items[res.tapIndex][1]();
    },
  });
}

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
  const ui = theme().ui;
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
  const ui = theme().ui;
  ctx.font = `bold 13px ${fontFamily()}`;
  const w = ctx.measureText(label).width + 20;
  roundRect(ctx, rightX - w, y - 13, w, 26, 13);
  ctx.fillStyle = ui.primary;
  ctx.fill();
  text(label, rightX - w / 2, y, 13, ui.onPrimary, { bold: true });
}

function card(x, y, w, h) {
  const ui = theme().ui;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = ui.card;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ui.primary;
  ctx.stroke();
}

// 页面底部淡淡的远山
function drawDecor() {
  const decor = theme().ui.decor;
  if (!decor) return;
  ctx.fillStyle = decor;
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
  const ui = theme().ui;
  let x = 16;
  if (onBack) {
    text('‹', 22, titleY - 2, 34, ui.primary, { bold: true });
    hit(0, titleY - 22, 56, 44, onBack);
    x = 44;
  }
  text(title, x, titleY, 20, ui.primary, { bold: true, align: 'left' });
}

// 人机设置里的难度卡片，选中时整张填色
function levelCard(x, y, w, level, selected, onTap) {
  const ui = theme().ui;
  roundRect(ctx, x, y, w, 56, 10);
  ctx.fillStyle = selected ? ui.primary : ui.card;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ui.primary;
  ctx.stroke();
  text(level.name, x + 18, y + 28, 19, selected ? ui.onPrimary : ui.primary, { bold: true, align: 'left' });
  text(level.desc, x + 78, y + 28, 14, selected ? ui.onPrimary : ui.muted, { align: 'left' });
  hit(x, y, w, 56, onTap);
}

// 首页的一列入口卡片：{ icon(x, y, r), title, sub, onTap }
function entryCards(entries) {
  const ui = theme().ui;
  // 入口多的时候卡片矮一点，小屏手机也放得下
  const x = 16, w = W - 32;
  const h = Math.max(64, Math.min(80, (H - contentTop - 20) / entries.length - 14));
  let y = contentTop + 10;
  for (const entry of entries) {
    card(x, y, w, h);
    entry.icon(x + 40, y + h / 2, 22);
    text(entry.title, x + 76, y + h / 2 - 11, 20, ui.primary, { bold: true, align: 'left' });
    text(entry.sub, x + 76, y + h / 2 + 15, 13, ui.muted, { align: 'left' });
    hit(x, y, w, h, entry.onTap);
    y += h + 14;
  }
}

// 对局上下的玩家栏：icon(x, y, r) 画头像，active 时加圆圈和右侧标签
function playerBar(y, opts) {
  const ui = theme().ui;
  const x = 12, w = W - 24;
  roundRect(ctx, x, y, w, BAR_H, 10);
  ctx.fillStyle = ui.card;
  ctx.fill();
  // 卡片和背景同色时（黑白主题）加描边，否则看不出边界
  if (ui.card === ui.bg) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = ui.muted;
    ctx.stroke();
  }
  const kx = x + 28, ky = y + BAR_H / 2;
  if (opts.label) {
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = ui.primary;
    ctx.beginPath();
    ctx.arc(kx, ky, 21, 0, Math.PI * 2);
    ctx.stroke();
  }
  opts.icon(kx, ky, 17);
  text(opts.name, x + 58, ky - 9, 16, ui.text, { bold: true, align: 'left' });
  text(opts.sub, x + 58, ky + 12, 12, ui.muted, { align: 'left' });
  if (opts.label) pill(opts.label, x + w - 12, ky);
}

// 结算框：标题、说明、一排按钮
function resultBox(title, sub, actions) {
  clearButtons();
  const t = theme();
  ctx.fillStyle = t.id === 'pao' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, H);
  const w = Math.min(320, W - 48), h = 200;
  const x = (W - w) / 2, y = (H - h) / 2;
  card(x, y, w, h);
  text(title, W / 2, y + 54, 30, t.ui.primary, { bold: true });
  text(sub, W / 2, y + 94, 15, t.ui.muted);
  const pad = actions.length > 2 ? 16 : 20;
  buttonRow(actions, x + pad, y + h - 68, w - pad * 2, 44);
}

// ---------- 联网等待画面 ----------
// 匹配中：icon(x, y, r) 画在中间，外面一圈转动的弧线
function matchingScreen(startTime, online, icon, onCancel) {
  drawDecor();
  header('快速匹配', onCancel);
  const ui = theme().ui;
  const elapsed = (Date.now() - startTime) / 1000;
  const cx = W / 2, cy = contentTop + 130;
  ctx.lineWidth = 4;
  ctx.strokeStyle = ui.primary;
  ctx.beginPath();
  ctx.arc(cx, cy, 58, elapsed * 3, elapsed * 3 + Math.PI * 1.3);
  ctx.stroke();
  icon(cx, cy, 42);

  const dots = '.'.repeat(Math.floor(elapsed * 2) % 4);
  text(`正在寻找对手${dots}`, cx, cy + 100, 20, ui.text, { bold: true });
  text(`已等待 ${Math.floor(elapsed)} 秒`, cx, cy + 132, 15, ui.muted);
  if (online) text(`当前在线 ${online} 人`, cx, cy + 156, 15, ui.muted);
  text('人少的时候，可以把网址发给朋友一起点「快速匹配」', cx, cy + 196, 13, ui.muted);
  button('取消', (W - 160) / 2, cy + 230, 160, 44, onCancel, true);
}

function connectingScreen(onCancel) {
  drawDecor();
  header('联网对战', onCancel);
  text('正在连接服务器…', W / 2, H * 0.4, 18, theme().ui.text);
  button('取消', (W - 160) / 2, H * 0.4 + 50, 160, 44, onCancel, true);
}

function waitingScreen(roomCode, onCancel) {
  drawDecor();
  header('等待对手', onCancel);
  const ui = theme().ui;
  const x = 16, w = W - 32, y = contentTop + 20, h = 250;
  card(x, y, w, h);
  text('房间号', W / 2, y + 36, 15, ui.muted);
  text(roomCode, W / 2, y + 94, 60, ui.primary, { bold: true });
  text('把房间号发给好友', W / 2, y + 152, 15, ui.muted);
  text('对方点「加入房间」输入即可', W / 2, y + 176, 15, ui.muted);
  text('等待对手加入…', W / 2, y + 220, 17, ui.text, { bold: true });
  button('取消', (W - 160) / 2, y + h + 24, 160, 44, onCancel, true);
}

// 弹出输入框，输入房间号后回调
function askRoomCode(onCode) {
  wx.showModal({
    title: '加入房间',
    editable: true,
    placeholderText: '输入 4 位房间号',
    success(res) {
      const code = (res.content || '').trim();
      if (res.confirm && code) onCode(code);
    },
  });
}

// ---------- 主题页 ----------
function openThemes() {
  themeOpen = true;
  render();
}

function closeThemes() {
  themeOpen = false;
  render();
}

function drawThemes() {
  header('棋盘主题', closeThemes);
  const ui = theme().ui;
  let y = contentTop + 6;

  // 只有象棋有「繁體 / 简体」选项
  if (current.glyphOption) {
    text('棋子文字', 16, y + 10, 16, ui.text, { bold: true, align: 'left' });
    y += 28;
    const half = (W - 32 - 10) / 2;
    const pick = kind => () => {
      settings.glyphs = kind;
      saveSettings();
      render();
    };
    button('繁體', 16, y, half, 40, pick('trad'), settings.glyphs !== 'trad');
    button('简体', 16 + half + 10, y, half, 40, pick('simp'), settings.glyphs !== 'simp');
    y += 58;
    text('繁体字红黑双方用字都不同，黑白屏上也容易分清', 16, y, 12, ui.muted, { align: 'left' });
    y += 32;
  }

  text('选择主题', 16, y, 16, ui.text, { bold: true, align: 'left' });
  y += 22;
  const cols = 3, gap = 12;
  const cw = (W - 32 - gap * (cols - 1)) / cols, ch = cw * 0.85;
  THEMES.forEach((t, i) => {
    const cx = 16 + (i % cols) * (cw + gap);
    const cy = y + Math.floor(i / cols) * (ch + 42);
    const selected = t.id === settings.theme;
    current.drawThemePreview(t, cx, cy, cw, ch);
    if (selected) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = ui.primary;
      roundRect(ctx, cx - 4, cy - 4, cw + 8, ch + 8, 13);
      ctx.stroke();
    }
    text(`${t.name} · ${t.desc}`, cx + cw / 2, cy + ch + 18, 14, selected ? ui.primary : ui.text, { bold: selected });
    hit(cx, cy, cw, ch + 30, () => {
      settings.theme = t.id;
      saveSettings();
      render();
    });
  });
}

module.exports = {
  W, H, ctx, titleY, contentTop, BAR_H, ACTION_H, playLayout,
  settings, saveSettings, theme, GLYPHS, THEMES,
  show, render, clearButtons, toast, confirmThen, actionSheet,
  text, hit, button, buttonRow, pill, card, drawDecor, header, levelCard, entryCards, playerBar, resultBox,
  matchingScreen, connectingScreen, waitingScreen, askRoomCode,
  openThemes, closeThemes,
};
