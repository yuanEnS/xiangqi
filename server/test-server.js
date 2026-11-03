// 服务器自测：模拟玩家自动匹配、建房、加入、走棋、非法走棋、认输、再来一局、断线
// 默认启动本机的 Node 服务器来测；设置 SERVER_URL 可以测别的服务器，比如：
//   SERVER_URL=ws://127.0.0.1:8787 node test-server.js   （本地运行的 Cloudflare Worker）
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 18080;
const URL = process.env.SERVER_URL || `ws://127.0.0.1:${PORT}`;
const server = process.env.SERVER_URL
  ? null
  : spawn(process.execPath, [__dirname + '/server.js'], { env: { ...process.env, PORT } });

function client() {
  const ws = new WebSocket(URL);
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

function stop() {
  if (server) server.kill();
}

(async () => {
  if (server) await new Promise(r => server.stdout.once('data', r));

  // 自动匹配：第一个人排队，第二个人进来就配对
  const m1 = client(), m2 = client(), m3 = client();
  await Promise.all([m1.open(), m2.open(), m3.open()]);
  m1.send({ t: 'match' });
  const waiting = await m1.next('matching');
  check(waiting.online >= 1, `第一个人进入匹配队列（在线 ${waiting.online} 人）`);
  m2.send({ t: 'match' });
  const [s1, s2] = await Promise.all([m1.next('start'), m2.next('start')]);
  check(s1.matched && s2.matched && s1.color !== s2.color && s1.room === s2.room, `匹配成功：${s1.color} 对 ${s2.color}`);
  m3.send({ t: 'match' });
  await m3.next('matching');
  m3.ws.close();
  await new Promise(r => setTimeout(r, 200));
  const m4 = client();
  await m4.open();
  m4.send({ t: 'match' });
  await m4.next('matching');
  check(true, '排队的人断线后被移出队列，新来的人重新排队');
  m4.send({ t: 'cancel_match' });
  const m5 = client();
  await m5.open();
  m5.send({ t: 'match' });
  await m5.next('matching');
  check(true, '取消匹配后不会再被配对');
  for (const c of [m1, m2, m4, m5]) c.ws.close();

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

  // 五子棋：和象棋分开排队，房间互不串门，五连判胜
  const g1 = client(), g2 = client(), x1 = client();
  await Promise.all([g1.open(), g2.open(), x1.open()]);
  x1.send({ t: 'match' });
  await x1.next('matching');
  g1.send({ t: 'match', game: 'gomoku' });
  await g1.next('matching');
  check(true, '五子棋和象棋分开排队，不会配到一起');
  x1.ws.close();

  g2.send({ t: 'create', game: 'gomoku' });
  const { room: groom } = await g2.next('created');
  const x2 = client();
  await x2.open();
  x2.send({ t: 'join', room: groom });
  check((await x2.next('error')).msg === '这是五子棋房间', '象棋客户端加入五子棋房间被拒绝');
  x2.ws.close();

  g1.send({ t: 'join', room: groom, game: 'gomoku' });
  const [ga, gb] = await Promise.all([g1.next('start'), g2.next('start')]);
  check(['b', 'w'].includes(ga.color) && ga.color !== gb.color, `五子棋开局：${ga.color} 对 ${gb.color}`);
  const gBlack = ga.color === 'b' ? g1 : g2;
  const gWhite = gBlack === g1 ? g2 : g1;
  for (let i = 0; i < 4; i++) {
    gBlack.send({ t: 'move', at: [7, 3 + i] });
    await Promise.all([gBlack.next('move'), gWhite.next('move')]);
    gWhite.send({ t: 'move', at: [8, 3 + i] });
    await Promise.all([gBlack.next('move'), gWhite.next('move')]);
  }
  gWhite.send({ t: 'move', at: [0, 0] });
  check((await gWhite.next('error')).msg === '还没轮到你', '五子棋白方抢先被拒绝');
  gBlack.send({ t: 'move', at: [8, 3] });
  check((await gBlack.next('error')).msg === '走法不合法', '下在已有棋子的位置被拒绝');
  gBlack.send({ t: 'move', at: [7, 7] });
  const [gm] = await Promise.all([gWhite.next('move'), gBlack.next('move')]);
  const gover = await gWhite.next('over');
  check(gm.at[1] === 7 && gover.winner === 'b' && gover.reason === 'five', '黑方五连，判黑胜');

  g1.ws.close();
  g2.ws.close();
  stop();
})().catch(err => {
  console.error(err);
  stop();
  process.exit(1);
});
