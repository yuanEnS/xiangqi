// 账号、登录、积分和排行榜。数据都在 D1 里，表结构见 worker/migrations/。
//
// 网页接口（令牌放在 Authorization: Bearer 里）：
//   GET  /api/config                    哪些登录方式已开通
//   GET  /api/me                        当前账号和积分        POST /api/me {name} 改昵称
//   POST /api/login/google {credential}                       POST /api/logout
//   POST /api/login/email/send {email}                        POST /api/delete 删除账号
//   POST /api/login/email/verify {email, code}                GET  /api/rank?game=xiangqi
import ratingModule from '../../server/rating.js';
import googleModule from '../../server/google-token.js';
import { lifeRoute } from './life.js';

const { START, ratingDelta } = ratingModule;
const { verifyGoogleToken } = googleModule;

const GAMES = ['xiangqi', 'gomoku'];
const DAY = 86400000;
const SESSION_MS = 365 * DAY;
const CODE_MS = 10 * 60000;
const CODE_COOLDOWN_MS = 60000;
const CODE_ATTEMPTS = 5;
const MAIL_PER_DAY = 90; // Resend 免费版每天 100 封，留一点余量
const PAIR_GAMES_PER_DAY = 3; // 同一对手每天最多计分几局，防止两个号互相刷分
const RANK_SIZE = 100;
const GOOGLE_KEYS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomInt(min, max) {
  return min + crypto.getRandomValues(new Uint32Array(1))[0] % (max - min);
}

// 固定时间窗口内的次数限制，超过返回 true
async function overLimit(env, key, max, windowMs) {
  const now = Date.now();
  await env.DB.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(now).run();
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT (key) DO UPDATE SET count = count + 1 RETURNING count`
  ).bind(key, now + windowMs).first();
  return row.count > max;
}

async function newUser(env, email) {
  for (let i = 0; i < 5; i++) {
    const row = await env.DB.prepare(
      'INSERT OR IGNORE INTO users (name, email, created_at) VALUES (?, ?, ?) RETURNING id, name, email'
    ).bind(`棋友${randomInt(100000, 1000000)}`, email, Date.now()).first();
    if (row) return row;
  }
  throw new ApiError(500, '创建账号失败，请重试');
}

async function newSession(env, userId) {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, Date.now() + SESSION_MS).run();
  return token;
}

async function findUser(env, token) {
  if (!token) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`
  ).bind(hash).first();
  const now = Date.now();
  if (!row || row.expires_at < now) return null;
  // 常来玩的人不用重新登录，游客账号也不会过期丢掉
  if (row.expires_at - now < SESSION_MS / 2) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_MS, hash).run();
  }
  return { id: row.id, name: row.name, email: row.email };
}

async function ratingsOf(env, userId) {
  const { results } = await env.DB.prepare('SELECT * FROM ratings WHERE user_id = ?').bind(userId).all();
  const ratings = {};
  for (const game of GAMES) {
    ratings[game] = results.find(r => r.game === game) || { rating: START, games: 0, wins: 0, losses: 0, draws: 0 };
  }
  return ratings;
}

// ---------- 大厅用：连接时认证、对局结束记分 ----------

// 联网时确认身份：令牌有效就用原账号，否则新建游客账号。返回 { user, token? }，
// user 带各棋种当前积分；同一 IP 建号太多时返回 null，这个连接照常下棋但不计分。
export async function connectUser(env, token, ip) {
  let user = await findUser(env, token);
  let newToken;
  if (!user) {
    if (await overLimit(env, `guest:${await sha256(ip)}`, 20, 3600000)) return null;
    user = await newUser(env, null);
    newToken = await newSession(env, user.id);
  }
  const ratings = await ratingsOf(env, user.id);
  user.ratings = Object.fromEntries(GAMES.map(game => [game, ratings[game].rating]));
  return { user, token: newToken };
}

// winner：'first' | 'second' | 'draw'。返回双方的积分变化，这局不计分时返回 null
export async function recordResult(env, { game, firstId, secondId, winner, reason, moves }) {
  const now = Date.now();
  const played = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM matches WHERE game = ? AND created_at > ?
     AND ((first_id = ? AND second_id = ?) OR (first_id = ? AND second_id = ?))`
  ).bind(game, now - DAY, firstId, secondId, secondId, firstId).first();
  if (played.n >= PAIR_GAMES_PER_DAY) return null;

  const [a, b] = await Promise.all([ratingsOf(env, firstId), ratingsOf(env, secondId)]);
  const first = a[game], second = b[game];
  const firstScore = winner === 'first' ? 1 : winner === 'draw' ? 0.5 : 0;
  const firstDelta = ratingDelta(first.rating, second.rating, firstScore, first.games);
  const secondDelta = ratingDelta(second.rating, first.rating, 1 - firstScore, second.games);

  const save = (id, rating, score) => env.DB.prepare(
    `INSERT INTO ratings (user_id, game, rating, games, wins, losses, draws) VALUES (?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT (user_id, game) DO UPDATE SET rating = excluded.rating, games = games + 1,
       wins = wins + excluded.wins, losses = losses + excluded.losses, draws = draws + excluded.draws`
  ).bind(id, game, rating, score === 1 ? 1 : 0, score === 0 ? 1 : 0, score === 0.5 ? 1 : 0);
  await env.DB.batch([
    save(firstId, first.rating + firstDelta, firstScore),
    save(secondId, second.rating + secondDelta, 1 - firstScore),
    env.DB.prepare(
      `INSERT INTO matches (game, first_id, second_id, winner, reason, moves, first_delta, second_delta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(game, firstId, secondId, winner, reason || null, moves, firstDelta, secondDelta, now),
  ]);
  return {
    first: { delta: firstDelta, rating: first.rating + firstDelta },
    second: { delta: secondDelta, rating: second.rating + secondDelta },
  };
}

// ---------- 登录 ----------

// 邮箱已验证后的统一入口。邮箱没用过时，把当前的游客账号升级成正式账号，积分保留。
async function login(env, email, current) {
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  let userId;
  if (existing) {
    userId = existing.id;
  } else if (current && !current.email) {
    await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, current.id).run();
    userId = current.id;
  } else {
    userId = (await newUser(env, email)).id;
  }
  return {
    token: await newSession(env, userId),
    // 这个邮箱早就有账号：切换过去，这台设备上的游客积分不合并
    switched: !!(existing && current && current.id !== existing.id),
  };
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, '邮箱格式不对');
  return email;
}

async function sendMail(env, email, code) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: email,
      subject: `游戏园登录验证码：${code}`,
      text: `你的验证码是 ${code}，10 分钟内有效。\n如果不是你本人操作，忽略这封邮件即可。`,
    }),
  });
  if (!res.ok) {
    console.error('发送邮件失败', res.status, await res.text());
    throw new ApiError(502, '邮件发送失败，请稍后再试');
  }
}

function emailEnabled(env) {
  return !!env.RESEND_API_KEY || env.EMAIL_TEST_MODE === '1';
}

async function sendCode(env, body, ip) {
  if (!emailEnabled(env)) throw new ApiError(503, '邮箱登录暂未开通');
  const email = normalizeEmail(body.email);
  const now = Date.now();
  const old = await env.DB.prepare('SELECT sent_at FROM email_codes WHERE email = ?').bind(email).first();
  if (old && now - old.sent_at < CODE_COOLDOWN_MS) throw new ApiError(429, '发送太频繁，请 1 分钟后再试');
  if (await overLimit(env, `mail:${await sha256(ip)}`, 10, 3600000)) throw new ApiError(429, '发送太频繁，请稍后再试');
  if (await overLimit(env, 'mail:all', MAIL_PER_DAY, DAY)) throw new ApiError(429, '今天的验证码发送量已满，请明天再试或用 Google 登录');

  const code = String(randomInt(100000, 1000000));
  await env.DB.prepare(
    `INSERT INTO email_codes (email, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       attempts = 0, sent_at = excluded.sent_at`
  ).bind(email, await sha256(`${email}:${code}`), now + CODE_MS, now).run();
  // 本地测试不真的发信，把验证码直接返回。线上不设置 EMAIL_TEST_MODE。
  if (env.EMAIL_TEST_MODE === '1') return { ok: true, testCode: code };
  await sendMail(env, email, code);
  return { ok: true };
}

async function verifyCode(env, body, current) {
  const email = normalizeEmail(body.email);
  const row = await env.DB.prepare('SELECT * FROM email_codes WHERE email = ?').bind(email).first();
  if (!row || row.expires_at < Date.now()) throw new ApiError(400, '验证码已过期，请重新获取');
  if (row.attempts >= CODE_ATTEMPTS) throw new ApiError(429, '错误次数太多，请重新获取验证码');
  if (await sha256(`${email}:${String(body.code || '').trim()}`) !== row.code_hash) {
    await env.DB.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?').bind(email).run();
    throw new ApiError(400, '验证码不对');
  }
  await env.DB.prepare('DELETE FROM email_codes WHERE email = ?').bind(email).run();
  return login(env, email, current);
}

async function googleLogin(env, body, current) {
  if (!env.GOOGLE_CLIENT_ID) throw new ApiError(503, 'Google 登录暂未开通');
  const res = await fetch(GOOGLE_KEYS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  const { keys } = await res.json();
  const claims = await verifyGoogleToken(body.credential, env.GOOGLE_CLIENT_ID, keys);
  if (!claims || !claims.email || !claims.email_verified) throw new ApiError(401, 'Google 登录验证失败');
  return login(env, normalizeEmail(claims.email), current);
}

// ---------- 账号 ----------

async function profile(env, user) {
  const ratings = await ratingsOf(env, user.id);
  for (const game of GAMES) {
    const r = ratings[game];
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM ratings WHERE game = ? AND rating > ?').bind(game, r.rating).first();
    ratings[game] = {
      rating: r.rating, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws,
      rank: r.games ? row.n + 1 : null,
    };
  }
  return { user: { name: user.name, email: user.email, guest: !user.email }, ratings };
}

async function rename(env, user, body) {
  const name = String(body.name || '').trim();
  const length = [...name].length;
  if (length < 2 || length > 12 || !/^[\p{L}\p{N}_·-]+$/u.test(name)) {
    throw new ApiError(400, '昵称要 2 到 12 个字，只能用文字、数字、下划线');
  }
  const row = await env.DB.prepare('SELECT id FROM users WHERE name = ? AND id != ?').bind(name, user.id).first();
  if (row) throw new ApiError(409, '这个昵称已经有人用了');
  await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
  return profile(env, { ...user, name });
}

async function removeAccount(env, user) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM ratings WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return { ok: true };
}

async function rank(env, game) {
  if (!GAMES.includes(game)) throw new ApiError(400, '不认识的游戏');
  const { results } = await env.DB.prepare(
    `SELECT u.name, r.rating, r.games, r.wins, r.losses, r.draws FROM ratings r JOIN users u ON u.id = r.user_id
     WHERE r.game = ? ORDER BY r.rating DESC, r.games DESC LIMIT ?`
  ).bind(game, RANK_SIZE).all();
  return { list: results };
}

// ---------- 路由 ----------

async function route(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const key = `${request.method} ${url.pathname}`;
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const current = await findUser(env, token);
  const signedIn = () => {
    if (!current) throw new ApiError(401, '请先登录');
    return current;
  };

  if (url.pathname.startsWith('/api/life/')) return lifeRoute(env, key, url, body, current);

  switch (key) {
    case 'GET /api/config':
      return { google: env.GOOGLE_CLIENT_ID || null, email: emailEnabled(env) };
    case 'GET /api/rank':
      return rank(env, url.searchParams.get('game'));
    case 'GET /api/me':
      return profile(env, signedIn());
    case 'POST /api/me':
      return rename(env, signedIn(), body);
    case 'POST /api/login/google':
      return googleLogin(env, body, current);
    case 'POST /api/login/email/send':
      return sendCode(env, body, ip);
    case 'POST /api/login/email/verify':
      if (await overLimit(env, `verify:${await sha256(ip)}`, 30, 3600000)) throw new ApiError(429, '尝试太频繁，请稍后再试');
      return verifyCode(env, body, current);
    case 'POST /api/logout':
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
      return { ok: true };
    case 'POST /api/delete':
      return removeAccount(env, signedIn());
  }
  throw new ApiError(404, '接口不存在');
}

// 令牌放在请求头里、不用 Cookie，所以允许本地调试页面跨域访问也没有风险
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = /^https:\/\/gamesyuan\.com$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://gamesyuan.com',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    Vary: 'Origin',
  };
}

export async function handleApi(request, env, url) {
  const headers = corsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  let status = 200, result;
  try {
    result = await route(request, env, url);
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('接口出错', err);
    status = err.status || 500;
    result = { error: err instanceof ApiError ? err.message : '服务器出错，请稍后再试' };
  }
  return Response.json(result, { status, headers });
}
