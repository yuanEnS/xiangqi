// 服务器自测：启动服务器，模拟两个玩家建房、加入、走棋、非法走棋、认输、再来一局
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 18080;
const server = spawn(process.execPath, [__dirname + '/server.js'], { env: { ...process.env, PORT } });

function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', d => {
    const msg = JSON.parse(d);
    const i = waiters.findIndex(w => w.t === msg.t);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  return {
    ws,
    open: () => new Promise(r => ws.on('open', r)),
    send: msg => ws.send(JSON.stringify(msg)),
    next: t => {
      const i = inbox.findIndex(m => m.t === t);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiters.push({ t, resolve });
        setTimeout(() => reject(new Error('等待超时：' + t)), 2000);
      });
    },
  };
}

function check(cond, label) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  await new Promise(r => server.stdout.once('data', r));
  const a = client(), b = client();
  await Promise.all([a.open(), b.open()]);

  a.send({ t: 'create' });
  const { room } = await a.next('created');
  check(/^\d{4}$/.test(room), '创建房间，房间号 ' + room);

  b.send({ t: 'join', room: '0000' });
  check((await b.next('error')).msg === '房间不存在', '错误房间号被拒绝');

  b.send({ t: 'join', room });
  const [sa, sb] = await Promise.all([a.next('start'), b.next('start')]);
  check(sa.color !== sb.color, `开局：A 执 ${sa.color}，B 执 ${sb.color}`);
  const red = sa.color === 'r' ? a : b;
  const black = red === a ? b : a;

  black.send({ t: 'move', from: [3, 4], to: [4, 4] });
  check((await black.next('error')).msg === '还没轮到你', '黑方抢先走被拒绝');

  red.send({ t: 'move', from: [7, 1], to: [7, 7] });
  check((await red.next('error')).msg === '走法不合法', '炮走到己方棋子位置被拒绝');

  red.send({ t: 'move', from: [7, 1], to: [7, 4] }); // 当头炮
  const [ma, mb] = await Promise.all([red.next('move'), black.next('move')]);
  check(ma.to[1] === 4 && mb.to[1] === 4, '合法走法同步给双方');

  black.send({ t: 'resign' });
  const over = await red.next('over');
  await black.next('over');
  check(over.winner === 'r' && over.reason === 'resign', '黑方认输，红方胜');

  red.send({ t: 'rematch' });
  await black.next('rematch_request');
  black.send({ t: 'rematch' });
  const [ra, rb] = await Promise.all([red.next('start'), black.next('start')]);
  check(ra.color === 'b' && rb.color === 'r', '再来一局，双方交换红黑');

  black.ws.close();
  await red.next('opponent_left');
  check(true, '对手断线，另一方收到通知');

  a.ws.close();
  b.ws.close();
  server.kill();
})().catch(err => {
  console.error(err);
  server.kill();
  process.exit(1);
});
