// 房间与自动匹配：Node 服务器（server.js）和 Cloudflare Worker（worker/）共用这一份逻辑。
// 服务器保存权威棋局，客户端只有收到服务器确认后才落子，防止作弊。
//
// client 是一个带 send(obj) 方法的对象，由外层负责把 obj 序列化后发到 WebSocket。
// 象棋、五子棋、黑白棋、四子连珠、斗兽棋共用一套房间和匹配逻辑，match / create / join 带 game 字段区分（不带就是象棋）。
//
// 客户端 → 服务器：match {game, variant?} | cancel_match | create {game, variant?} | join {room, game}
//                  move（象棋 {from, to}，五子棋 {at}，网页上的新棋 {move}）| resign | rematch | leave | ping
//                  timeout（有步时的棋：当前一方超时了，谁都可以报，服务器按自己的时间核对）
// 服务器 → 客户端：matching {online} | created {room} | start {color, room, matched, me, opponent, setup?, turnMs?}
//                  move（同上）| over {winner, reason} | rematch_request
//                  opponent_left | error {msg}
//
// 积分：外层给 client 设置 user {id, name, ratings}，并传入 onResult。只有快速匹配的对局会上报，
// 好友房间不计分，防止约好了刷分。Node 版没有账号，不传 onResult，一切照旧。

const Xiangqi = require('../minigame/js/xiangqi.js');
const Gomoku = require('../minigame/js/gomoku.js');
// 网页上的新棋：规则文件和 gamesyuan.com/games/rules/ 里的是同一份
const Othello = require('./rules/othello.js');
const Connect4 = require('./rules/connect4.js');
const Jungle = require('./rules/jungle.js');
const Chengyu = require('./rules/chengyu.js');

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
  othello: { name: '黑白棋', sides: ['b', 'w'], Game: Othello.Game, play: (game, msg) => game.move(msg.move), payload: msg => ({ move: msg.move }) },
  connect4: { name: '四子连珠', sides: ['r', 'y'], Game: Connect4.Game, play: (game, msg) => game.move(msg.move), payload: msg => ({ move: msg.move }) },
  jungle: { name: '斗兽棋', sides: ['r', 'b'], Game: Jungle.Game, play: (game, msg) => game.move(msg.move), payload: msg => ({ move: msg.move }) },
  // 成语接龙：每步限时 turnMs，开局的成语和接法由服务器定，通过 start 的 setup 发给双方。
  // variants 是可选的接法（同字 / 同音 / 同音同调），快速匹配只配同一种接法的人
  chengyu: {
    name: '成语接龙', sides: ['a', 'b'], Game: Chengyu.Game, turnMs: 60000, variants: ['zi', 'yin', 'diao'],
    play: (game, msg) => game.move(msg.move), payload: msg => ({ move: msg.move }),
  },
};

function kindOf(msg) {
  return GAMES[msg.game] ? msg.game : 'xiangqi';
}

// 有几种玩法的棋（成语接龙的接法），match / create 带 variant 选一种，不带就是第一种
function variantOf(kind, msg) {
  const list = GAMES[kind].variants;
  if (!list) return '';
  return list.includes(msg.variant) ? msg.variant : list[0];
}

// 超过这么久没收到消息（客户端每 20 秒会 ping 一次），就当它已经掉线，不再给它匹配对手
const STALE_MS = 60000;

// 双方合计走够这么多步才计分，开局就退出不算
const MIN_RATED_MOVES = 6;

class Lobby {
  constructor({ onResult } = {}) {
    this.onResult = onResult;
    this.rooms = new Map(); // 房间号 -> { code, kind, players: { 颜色: client }, game, rematch, matched }
    this.queues = {}; // 每种棋（和玩法）各自排队匹配，键是 kind 或 kind:variant
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
      case 'match': {
        const kind = kindOf(msg);
        this.match(client, kind, variantOf(kind, msg));
        break;
      }
      case 'cancel_match':
        this.unqueue(client);
        break;
      case 'create': {
        this.unqueue(client);
        this.leaveRoom(client);
        const kind = kindOf(msg);
        const newRoom = this.newRoom(kind, false, variantOf(kind, msg));
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
        room.moves++;
        room.turnAt = Date.now();
        this.broadcast(room, { t: 'move', ...rules.payload(msg) });
        if (room.game.winner) {
          this.broadcast(room, { t: 'over', winner: room.game.winner, reason: room.game.reason });
          this.report(room);
        }
        break;
      }
      case 'resign': {
        if (!room || !room.game || room.game.winner) return;
        room.game.end(this.opponent(room, client.color), 'resign');
        this.broadcast(room, { t: 'over', winner: room.game.winner, reason: 'resign' });
        this.report(room);
        break;
      }
      case 'timeout': {
        const limit = room && room.game && GAMES[room.kind].turnMs;
        if (!limit || room.game.winner || Date.now() - room.turnAt < limit) return;
        room.game.end(this.opponent(room, room.game.turn), 'timeout');
        this.broadcast(room, { t: 'over', winner: room.game.winner, reason: 'timeout' });
        this.report(room);
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
  match(client, kind, variant = '') {
    this.unqueue(client);
    this.leaveRoom(client);
    const now = Date.now();
    const key = variant ? `${kind}:${variant}` : kind;
    const queue = (this.queues[key] || []).filter(c => this.clients.has(c) && now - c.lastSeen < STALE_MS);
    this.queues[key] = queue;
    const other = queue.shift();
    if (!other) {
      queue.push(client);
      client.send({ t: 'matching', online: this.clients.size });
      return;
    }
    const room = this.newRoom(kind, true, variant);
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

  newRoom(kind, matched, variant = '') {
    let code;
    do {
      code = String(1000 + Math.floor(Math.random() * 9000));
    } while (this.rooms.has(code));
    const players = {};
    for (const side of GAMES[kind].sides) players[side] = null;
    const room = { code, kind, variant, players, game: null, rematch: new Set(), matched };
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
    const rules = GAMES[room.kind];
    room.game = room.variant ? new rules.Game({ rule: room.variant }) : new rules.Game();
    room.moves = 0;
    room.turnAt = Date.now();
    const extra = {};
    if (room.game.setup) extra.setup = room.game.setup();
    if (rules.turnMs) extra.turnMs = rules.turnMs;
    room.rematch.clear();
    const info = client => client.user && { name: client.user.name, rating: client.user.ratings[room.kind] };
    for (const color of GAMES[room.kind].sides) {
      const me = room.players[color];
      const opponent = room.players[this.opponent(room, color)];
      me.send({ t: 'start', color, room: room.code, matched: room.matched, me: info(me), opponent: info(opponent), ...extra });
    }
  }

  // 对局结束时调用，game.winner 已经有值。同一账号开两个窗口对打不计分。
  report(room) {
    if (!this.onResult || !room.matched || room.moves < MIN_RATED_MOVES) return;
    const [firstColor, secondColor] = GAMES[room.kind].sides;
    const first = room.players[firstColor], second = room.players[secondColor];
    if (!first || !second || !first.user || !second.user || first.user.id === second.user.id) return;
    const { winner, reason } = room.game;
    this.onResult({
      kind: room.kind, first, second, reason, moves: room.moves,
      winner: winner === firstColor ? 'first' : winner === secondColor ? 'second' : 'draw',
    });
  }

  // 任何一方离开，房间就解散，并通知另一方。对局没结束就离开算输，否则快输时断线就能躲掉扣分。
  leaveRoom(client) {
    const room = client.room;
    if (!room) return;
    if (room.game && !room.game.winner) {
      room.game.end(this.opponent(room, client.color), 'left');
      this.report(room);
    }
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
