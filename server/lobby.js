// 房间与自动匹配：Node 服务器（server.js）和 Cloudflare Worker（worker/）共用这一份逻辑。
// 服务器保存权威棋局，客户端只有收到服务器确认后才落子，防止作弊。
//
// client 是一个带 send(obj) 方法的对象，由外层负责把 obj 序列化后发到 WebSocket。
//
// 客户端 → 服务器：match | cancel_match | create | join {room} | move {from, to}
//                  resign | rematch | leave | ping
// 服务器 → 客户端：matching {online} | created {room} | start {color, room, matched}
//                  move {from, to} | over {winner, reason} | rematch_request
//                  opponent_left | error {msg}

const { Game, opponent } = require('../minigame/js/xiangqi.js');

// 超过这么久没收到消息（客户端每 20 秒会 ping 一次），就当它已经掉线，不再给它匹配对手
const STALE_MS = 60000;

class Lobby {
  constructor() {
    this.rooms = new Map(); // 房间号 -> { code, players: { r, b }, game, rematch, matched }
    this.queue = []; // 正在等待匹配的客户端
    this.clients = new Set();
  }

  connect(client) {
    client.room = null;
    client.color = null;
    client.lastSeen = Date.now();
    this.clients.add(client);
  }

  disconnect(client) {
    if (!this.clients.delete(client)) return;
    this.unqueue(client);
    this.leaveRoom(client);
  }

  message(client, msg) {
    client.lastSeen = Date.now();
    const room = client.room;
    switch (msg.t) {
      case 'match':
        this.match(client);
        break;
      case 'cancel_match':
        this.unqueue(client);
        break;
      case 'create': {
        this.unqueue(client);
        this.leaveRoom(client);
        const newRoom = this.newRoom(false);
        // 房主随机执红或执黑
        this.seat(newRoom, client, Math.random() < 0.5 ? 'r' : 'b');
        client.send({ t: 'created', room: newRoom.code });
        break;
      }
      case 'join': {
        const target = this.rooms.get(String(msg.room || '').trim());
        if (!target) return client.send({ t: 'error', msg: '房间不存在' });
        if (target === room) return;
        if (target.players.r && target.players.b) return client.send({ t: 'error', msg: '房间已满' });
        this.unqueue(client);
        this.leaveRoom(client);
        this.seat(target, client, target.players.r ? 'b' : 'r');
        this.startGame(target);
        break;
      }
      case 'move': {
        if (!room || !room.game) return;
        if (room.game.turn !== client.color) return client.send({ t: 'error', msg: '还没轮到你' });
        if (!room.game.move(msg.from, msg.to)) return client.send({ t: 'error', msg: '走法不合法' });
        this.broadcast(room, { t: 'move', from: msg.from, to: msg.to });
        if (room.game.winner) this.broadcast(room, { t: 'over', winner: room.game.winner, reason: room.game.reason });
        break;
      }
      case 'resign': {
        if (!room || !room.game || room.game.winner) return;
        room.game.end(opponent(client.color), 'resign');
        this.broadcast(room, { t: 'over', winner: room.game.winner, reason: 'resign' });
        break;
      }
      case 'rematch': {
        if (!room || !room.game || !room.game.winner) return;
        room.rematch.add(client.color);
        if (room.rematch.size < 2) {
          const other = room.players[opponent(client.color)];
          if (other) other.send({ t: 'rematch_request' });
          return;
        }
        // 双方都同意再来一局：交换红黑
        const { r, b } = room.players;
        this.seat(room, b, 'r');
        this.seat(room, r, 'b');
        this.startGame(room);
        break;
      }
      case 'leave':
        this.unqueue(client);
        this.leaveRoom(client);
        break;
      // ping 只用来刷新 lastSeen
    }
  }

  // 队列里有人就直接配对，没人就排队等下一个
  match(client) {
    this.unqueue(client);
    this.leaveRoom(client);
    const now = Date.now();
    this.queue = this.queue.filter(c => this.clients.has(c) && now - c.lastSeen < STALE_MS);
    const other = this.queue.shift();
    if (!other) {
      this.queue.push(client);
      client.send({ t: 'matching', online: this.clients.size });
      return;
    }
    const room = this.newRoom(true);
    const [red, black] = Math.random() < 0.5 ? [client, other] : [other, client];
    this.seat(room, red, 'r');
    this.seat(room, black, 'b');
    this.startGame(room);
  }

  unqueue(client) {
    const i = this.queue.indexOf(client);
    if (i >= 0) this.queue.splice(i, 1);
  }

  newRoom(matched) {
    let code;
    do {
      code = String(1000 + Math.floor(Math.random() * 9000));
    } while (this.rooms.has(code));
    const room = { code, players: { r: null, b: null }, game: null, rematch: new Set(), matched };
    this.rooms.set(code, room);
    return room;
  }

  seat(room, client, color) {
    room.players[color] = client;
    client.room = room;
    client.color = color;
  }

  broadcast(room, msg) {
    if (room.players.r) room.players.r.send(msg);
    if (room.players.b) room.players.b.send(msg);
  }

  startGame(room) {
    room.game = new Game();
    room.rematch.clear();
    for (const color of ['r', 'b']) {
      room.players[color].send({ t: 'start', color, room: room.code, matched: room.matched });
    }
  }

  // 任何一方离开，房间就解散，并通知另一方
  leaveRoom(client) {
    const room = client.room;
    if (!room) return;
    client.room = null;
    room.players[client.color] = null;
    const other = room.players[opponent(client.color)];
    if (other) {
      other.room = null;
      other.send({ t: 'opponent_left' });
    }
    this.rooms.delete(room.code);
  }
}

module.exports = { Lobby };
