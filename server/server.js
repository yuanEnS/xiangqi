// 联网象棋服务器（Node.js 版，小游戏开发时在本机运行）。
// 房间、匹配、走法校验都在 lobby.js 里，Cloudflare Worker 版（worker/）用的是同一份。

const { WebSocketServer } = require('ws');
const { Lobby } = require('./lobby.js');

const PORT = Number(process.env.PORT) || 8080;
const wss = new WebSocketServer({ port: PORT });
const lobby = new Lobby();

wss.on('connection', ws => {
  const client = {
    send(msg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  lobby.connect(client);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    try {
      lobby.message(client, msg);
    } catch (err) {
      console.error('处理消息出错', err);
    }
  });
  ws.on('close', () => lobby.disconnect(client));
});

// 心跳：清理断网但没正常关闭的连接（比如手机切到后台被杀）
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

console.log(`象棋服务器已启动：ws://0.0.0.0:${PORT}`);
