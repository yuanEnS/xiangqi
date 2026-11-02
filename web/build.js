// 把小游戏的代码打包成网页能直接加载的一个文件：web/dist/game.js
// 用法：node web/build.js（GitHub Actions 部署时也会自动运行）
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const gameRoot = path.join(root, 'minigame');
const dist = path.join(__dirname, 'dist');

// 网页版用自己的配置（服务器地址）替换小游戏的 config.js
const OVERRIDES = { 'js/config.js': path.join(__dirname, 'config.js') };

function resolve(fromId, request) {
  let id = path.posix.normalize(path.posix.join(path.posix.dirname(fromId), request));
  if (!id.endsWith('.js')) id += '.js';
  return id;
}

// 从入口开始，顺着 require('./xxx') 找出所有用到的模块
const modules = new Map();
function addModule(id) {
  if (modules.has(id)) return;
  let source = fs.readFileSync(OVERRIDES[id] || path.join(gameRoot, id), 'utf8');
  // 本地测试可以临时指定服务器：SERVER_URL=ws://127.0.0.1:8787 node web/build.js
  if (id === 'js/config.js' && process.env.SERVER_URL) {
    source = `module.exports = { SERVER_URL: ${JSON.stringify(process.env.SERVER_URL)} };`;
  }
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
for (const file of ['kai.ttf', 'OFL.txt']) {
  fs.copyFileSync(path.join(gameRoot, 'fonts', file), path.join(dist, 'fonts', file));
}
console.log(`打包完成：${modules.size} 个模块 → web/dist/game.js（${Math.round(bundle.length / 1024)} KB）`);
