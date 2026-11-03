// 房间与自动匹配：Node 服务器（server.js）和 Cloudflare Worker（worker/）共用这一份逻辑。
// 服务器保存权威棋局，客户端只有收到服务器确认后才落子，防止作弊。
//
// client 是一个带 send(obj) 方法的对象，由外层负责把 obj 序列化后发到 WebSocket。
// 象棋和五子棋共用一套房间和匹配逻辑，match / create / join 带 game 字段区分（不带就是象棋）。
//
// 客户端 → 服务器：match {game} | cancel_match | create {game} | join {room, game}
//                  move（象棋 {from, to}，五子棋 {at}）| resign | rematch | leave | ping
// 服务器 → 客户端：matching {online} | created {room} | start {color, room, matched}
//                  move（同上）| over {winner, reason} | rematch_request
//                  opponent_left | error {msg}

const Xiangqi = require('../minigame/js/xiangqi.js');
const Gomoku = require('../minigame/js/gomoku.js');

// 每种棋：先手方和后手方的颜色、怎么落子、广播给双方的走法内容
const GAMES = {
  xiangqi: {
    name: '象棋',
    sides: ['r', 'b'],
    Game: Xiangqi.Game,
    play: (game, msg) => game.move(msg.from, msg.to),
    payload: msg => ({ from: msg.from, to: msg.to }),
  },
  gomoku: {
    name: '五子棋',
    sides: ['b', 'w'],
    Game: Gomoku.Game,
    play: (game, msg) => game.move(msg.at),
    payload: msg => ({ at: msg.at }),
  },
};

function kindOf(msg) {
  return GAMES[msg.game] ? msg.game : 'xiangqi';
}

// 超过这么久没收到消息（客户端每 20 秒会 ping 一次），就当它已经掉线，不再给它匹配对手
const STALE_MS = 60000;

class Lobby {
  constructor() {
    this.rooms = new Map(); // 房间号 -> { code, kind, players: { 颜色: client }, game, rematch, matched }
    this.queues = { xiangqi: [], gomoku: [] }; // 每种棋各自排队匹配
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
        this.match(client, kindOf(msg));
        break;
      case 'cancel_match':
        this.unqueue(client);
        break;
      case 'create': {
        this.unqueue(client);
        this.leaveRoom(client);
        const newRoom = this.newRoom(kindOf(msg), false);
        // 房主随机执先手或后手
        const [first, second] = GAMES[newRoom.kind].sides;
        this.seat(newRoom, client, Math.random() < 0.5 ? first : second);
        client.send({ t: 'created', room: newRoom.code });
        break;
      }
      case 'join': {
        const target = this.rooms.get(String(msg.room || '').trim());
        if (!target) return client.send({ t: 'error', msg: '房间不存在' });
        if (target === room) return;
        if (target.kind !== kindOf(msg)) {
          return client.send({ t: 'error', msg: `这是${GAMES[target.kind].name}房间` });
        }
        const [first, second] = GAMES[target.kind].sides;
        if (target.players[first] && target.players[second]) return client.send({ t: 'error', msg: '房间已满' });
        this.unqueue(client);
        this.leaveRoom(client);
        this.seat(target, client, target.players[first] ? second : first);
        this.startGame(target);
        break;
      }
      case 'move': {
        if (!room || !room.game) return;
        const rules = GAMES[room.kind];
        if (room.game.turn !== client.color) return client.send({ t: 'error', msg: '还没轮到你' });
        if (!rules.play(room.game, msg)) return client.send({ t: 'error', msg: '走法不合法' });
        this.broadcast(room, { t: 'move', ...rules.payload(msg) });
        if (room.game.winner) this.broadcast(room, { t: 'over', winner: room.game.winner, reason: room.game.reason });
        break;
      }
      case 'resign': {
        if (!room || !room.game || room.game.winner) return;
        room.game.end(this.opponent(room, client.color), 'resign');
        this.broadcast(room, { t: 'over', winner: room.game.winner, reason: 'resign' });
        break;
      }
      case 'rematch': {
        if (!room || !room.game || !room.game.winner) return;
        room.rematch.add(client.color);
        if (room.rematch.size < 2) {
          const other = room.players[this.opponent(room, client.color)];
          if (other) other.send({ t: 'rematch_request' });
          return;
        }
        // 双方都同意再来一局：交换先后手
        const [first, second] = GAMES[room.kind].sides;
        const a = room.players[first], b = room.players[second];
        this.seat(room, b, first);
        this.seat(room, a, second);
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

  // 同一种棋的队列里有人就直接配对，没人就排队等下一个
  match(client, kind) {
    this.unqueue(client);
    this.leaveRoom(client);
    const now = Date.now();
    const queue = this.queues[kind].filter(c => this.clients.has(c) && now - c.lastSeen < STALE_MS);
    this.queues[kind] = queue;
    const other = queue.shift();
    if (!other) {
      queue.push(client);
      client.send({ t: 'matching', online: this.clients.size });
      return;
    }
    const room = this.newRoom(kind, true);
    const [first, second] = GAMES[kind].sides;
    const [a, b] = Math.random() < 0.5 ? [client, other] : [other, client];
    this.seat(room, a, first);
    this.seat(room, b, second);
    this.startGame(room);
  }

  unqueue(client) {
    for (const queue of Object.values(this.queues)) {
      const i = queue.indexOf(client);
      if (i >= 0) queue.splice(i, 1);
    }
  }

  opponent(room, color) {
    const [first, second] = GAMES[room.kind].sides;
    return color === first ? second : first;
  }

  newRoom(kind, matched) {
    let code;
    do {
      code = String(1000 + Math.floor(Math.random() * 9000));
    } while (this.rooms.has(code));
    const players = {};
    for (const side of GAMES[kind].sides) players[side] = null;
    const room = { code, kind, players, game: null, rematch: new Set(), matched };
    this.rooms.set(code, room);
    return room;
  }

  seat(room, client, color) {
    room.players[color] = client;
    client.room = room;
    client.color = color;
  }

  broadcast(room, msg) {
    for (const player of Object.values(room.players)) {
      if (player) player.send(msg);
    }
  }

  startGame(room) {
    room.game = new GAMES[room.kind].Game();
    room.rematch.clear();
    for (const color of GAMES[room.kind].sides) {
      room.players[color].send({ t: 'start', color, room: room.code, matched: room.matched });
    }
  }

  // 任何一方离开，房间就解散，并通知另一方
  leaveRoom(client) {
    const room = client.room;
    if (!room) return;
    client.room = null;
    room.players[client.color] = null;
    const other = room.players[this.opponent(room, client.color)];
    if (other) {
      other.room = null;
      other.send({ t: 'opponent_left' });
    }
    this.rooms.delete(room.code);
  }
}

module.exports = { Lobby };
