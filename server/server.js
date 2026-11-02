// 联网象棋服务器：用 4 位房间号配对两名玩家，校验并转发每一步棋。
// 服务器保存权威棋局，客户端只有收到服务器确认后才落子，防止作弊。
//
// 客户端 → 服务器：create | join {room} | move {from, to} | resign | rematch | leave
// 服务器 → 客户端：created {room} | start {color, room} | move {from, to}
//                  over {winner, reason} | rematch_request | opponent_left | error {msg}

const { WebSocketServer } = require('ws');
const { Game, opponent } = require('../minigame/js/xiangqi.js');

const PORT = Number(process.env.PORT) || 8080;
const wss = new WebSocketServer({ port: PORT });
const rooms = new Map(); // 房间号 -> { code, players: { r, b }, game, rematch }

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  send(room.players.r, msg);
  send(room.players.b, msg);
}

function newRoomCode() {
  let code;
  do {
    code = String(1000 + Math.floor(Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

function seat(room, ws, color) {
  room.players[color] = ws;
  ws.room = room;
  ws.color = color;
}

function startGame(room) {
  room.game = new Game();
  room.rematch.clear();
  for (const color of ['r', 'b']) send(room.players[color], { t: 'start', color, room: room.code });
}

// 任何一方离开，房间就解散，并通知另一方
function leaveRoom(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  room.players[ws.color] = null;
  const other = room.players[opponent(ws.color)];
  if (other) {
    other.room = null;
    send(other, { t: 'opponent_left' });
  }
  rooms.delete(room.code);
}

function handle(ws, msg) {
  const room = ws.room;
  switch (msg.t) {
    case 'create': {
      leaveRoom(ws);
      const newRoom = { code: newRoomCode(), players: { r: null, b: null }, game: null, rematch: new Set() };
      // 房主随机执红或执黑
      seat(newRoom, ws, Math.random() < 0.5 ? 'r' : 'b');
      rooms.set(newRoom.code, newRoom);
      send(ws, { t: 'created', room: newRoom.code });
      break;
    }
    case 'join': {
      const target = rooms.get(String(msg.room || '').trim());
      if (!target) return send(ws, { t: 'error', msg: '房间不存在' });
      if (target === room) return;
      if (target.players.r && target.players.b) return send(ws, { t: 'error', msg: '房间已满' });
      leaveRoom(ws);
      seat(target, ws, target.players.r ? 'b' : 'r');
      startGame(target);
      break;
    }
    case 'move': {
      if (!room || !room.game) return;
      if (room.game.turn !== ws.color) return send(ws, { t: 'error', msg: '还没轮到你' });
      if (!room.game.move(msg.from, msg.to)) return send(ws, { t: 'error', msg: '走法不合法' });
      broadcast(room, { t: 'move', from: msg.from, to: msg.to });
      if (room.game.winner) broadcast(room, { t: 'over', winner: room.game.winner, reason: room.game.reason });
      break;
    }
    case 'resign': {
      if (!room || !room.game || room.game.winner) return;
      room.game.end(opponent(ws.color), 'resign');
      broadcast(room, { t: 'over', winner: room.game.winner, reason: 'resign' });
      break;
    }
    case 'rematch': {
      if (!room || !room.game || !room.game.winner) return;
      room.rematch.add(ws.color);
      if (room.rematch.size < 2) {
        send(room.players[opponent(ws.color)], { t: 'rematch_request' });
        return;
      }
      // 双方都同意再来一局：交换红黑
      const { r, b } = room.players;
      seat(room, b, 'r');
      seat(room, r, 'b');
      startGame(room);
      break;
    }
    case 'leave':
      leaveRoom(ws);
      break;
  }
}

wss.on('connection', ws => {
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
      handle(ws, msg);
    } catch (err) {
      console.error('处理消息出错', err);
    }
  });
  ws.on('close', () => leaveRoom(ws));
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
