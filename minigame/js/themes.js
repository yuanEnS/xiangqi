// 主题：界面配色、棋盘、棋子
// 为了在黑白屏（墨水屏、灰度模式）上也能分清红黑：
//   1. 每个主题里红方和黑方棋子的明暗差都很大，转成灰度后依然一深一浅；
//   2. 默认用繁体字，红黑双方每个棋子的字都不一样（俥/車、傌/馬、炮/砲……）；
//   3. 选中、可走位置、上一步都用形状（圆环、圆点、角框）标出，不单靠颜色。

const THEMES = [
  {
    id: 'wood',
    name: '木纹',
    ui: { bg: '#FBF6EE', card: '#FFFDF8', primary: '#C62828', onPrimary: '#FFFFFF', text: '#3A2A1E', muted: '#8A7560', decor: 'rgba(120,90,60,0.07)' },
    board: { fill: ['#F0DAB2', '#DDBA82'], grain: 'rgba(120,80,40,0.10)', frame: '#7A5230', frameWidth: 6, frameStyle: 'wood', line: '#6B4A2B', lineWidth: 1, river: '#8B5A2B' },
    pieces: {
      r: { fill: '#C62828', light: '#E8675C', text: '#FFF4E6', ring: 'rgba(255,240,220,0.75)' },
      b: { fill: '#1F1F1F', light: '#5A5A5A', text: '#FFF4E6', ring: 'rgba(255,240,220,0.6)' },
      edge: 'rgba(0,0,0,0.35)', edgeWidth: 1, shadow: true, gradient: true,
    },
    mark: { select: '#1E88E5', hint: 'rgba(30,136,229,0.9)', last: '#1E88E5' },
  },
  {
    id: 'simple',
    name: '简约',
    ui: { bg: '#FBF7F1', card: '#FFFFFF', primary: '#C62828', onPrimary: '#FFFFFF', text: '#33291F', muted: '#8C7D6B', decor: 'rgba(160,130,100,0.07)' },
    board: { fill: ['#F5EBDC', '#F5EBDC'], frame: '#B89B74', frameWidth: 2, frameStyle: 'plain', line: '#B19C80', lineWidth: 1, river: '#A58A66' },
    pieces: {
      r: { fill: '#CC3333', light: '#CC3333', text: '#FFFFFF', ring: 'rgba(255,255,255,0.7)' },
      b: { fill: '#2B2B2B', light: '#2B2B2B', text: '#FFFFFF', ring: 'rgba(255,255,255,0.55)' },
      edge: 'rgba(0,0,0,0.25)', edgeWidth: 1, shadow: true, gradient: false,
    },
    mark: { select: '#1E88E5', hint: 'rgba(30,136,229,0.9)', last: '#1E88E5' },
  },
  {
    id: 'vietnam',
    name: '越南',
    ui: { bg: '#EEF0E2', card: '#FAFBF4', primary: '#3F6B2A', onPrimary: '#FFFFFF', text: '#2F3A22', muted: '#6F7A5C', decor: 'rgba(63,107,42,0.09)' },
    board: { fill: ['#F1E9C9', '#E2D5A6'], grain: 'rgba(110,100,40,0.08)', frame: '#5E8A35', frameWidth: 9, frameStyle: 'bamboo', line: '#4B5A2C', lineWidth: 1, river: '#A23A2A' },
    pieces: {
      // 象牙白底红字 vs 黑底白字，明暗对比最强
      r: { fill: '#F3EAD2', light: '#FFFBEF', text: '#C0392B', ring: '#C0392B' },
      b: { fill: '#1E1E1E', light: '#4A4A4A', text: '#F3EAD2', ring: 'rgba(243,234,210,0.65)' },
      edge: 'rgba(60,50,20,0.45)', edgeWidth: 1, shadow: true, gradient: true,
    },
    mark: { select: '#D35400', hint: 'rgba(211,84,0,0.9)', last: '#D35400' },
  },
  {
    id: 'night',
    name: '墨夜',
    ui: { bg: '#16191F', card: '#20242C', primary: '#E5484D', onPrimary: '#FFFFFF', text: '#E8EAED', muted: '#9AA1AD', decor: 'rgba(255,255,255,0.04)' },
    board: { fill: ['#2F3542', '#252A34'], frame: '#0F1115', frameWidth: 5, frameStyle: 'plain', line: '#5B6479', lineWidth: 1, river: '#7D8799' },
    pieces: {
      r: { fill: '#E5484D', light: '#F37C80', text: '#FFFFFF', ring: 'rgba(255,255,255,0.7)' },
      // 黑方用浅色棋子，在深色棋盘上和红方一深一浅
      b: { fill: '#D8DCE3', light: '#FFFFFF', text: '#1B1E24', ring: 'rgba(27,30,36,0.45)' },
      edge: 'rgba(0,0,0,0.5)', edgeWidth: 1, shadow: true, gradient: true,
    },
    mark: { select: '#FFC857', hint: 'rgba(255,200,87,0.95)', last: '#FFC857' },
  },
  {
    id: 'mono',
    name: '黑白',
    desc: '墨水屏',
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

function getTheme(id) {
  return THEMES.find(t => t.id === id) || THEMES[0];
}

module.exports = { THEMES, GLYPHS, getTheme };
