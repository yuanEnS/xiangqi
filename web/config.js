// 网页版配置（打包时替换小游戏的 minigame/js/config.js）
// 留空：只有人机对战和本地双人，不显示联网入口。
// 想在网页上联网对战：把 server/ 部署到有 HTTPS 证书的服务器，填 wss:// 地址，例如 'wss://xiangqi.example.com'。
// 注意 GitHub Pages 是 https 页面，浏览器不允许它连接 ws://（非加密）地址。
module.exports = {
  SERVER_URL: '',
};
