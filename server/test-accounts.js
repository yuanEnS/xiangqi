// 账号和积分自测，要先启动本地 Worker：cd worker && npm run dev
//   node test-accounts.js                     测本地 ws://127.0.0.1:8787
const assert = require('assert');
const WebSocket = require('ws');
const { START, ratingDelta } = require('./rating.js');
const { verifyGoogleToken } = require('./google-token.js');

const HOST = process.env.SERVER_HOST || '127.0.0.1:8787';
const API = `http://${HOST}/api`;

function check(cond, label) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) process.exitCode = 1;
}

async function api(path, body, token) {
  const res = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json()) };
}

function player(token) {
  const ws = new WebSocket(`ws://${HOST}`);
  const inbox = [], waiters = [];
  ws.on('message', d => {
    const msg = JSON.parse(d);
    const i = waiters.findIndex(w => w.t === msg.t);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  const p = {
    ws,
    send: msg => ws.send(JSON.stringify(msg)),
    next(t, ms = 3000) {
      const i = inbox.findIndex(m => m.t === t);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { t, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const at = waiters.indexOf(waiter);
          if (at < 0) return;
          waiters.splice(at, 1);
          reject(new Error('等待超时：' + t));
        }, ms);
      });
    },
    ready: new Promise(r => ws.on('open', r)).then(() => {
      ws.send(JSON.stringify({ t: 'auth', token: token || '' }));
    }),
  };
  return p;
}

// 快速匹配一局五子棋，先手连下五子获胜（走了 9 步）
async function playGomoku(a, b, resignAfter) {
  a.send({ t: 'match', game: 'gomoku' });
  await a.next('matching');
  b.send({ t: 'match', game: 'gomoku' });
  const [sa, sb] = await Promise.all([a.next('start'), b.next('start')]);
  const black = sa.color === 'b' ? a : b, white = black === a ? b : a;
  const moves = resignAfter === undefined ? 4 : resignAfter;
  for (let i = 0; i < moves; i++) {
    black.send({ t: 'move', at: [7, 3 + i] });
    await Promise.all([a.next('move'), b.next('move')]);
    white.send({ t: 'move', at: [8, 3 + i] });
    await Promise.all([a.next('move'), b.next('move')]);
  }
  if (resignAfter === undefined) {
    black.send({ t: 'move', at: [7, 7] });
    await Promise.all([a.next('move'), b.next('move')]);
  } else {
    white.send({ t: 'resign' });
  }
  await Promise.all([a.next('over'), b.next('over')]);
  return { black, white, start: [sa, sb] };
}

async function login(email, token) {
  const sent = await api('/login/email/send', { email });
  return api('/login/email/verify', { email, code: sent.testCode }, token);
}

async function testPure() {
  check(ratingDelta(START, START, 1, 0) === 16 && ratingDelta(START, START, 0, 0) === -16, '同分对局，胜负各 16 分');
  check(ratingDelta(1200, 1600, 1, 0) > 25 && ratingDelta(1600, 1200, 1, 0) < 6, '赢强手加得多，赢弱手加得少');
  check(ratingDelta(1200, 1200, 1, 50) === 10, '老玩家积分变化变小');

  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
  const pair = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
  const b64 = v => Buffer.from(v).toString('base64url');
  const sign = async (claims, kid = 'k1', key = pair.privateKey) => {
    const data = `${b64(JSON.stringify({ alg: 'RS256', kid }))}.${b64(JSON.stringify(claims))}`;
    return `${data}.${b64(new Uint8Array(await crypto.subtle.sign(algorithm, key, Buffer.from(data))))}`;
  };
  const good = { aud: 'id', iss: 'https://accounts.google.com', exp: Date.now() / 1000 + 60, email: 'a@b.c' };
  const verify = t => verifyGoogleToken(t, 'id', [jwk]);
  check((await verify(await sign(good)))?.email === 'a@b.c', 'Google 令牌：有效令牌通过');
  check(await verify(await sign({ ...good, aud: 'other' })) === null, 'Google 令牌：发给别的应用的被拒绝');
  check(await verify(await sign({ ...good, exp: 1 })) === null, 'Google 令牌：过期的被拒绝');
  check(await verify(await sign({ ...good, iss: 'evil.com' })) === null, 'Google 令牌：签发方不对被拒绝');
  const other = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  check(await verify(await sign(good, 'k1', other.privateKey)) === null, 'Google 令牌：伪造签名被拒绝');
  check(await verify('garbage') === null, 'Google 令牌：乱码被拒绝');
}

async function testServer() {
  const config = await api('/config');
  assert(config.email, '本地 Worker 要用 npm run dev 启动（带 EMAIL_TEST_MODE）');

  // 游客账号：第一次联网自动创建
  const a = player(), b = player();
  await Promise.all([a.ready, b.ready]);
  const [authA, authB] = await Promise.all([a.next('auth'), b.next('auth')]);
  check(authA.token && authB.token && authA.name !== authB.name, `自动创建游客：${authA.name}、${authB.name}`);
  const meA = await api('/me', null, authA.token);
  check(meA.user.guest && meA.ratings.gomoku.rating === START && meA.ratings.gomoku.rank === null, '游客初始 1200 分，未上榜');
  check((await api('/me')).status === 401, '没有令牌读不到账号');

  // 计分
  const { black, start } = await playGomoku(a, b);
  check(start[0].opponent.name === authB.name && start[0].opponent.rating === START, '开局时能看到对手昵称和积分');
  const [ra, rb] = await Promise.all([a.next('rating'), b.next('rating')]);
  const [winner, loser] = black === a ? [ra, rb] : [rb, ra];
  check(winner.delta === 16 && loser.delta === -16 && winner.rating === START + 16, '快速匹配结束后双方积分变化 ±16');
  const winnerToken = black === a ? authA.token : authB.token;
  const winMe = await api('/me', null, winnerToken);
  check(winMe.ratings.gomoku.wins === 1 && winMe.ratings.gomoku.rank === 1, '战绩和名次已更新');
  const rankList = await api('/rank?game=gomoku');
  check(rankList.list[0].rating >= START + 16 && !JSON.stringify(rankList).includes('email'), '排行榜有数据，不含邮箱');
  check((await api('/rank?game=chess')).status === 400, '不认识的棋种被拒绝');

  // 同一对手每天只计 3 局，局数太少不计分
  a.send({ t: 'leave' });
  b.send({ t: 'leave' });
  await playGomoku(a, b, 1);
  await a.next('rating', 500).then(() => check(false, '只走几步不该计分'), () => check(true, '走子太少不计分'));
  a.send({ t: 'leave' });
  b.send({ t: 'leave' });
  await new Promise(r => setTimeout(r, 100));
  for (let i = 0; i < 2; i++) {
    await playGomoku(a, b);
    await Promise.all([a.next('rating'), b.next('rating')]);
    a.send({ t: 'leave' });
    b.send({ t: 'leave' });
  }
  await playGomoku(a, b);
  await a.next('rating', 500).then(() => check(false, '第 4 局不该计分'), () => check(true, '同一对手第 4 局不再计分'));
  a.send({ t: 'leave' });
  b.send({ t: 'leave' });

  // 中途离开算输
  const c = player(), d = player();
  await Promise.all([c.ready, d.ready]);
  const [authC, authD] = await Promise.all([c.next('auth'), d.next('auth')]);
  c.send({ t: 'match', game: 'gomoku' });
  await c.next('matching');
  d.send({ t: 'match', game: 'gomoku' });
  const [sc] = await Promise.all([c.next('start'), d.next('start')]);
  const first = sc.color === 'b' ? c : d, second = first === c ? d : c;
  for (let i = 0; i < 3; i++) {
    first.send({ t: 'move', at: [0, i] });
    await Promise.all([c.next('move'), d.next('move')]);
    second.send({ t: 'move', at: [14, i * 3] });
    await Promise.all([c.next('move'), d.next('move')]);
  }
  second.ws.close();
  const stay = await first.next('rating');
  check(stay.delta > 0, '对手中途断线，留下的人赢分');
  first.ws.close();

  // 好友房间不计分
  const e = player(authC.token), f = player(authD.token);
  await Promise.all([e.ready, f.ready]);
  await Promise.all([e.next('auth'), f.next('auth')]);
  e.send({ t: 'create', game: 'gomoku' });
  const { room } = await e.next('created');
  f.send({ t: 'join', room, game: 'gomoku' });
  const [se] = await Promise.all([e.next('start'), f.next('start')]);
  const eb = se.color === 'b' ? e : f, ew = eb === e ? f : e;
  for (let i = 0; i < 4; i++) {
    eb.send({ t: 'move', at: [7, 3 + i] });
    await Promise.all([e.next('move'), f.next('move')]);
    ew.send({ t: 'move', at: [8, 3 + i] });
    await Promise.all([e.next('move'), f.next('move')]);
  }
  ew.send({ t: 'resign' });
  await e.next('over');
  await e.next('rating', 500).then(() => check(false, '好友房不该计分'), () => check(true, '好友房间不计分'));
  e.ws.close();
  f.ws.close();

  // 昵称
  check((await api('/me', { name: 'x' }, authA.token)).status === 400, '昵称太短被拒绝');
  check((await api('/me', { name: '<script>' }, authA.token)).status === 400, '昵称含特殊字符被拒绝');
  const nick = `测试${Date.now() % 100000}`;
  check((await api('/me', { name: nick }, authA.token)).user.name === nick, '修改昵称成功');
  check((await api('/me', { name: nick }, authB.token)).status === 409, '重复昵称被拒绝');

  // 邮箱验证码：游客升级，积分保留
  const email = `t${Date.now()}@example.com`;
  const before = (await api('/me', null, authA.token)).ratings.gomoku;
  const sent = await api('/login/email/send', { email });
  check(sent.ok, '发送验证码');
  check((await api('/login/email/send', { email })).status === 429, '1 分钟内重复发送被拒绝');
  check((await api('/login/email/send', { email: 'bad' })).status === 400, '邮箱格式错误被拒绝');
  const wrong = sent.testCode === '100000' ? '100001' : '100000';
  check((await api('/login/email/verify', { email, code: wrong })).status === 400, '错误验证码被拒绝');
  const logged = await api('/login/email/verify', { email, code: sent.testCode }, authA.token);
  const upgraded = await api('/me', null, logged.token);
  check(!upgraded.user.guest && upgraded.user.email === email && upgraded.ratings.gomoku.rating === before.rating && !logged.switched, '游客绑定邮箱，积分保留');
  check((await api('/login/email/verify', { email, code: sent.testCode })).status === 400, '验证码不能重复使用');

  // 换设备：同一邮箱回到同一账号；别的游客登录时切换过去
  const again = await login(email.toUpperCase(), authB.token);
  check(again.switched && (await api('/me', null, again.token)).user.name === nick, '换设备用同一邮箱，回到原账号（邮箱不分大小写）');

  // 验证码错太多次
  const locked = `l${Date.now()}@example.com`;
  const code = (await api('/login/email/send', { email: locked })).testCode;
  for (let i = 0; i < 5; i++) await api('/login/email/verify', { email: locked, code: code === '100000' ? '100001' : '100000' });
  check((await api('/login/email/verify', { email: locked, code })).status === 429, '错 5 次后验证码作废');

  // 退出和删除
  await api('/logout', {}, again.token);
  check((await api('/me', null, again.token)).status === 401, '退出后令牌失效');
  check((await api('/delete', {}, logged.token)).ok, '删除账号');
  check((await api('/me', null, logged.token)).status === 401, '删除后账号读不到');

  a.ws.close();
  b.ws.close();
}

(async () => {
  await testPure();
  await testServer();
})().catch(err => {
  console.error(err);
  process.exit(1);
}).then(() => setTimeout(() => process.exit(), 100));
