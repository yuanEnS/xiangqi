// 棋盘和棋子的绘制，颜色全部来自主题（themes.js）

// 楷体优先：打包的霞鹜文楷加载成功就用它，否则用系统自带的楷体，再不行退到宋体
const FALLBACK = '"Kaiti SC", "STKaiti", "KaiTi", "楷体", "Songti SC", "SimSun", serif';
let family = FALLBACK;
// 棋子上的字单独用寒蝉正楷体，没加载成功就和界面用同一种楷体
let pieceFamily = null;

function useFont(name) {
  family = `"${name}", ${FALLBACK}`;
}

function usePieceFont(name) {
  pieceFamily = name;
}

function fontFamily() {
  return family;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fillBoardColor(ctx, board, x, y, w, h) {
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, board.fill[0]);
  grad.addColorStop(1, board.fill[1]);
  ctx.fillStyle = grad;
}

// 木纹：几条起伏的细线
function drawGrain(ctx, color, x, y, w, h) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const lines = 16;
  for (let i = 0; i < lines; i++) {
    const ly = y + ((i + 0.5) * h) / lines;
    const amp = h / lines / 3;
    ctx.beginPath();
    ctx.moveTo(x, ly);
    for (let sx = 0; sx <= w; sx += 12) {
      ctx.lineTo(x + sx, ly + Math.sin(sx / (40 + i * 7) + i * 1.7) * amp);
    }
    ctx.stroke();
  }
}

function drawFrame(ctx, board, x, y, w, h) {
  const fw = board.frameWidth;
  ctx.strokeStyle = board.frame;
  ctx.lineWidth = fw;
  ctx.strokeRect(x + fw / 2, y + fw / 2, w - fw, h - fw);

  if (board.frameStyle === 'wood') {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + fw + 0.5, y + fw + 0.5, w - 2 * fw - 1, h - 2 * fw - 1);
  } else if (board.frameStyle === 'double') {
    ctx.lineWidth = 1;
    ctx.strokeRect(x + fw + 3.5, y + fw + 3.5, w - 2 * fw - 7, h - 2 * fw - 7);
  }
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// 炮位、兵位上的小十字标记（显示坐标，dc 为 0 或 8 时只画朝内的一半）
function positionMark(ctx, x, y, cell, dc) {
  const g = cell * 0.08, l = cell * 0.17;
  for (const sx of [-1, 1]) {
    if ((dc === 0 && sx === -1) || (dc === 8 && sx === 1)) continue;
    for (const sy of [-1, 1]) {
      line(ctx, x + sx * g, y + sy * g, x + sx * (g + l), y + sy * g);
      line(ctx, x + sx * g, y + sy * g, x + sx * g, y + sy * (g + l));
    }
  }
}

// g = { ox, oy, cell }：棋盘左上角交叉点的屏幕坐标和格子大小。棋盘本身左右对称，翻转不影响画法。
function drawBoard(ctx, theme, g) {
  const b = theme.board;
  const { ox, oy, cell } = g;
  const px = ox - cell * 0.5, py = oy - cell * 0.5, pw = cell * 9, ph = cell * 10;

  fillBoardColor(ctx, b, px, py, pw, ph);
  ctx.fillRect(px, py, pw, ph);
  if (b.grain) drawGrain(ctx, b.grain, px, py, pw, ph);
  drawFrame(ctx, b, px, py, pw, ph);

  ctx.strokeStyle = b.line;
  ctx.lineWidth = b.lineWidth;
  for (let r = 0; r < 10; r++) line(ctx, ox, oy + r * cell, ox + 8 * cell, oy + r * cell);
  for (let c = 1; c < 8; c++) {
    const x = ox + c * cell;
    // 中间的竖线在"楚河漢界"断开
    line(ctx, x, oy, x, oy + 4 * cell);
    line(ctx, x, oy + 5 * cell, x, oy + 9 * cell);
  }
  for (const top of [0, 7]) {
    line(ctx, ox + 3 * cell, oy + top * cell, ox + 5 * cell, oy + (top + 2) * cell);
    line(ctx, ox + 5 * cell, oy + top * cell, ox + 3 * cell, oy + (top + 2) * cell);
  }
  for (const [r, c] of [[2, 1], [2, 7], [7, 1], [7, 7]]) positionMark(ctx, ox + c * cell, oy + r * cell, cell, c);
  for (const r of [3, 6]) {
    for (const c of [0, 2, 4, 6, 8]) positionMark(ctx, ox + c * cell, oy + r * cell, cell, c);
  }
  ctx.lineWidth = b.lineWidth * 2;
  ctx.strokeRect(ox, oy, 8 * cell, 9 * cell);

  ctx.fillStyle = b.river;
  ctx.font = `${Math.round(cell * 0.55)}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('楚 河', ox + 2 * cell, oy + 4.5 * cell);
  ctx.fillText('漢 界', ox + 6 * cell, oy + 4.5 * cell);
}

function drawPiece(ctx, theme, piece, x, y, radius, glyph, lifted) {
  const P = theme.pieces;
  const s = P[piece === piece.toUpperCase() ? 'r' : 'b'];

  ctx.save();
  if (P.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = lifted ? radius * 0.5 : radius * 0.15;
    ctx.shadowOffsetY = lifted ? radius * 0.25 : radius * 0.08;
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (P.gradient) {
    const grad = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.1, x, y, radius);
    grad.addColorStop(0, s.light);
    grad.addColorStop(1, s.fill);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = s.fill;
  }
  ctx.fill();
  ctx.restore();

  ctx.lineWidth = P.edgeWidth;
  ctx.strokeStyle = P.edge;
  ctx.beginPath();
  ctx.arc(x, y, radius - P.edgeWidth / 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = Math.max(1, radius * 0.05);
  ctx.strokeStyle = s.ring;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.8, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = s.text;
  ctx.font = pieceFamily ? `${Math.round(radius * 1.3)}px "${pieceFamily}", ${family}` : `${Math.round(radius * 1.15)}px ${family}`;
  ctx.textAlign = 'center';
  // 按字的实际轮廓上下居中；不支持轮廓测量的环境退回按基线居中
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(glyph);
  if (m.actualBoundingBoxAscent !== undefined) {
    ctx.fillText(glyph, x, y + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  } else {
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, x, y + radius * 0.05);
  }
}

// 主题页缩略图的底：一角棋盘
function previewBoard(ctx, theme, x, y, w, h) {
  const b = theme.board;
  ctx.save();
  roundRect(ctx, x, y, w, h, 10);
  ctx.clip();
  fillBoardColor(ctx, b, x, y, w, h);
  ctx.fillRect(x, y, w, h);
  if (b.grain) drawGrain(ctx, b.grain, x, y, w, h);
  ctx.strokeStyle = b.line;
  ctx.lineWidth = b.lineWidth;
  const step = w / 4;
  for (let i = 1; i < 4; i++) {
    line(ctx, x + i * step, y, x + i * step, y + h);
    line(ctx, x, y + i * step, x + w, y + i * step);
  }
  ctx.restore();

  ctx.strokeStyle = b.frame;
  ctx.lineWidth = Math.min(4, b.frameWidth);
  roundRect(ctx, x, y, w, h, 10);
  ctx.stroke();
}

// 象棋主题缩略图：一红一黑两枚兵卒
function drawThemePreview(ctx, theme, glyphs, x, y, w, h) {
  previewBoard(ctx, theme, x, y, w, h);
  const radius = w * 0.2;
  drawPiece(ctx, theme, 'P', x + w * 0.38, y + h * 0.56, radius, glyphs.P, false);
  drawPiece(ctx, theme, 'p', x + w * 0.63, y + h * 0.44, radius, glyphs.p, false);
}

// ---------- 五子棋 ----------
// g = { ox, oy, cell, size }：左上角交叉点坐标、格子大小、每边几路
function drawGoBoard(ctx, theme, g) {
  const b = theme.board;
  const { ox, oy, cell, size } = g;
  const span = (size - 1) * cell;
  const px = ox - cell * 0.6, py = oy - cell * 0.6, pw = span + cell * 1.2;

  fillBoardColor(ctx, b, px, py, pw, pw);
  ctx.fillRect(px, py, pw, pw);
  if (b.grain) drawGrain(ctx, b.grain, px, py, pw, pw);
  drawFrame(ctx, b, px, py, pw, pw);

  ctx.strokeStyle = b.line;
  ctx.lineWidth = b.lineWidth;
  for (let i = 0; i < size; i++) {
    line(ctx, ox, oy + i * cell, ox + span, oy + i * cell);
    line(ctx, ox + i * cell, oy, ox + i * cell, oy + span);
  }
  ctx.lineWidth = b.lineWidth * 2;
  ctx.strokeRect(ox, oy, span, span);

  // 天元和四个星位
  ctx.fillStyle = b.line;
  const mid = (size - 1) / 2, q = 3;
  for (const [r, c] of [[mid, mid], [q, q], [q, size - 1 - q], [size - 1 - q, q], [size - 1 - q, size - 1 - q]]) {
    ctx.beginPath();
    ctx.arc(ox + c * cell, oy + r * cell, Math.max(2, cell * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
}

// side：'b' 黑子 | 'w' 白子；颜色来自主题的 stones
function drawStone(ctx, theme, side, x, y, radius) {
  const P = theme.pieces;
  const s = theme.stones[side];
  ctx.save();
  if (P.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = radius * 0.25;
    ctx.shadowOffsetY = radius * 0.12;
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (P.gradient) {
    const grad = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.1, x, y, radius);
    grad.addColorStop(0, s.light);
    grad.addColorStop(1, s.fill);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = s.fill;
  }
  ctx.fill();
  ctx.restore();
  if (s.edge) {
    ctx.lineWidth = theme.stones.edgeWidth || 1;
    ctx.strokeStyle = s.edge;
    ctx.beginPath();
    ctx.arc(x, y, radius - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// 五子棋主题缩略图：一黑一白两枚棋子
function drawGoPreview(ctx, theme, x, y, w, h) {
  previewBoard(ctx, theme, x, y, w, h);
  // 棋子放在缩略图的格线交叉点上（格子边长 w / 4）
  const step = w / 4, radius = step * 0.44;
  drawStone(ctx, theme, 'b', x + step * 2, y + step * 2, radius);
  drawStone(ctx, theme, 'w', x + step * 3, y + step, radius);
  drawStone(ctx, theme, 'b', x + step, y + step, radius);
  drawStone(ctx, theme, 'w', x + step * 3, y + step * 2, radius);
}

module.exports = {
  fontFamily, useFont, usePieceFont, roundRect,
  drawBoard, drawPiece, drawThemePreview, drawGoBoard, drawStone, drawGoPreview,
};
