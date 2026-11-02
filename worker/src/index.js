// 联网象棋服务器（Cloudflare Workers 版）：网页版在 GitHub Pages 上，需要一个 wss:// 服务器。
// 房间、匹配、走法校验都复用 server/lobby.js，和 Node 版行为完全一致。
import { DurableObject } from 'cloudflare:workers';
import lobbyModule from '../../server/lobby.js';

const { Lobby } = lobbyModule;

// 所有连接都由这一个对象处理，房间和匹配队列都在它的内存里
export class LobbyObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.lobby = new Lobby();
  }

  async fetch() {
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

    socket.addEventListener('message', event => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      try {
        this.lobby.message(client, msg);
      } catch (err) {
        console.error('处理消息出错', err);
      }
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
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('象棋联网服务器运行中', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const stub = env.LOBBY.get(env.LOBBY.idFromName('main'));
    return stub.fetch(request);
  },
};
