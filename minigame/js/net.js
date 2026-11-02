// WebSocket 封装：收发 JSON 消息
const { SERVER_URL } = require('./config.js');

class Net {
  constructor() {
    this.socket = null;
    this.open = false;
    this.queue = [];
    this.onMessage = () => {};
    this.onClose = () => {};
  }

  connect() {
    if (this.socket) return;
    const socket = wx.connectSocket({ url: SERVER_URL });
    this.socket = socket;
    socket.onOpen(() => {
      this.open = true;
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
    const socket = this.socket;
    this.socket = null;
    this.open = false;
    this.queue = [];
    if (socket) socket.close({});
  }
}

module.exports = Net;
