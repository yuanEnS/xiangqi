// 主题：界面配色、棋盘、棋子
// 为了在黑白屏（墨水屏、灰度模式）上也能分清红黑：
//   1. 每个主题里红方和黑方棋子的明暗差都很大，转成灰度后依然一深一浅；
//   2. 默认用繁体字，红黑双方每个棋子的字都不一样（俥/車、傌/馬、炮/砲……）；
//   3. 选中、可走位置、上一步都用形状（圆环、圆点、角框）标出，不单靠颜色。

const THEMES = [
  {
    id: 'che',
    name: '车',
    desc: '檀木',
    ui: { bg: '#FAF3E8', card: '#FFFCF6', primary: '#B71C1C', onPrimary: '#FFFFFF', text: '#3A2618', muted: '#86705A', decor: 'rgba(110,70,40,0.07)' },
    board: { fill: ['#EBCB98', '#D2A86E'], grain: 'rgba(110,65,30,0.11)', frame: '#6A3E22', frameWidth: 7, frameStyle: 'wood', line: '#5E3D22', lineWidth: 1, river: '#7A4A24' },
    pieces: {
      r: { fill: '#B71C1C', light: '#E0584C', text: '#FFF4E4', ring: 'rgba(255,238,215,0.75)' },
      b: { fill: '#262019', light: '#5C5247', text: '#FFF4E4', ring: 'rgba(255,238,215,0.6)' },
      edge: 'rgba(0,0,0,0.35)', edgeWidth: 1, shadow: true, gradient: true,
    },
    mark: { select: '#1565C0', hint: 'rgba(21,101,192,0.9)', last: '#1565C0' },
  },
  {
    id: 'ma',
    name: '马',
    desc: '青瓷',
    ui: { bg: '#EDF2EC', card: '#FAFCF9', primary: '#2F6B4F', onPrimary: '#FFFFFF', text: '#22332A', muted: '#66796D', decor: 'rgba(47,107,79,0.08)' },
    board: { fill: ['#DCE8D6', '#C3D6BE'], frame: '#4E7A62', frameWidth: 6, frameStyle: 'plain', line: '#3F5E4C', lineWidth: 1, river: '#3F5E4C' },
    pieces: {
      // 米白底红字 vs 墨绿底白字，转成灰度后一浅一深
      r: { fill: '#FBF3E2', light: '#FFFDF6', text: '#B23A2E', ring: '#B23A2E' },
      b: { fill: '#1F2E27', light: '#44564C', text: '#E8F0E6', ring: 'rgba(232,240,230,0.6)' },
      edge: 'rgba(30,50,40,0.45)', edgeWidth: 1, shadow: true, gradient: true,
    },
    mark: { select: '#C77700', hint: 'rgba(199,119,0,0.9)', last: '#C77700' },
  },
  {
    id: 'xiang',
    name: '象',
    desc: '宣纸',
    ui: { bg: '#FBF8F2', card: '#FFFFFF', primary: '#C0392B', onPrimary: '#FFFFFF', text: '#2F2A24', muted: '#8A8072', decor: 'rgba(150,130,100,0.06)' },
    board: { fill: ['#FAF4E6', '#FAF4E6'], frame: '#A88B63', frameWidth: 2, frameStyle: 'plain', line: '#A8977E', lineWidth: 1, river: '#9A8466' },
    pieces: {
      r: { fill: '#C0392B', light: '#C0392B', text: '#FFFFFF', ring: 'rgba(255,255,255,0.7)' },
      b: { fill: '#2D2A26', light: '#2D2A26', text: '#FFFFFF', ring: 'rgba(255,255,255,0.55)' },
      edge: 'rgba(0,0,0,0.25)', edgeWidth: 1, shadow: true, gradient: false,
    },
    mark: { select: '#1565C0', hint: 'rgba(21,101,192,0.9)', last: '#1565C0' },
  },
  {
    id: 'shi',
    name: '士',
    desc: '墨夜',
    ui: { bg: '#141821', card: '#1E2430', primary: '#E5484D', onPrimary: '#FFFFFF', text: '#E6E9EF', muted: '#97A0B0', decor: 'rgba(255,255,255,0.04)' },
    board: { fill: ['#2C3446', '#232A39'], frame: '#0D1017', frameWidth: 5, frameStyle: 'plain', line: '#5A6580', lineWidth: 1, river: '#7C879C' },
    pieces: {
      r: { fill: '#E5484D', light: '#F37C80', text: '#FFFFFF', ring: 'rgba(255,255,255,0.7)' },
      // 黑方用浅色棋子，在深色棋盘上和红方一深一浅
      b: { fill: '#D6DBE4', light: '#FFFFFF', text: '#1A1E26', ring: 'rgba(26,30,38,0.45)' },
      edge: 'rgba(0,0,0,0.5)', edgeWidth: 1, shadow: true, gradient: true,
    },
    mark: { select: '#FFC857', hint: 'rgba(255,200,87,0.95)', last: '#FFC857' },
  },
  {
    id: 'pao',
    name: '炮',
    desc: '黑白',
    ui: { bg: '#FFFFFF', card: '#FFFFFF', primary: '#000000', onPrimary: '#FFFFFF', text: '#000000', muted: '#444444', decor: null },
    board: { fill: ['#FFFFFF', '#FFFFFF'], frame: '#000000', frameWidth: 3, frameStyle: 'double', line: '#000000', lineWidth: 1.2, river: '#000000' },
    pieces: {
      r: { fill: '#FFFFFF', light: '#FFFFFF', text: '#000000', ring: '#000000' },
      b: { fill: '#000000', light: '#000000', text: '#FFFFFF', ring: '#FFFFFF' },
      edge: '#000000', edgeWidth: 2, shadow: false, gradient: false,
    },
    mark: { select: '#000000', hint: '#000000', last: '#000000' },
  },
];

const GLYPHS = {
  // 繁体：红黑双方用字全部不同
  trad: {
    K: '帥', A: '仕', B: '相', N: '傌', R: '俥', C: '炮', P: '兵',
    k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒',
  },
  simp: {
    K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
    k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
  },
};

// 旧版本存下的主题 id，换成对应的新主题
const OLD_IDS = { wood: 'che', vietnam: 'ma', simple: 'xiang', night: 'shi', mono: 'pao' };

function getTheme(id) {
  id = OLD_IDS[id] || id;
  return THEMES.find(t => t.id === id) || THEMES[0];
}

module.exports = { THEMES, GLYPHS, getTheme };
