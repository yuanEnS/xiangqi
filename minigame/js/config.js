// 小游戏配置
// SERVER_URL 留空：不显示联网入口，只有人机对战和本地双人。
//   以后要联网：换成已备案域名的 wss:// 地址，并在小游戏后台配置为 socket 合法域名。
//   开发时也可以临时填运行 server 那台电脑的局域网地址，例如 'ws://192.168.1.10:8080'。
// GAMES：首页列出的游戏，只有一个时直接进入该游戏。
module.exports = {
  SERVER_URL: '',
  GAMES: ['xiangqi', 'gomoku'],
};
