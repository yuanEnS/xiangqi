// 把小游戏的代码打包成网页能直接加载的一个文件
// 用法：
//   node web/build.js                    打包象棋到 web/dist/，本地预览 web/index.html 用
//   node web/build.js xiangqi _site      生成完整的象棋网站到 _site/（GitHub Actions 部署用）
//   node web/build.js gomoku ../yuanEnS.github.io/wuziqi   生成五子棋网站（gamesyuan.com/wuziqi/）
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const gameRoot = path.join(root, 'minigame');

// 每个网页只放一个游戏；pages 是要复制的页面：{ 输出文件名: web/ 下的源文件 }
const SITES = {
  xiangqi: { pages: { 'index.html': 'index.html', 'rules.html': 'rules.html' } },
  gomoku: { pages: { 'index.html': 'pages/wuziqi.html' } },
};
const [game = 'xiangqi', outArg] = process.argv.slice(2);
if (!SITES[game]) throw new Error(`不认识的游戏：${game}（可选 ${Object.keys(SITES).join(' / ')}）`);
const out = outArg ? path.resolve(outArg) : null;
const dist = out ? path.join(out, 'dist') : path.join(__dirname, 'dist');

// 网页版用自己的配置替换小游戏的 config.js：服务器地址来自 web/config.js，游戏列表只有这一个
// 本地测试可以临时指定服务器：SERVER_URL=ws://127.0.0.1:8787 node web/build.js
const webConfig = require('./config.js');
const serverUrl = process.env.SERVER_URL || webConfig.SERVER_URL;
const CONFIG_SOURCE = `module.exports = ${JSON.stringify({ SERVER_URL: serverUrl, GAMES: [game] })};`;

function resolve(fromId, request) {
  let id = path.posix.normalize(path.posix.join(path.posix.dirname(fromId), request));
  if (!id.endsWith('.js')) id += '.js';
  return id;
}

// 从入口开始，顺着 require('./xxx') 找出所有用到的模块
const modules = new Map();
function addModule(id) {
  if (modules.has(id)) return;
  const source = id === 'js/config.js' ? CONFIG_SOURCE : fs.readFileSync(path.join(gameRoot, id), 'utf8');
  modules.set(id, source);
  for (const match of source.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) addModule(resolve(id, match[1]));
}
addModule('game.js');

const defs = [...modules]
  .map(([id, source]) => `${JSON.stringify(id)}: function (require, module, exports) {\n${source}\n}`)
  .join(',\n');

const bundle = `// 自动生成，请勿手改：改 minigame/ 下的代码后运行 node web/build.js
(function () {
var defs = {
${defs}
};
var cache = {};
function resolve(from, request) {
  var parts = from.split('/').slice(0, -1);
  request.split('/').forEach(function (seg) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  });
  var id = parts.join('/');
  return /\\.js$/.test(id) ? id : id + '.js';
}
function load(id) {
  if (cache[id]) return cache[id].exports;
  var module = { exports: {} };
  cache[id] = module;
  defs[id](function (request) { return load(resolve(id, request)); }, module, module.exports);
  return module.exports;
}
load('game.js');
})();
`;

fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });
fs.writeFileSync(path.join(dist, 'game.js'), bundle);
for (const file of ['kai.ttf', 'piece.ttf', 'OFL.txt']) {
  fs.copyFileSync(path.join(gameRoot, 'fonts', file), path.join(dist, 'fonts', file));
}
if (out) {
  const files = { ...SITES[game].pages, 'wx-adapter.js': 'wx-adapter.js', 'favicon.svg': 'favicon.svg' };
  for (const [to, from] of Object.entries(files)) fs.copyFileSync(path.join(__dirname, from), path.join(out, to));
}
console.log(`打包完成：${game}，${modules.size} 个模块 → ${path.relative(process.cwd(), dist) || '.'}/game.js（${Math.round(bundle.length / 1024)} KB）`);
