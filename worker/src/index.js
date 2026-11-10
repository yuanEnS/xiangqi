// 联网象棋服务器（Cloudflare Workers 版）：网页版在 GitHub Pages 上，需要一个 wss:// 服务器。
// 房间、匹配、走法校验都复用 server/lobby.js，和 Node 版行为完全一致。
import { DurableObject } from 'cloudflare:workers';
import lobbyModule from '../../server/lobby.js';
import { connectUser, handleApi, recordResult } from './accounts.js';
import { lifeSitemap, apiRobots } from './seo.js';

const { Lobby } = lobbyModule;

// 所有连接都由这一个对象处理，房间和匹配队列都在它的内存里
export class LobbyObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.lobby = new Lobby({ onResult: result => this.settle(result).catch(err => console.error('记录积分出错', err)) });
  }

  // 对局结束：记积分，把变化告诉双方
  async settle({ kind, first, second, winner, reason, moves }) {
    const change = await recordResult(this.env, {
      game: kind, firstId: first.user.id, secondId: second.user.id, winner, reason, moves,
    });
    if (!change) return;
    for (const [client, mine] of [[first, change.first], [second, change.second]]) {
      client.user.ratings[kind] = mine.rating;
      client.send({ t: 'rating', delta: mine.delta, rating: mine.rating });
    }
  }

  // 认证失败不影响下棋，这个连接只是不计分
  async auth(client, token, ip) {
    const account = await connectUser(this.env, token, ip);
    if (!account) return;
    client.user = account.user;
    client.send({ t: 'auth', token: account.token, name: account.user.name });
  }

  async fetch(request) {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const [clientSocket, socket] = Object.values(new WebSocketPair());
    socket.accept();

    const client = {
      send(msg) {
        try {
          socket.send(JSON.stringify(msg));
        } catch (e) {
          // 连接已经断开
        }
      },
    };
    this.lobby.connect(client);

    // 认证要查数据库，消息排队依次处理，保证先认证完再匹配
    let pending = Promise.resolve();
    socket.addEventListener('message', event => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      pending = pending
        .then(() => (msg.t === 'auth' ? this.auth(client, msg.token, ip) : this.lobby.message(client, msg)))
        .catch(err => console.error('处理消息出错', err));
    });
    const closed = () => {
      this.lobby.disconnect(client);
      try {
        socket.close();
      } catch (e) {}
    };
    socket.addEventListener('close', closed);
    socket.addEventListener('error', closed);

    return new Response(null, { status: 101, webSocket: clientSocket });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      // 接口返回的 JSON 不要进搜索结果
      const res = await handleApi(request, env, url);
      const headers = new Headers(res.headers);
      headers.set('X-Robots-Tag', 'noindex');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
    if (url.pathname === '/sitemap-life.xml') return lifeSitemap(env);
    if (url.pathname === '/robots.txt') return apiRobots();
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('象棋联网服务器运行中', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const stub = env.LOBBY.get(env.LOBBY.idFromName('main'));
    return stub.fetch(request);
  },
};
