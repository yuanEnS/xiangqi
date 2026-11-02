// WebSocket 封装：收发 JSON 消息
const { SERVER_URL } = require('./config.js');

class Net {
  constructor() {
    this.socket = null;
    this.open = false;
    this.queue = [];
    this.pingTimer = null;
    this.onMessage = () => {};
    this.onClose = () => {};
  }

  // 定时发心跳：服务器据此判断谁还在线，排队匹配时不会配到已经掉线的人
  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ t: 'ping' }), 20000);
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  connect() {
    if (this.socket) return;
    const socket = wx.connectSocket({ url: SERVER_URL });
    this.socket = socket;
    socket.onOpen(() => {
      this.open = true;
      this.startPing();
      for (const msg of this.queue) socket.send({ data: JSON.stringify(msg) });
      this.queue = [];
    });
    socket.onMessage(res => {
      let msg;
      try {
        msg = JSON.parse(res.data);
      } catch (e) {
        return;
      }
      this.onMessage(msg);
    });
    const closed = () => {
      if (this.socket !== socket) return;
      this.stopPing();
      this.socket = null;
      this.open = false;
      this.queue = [];
      this.onClose();
    };
    socket.onClose(closed);
    socket.onError(closed);
  }

  // 还没连上时先排队，连上后一起发
  send(msg) {
    this.connect();
    if (this.open) this.socket.send({ data: JSON.stringify(msg) });
    else this.queue.push(msg);
  }

  close() {
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    this.open = false;
    this.queue = [];
    if (socket) socket.close({});
  }
}

module.exports = Net;
