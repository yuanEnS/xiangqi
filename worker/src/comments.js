// 公开文章下的评论和回复，只有文字。要用邮箱或 Google 登录的正式账号，注册满一天才能评论。
//   GET  /api/life/comments?post=1          一篇文章的评论（等审核的只有自己和审核的人看得到）
//   POST /api/life/comments/add {post, body, parent?}   parent 是被回复的评论 id，可以是楼中楼
//   POST /api/life/comments/delete {id}     评论者本人、文章作者、园主可以删
//   POST /api/life/comments/approve {id}    文章作者、园主：通过等审核的评论
//   POST /api/life/comments/report {id}     举报，三个人举报就先藏起来等审核
//   POST /api/life/comments/switch {post, off}  文章作者、园主：关掉或打开这篇文章的评论
//   GET  /api/life/comments/inbox           评论消息：回复我的、我文章下的、等我审核的
//   POST /api/life/comments/seen            评论消息全部标成已读
//   POST /api/life/comments/mode {mode}     园主：审核方式 all / first / off
//   POST /api/life/comments/ban {name, off?}  园主：禁止或恢复某个昵称评论，wipe 为真时删掉他的全部评论
// 防广告：不许留链接和联系方式；命中敏感词的先进审核；每人每天最多 50 条，一分钟最多 5 条。
import { ApiError, overLimit } from './accounts.js';
import { isAdmin, OWNER_NAME } from './life.js';

const BODY_MAX = 500;
const PER_DAY = 50;
const PER_POST = 2000;
const REPORTS_HIDE = 3;
const INBOX_MAX = 100;
const ACCOUNT_AGE = 86400000; // 注册满一天
const DAY = 86400000;
const KEEP_DELETED = 90 * DAY;
const MODES = ['all', 'first', 'off'];
const DEFAULT_MODE = 'first';
const GONE = '已注销';

// 链接和联系方式：直接不让发
const CONTACT = [
  /https?:\/\//i,
  /www\./i,
  /[a-z0-9-]+\s*[.。．]\s*(com|cn|net|org|top|xyz|cc|vip|io|me|info|biz|app|site|club|shop|tk|ml|ly|co|tv|link|online|store|pro|asia|ws|fun|icu|live)(?![a-z])/i,
  /[a-z0-9._-]+@[a-z0-9-]+\./i,
  /(微信|威信|薇信|徽信|vx|wx|v信|微❤|qq|扣扣|企鹅号|tg|telegram|电报|whatsapp|line)\s*[:：号]?\s*[a-z0-9_-]{5,}/i,
  /(?:\d\s?){8,}/, // 手机号、QQ 号这类长串数字
];

// 常见的广告词和骂人的话：不拦，先进审核，由人来看
const WATCH = [
  '代开发票', '发票代开', '贷款', '网贷', '套现', '博彩', '赌场', '赌博', '百家乐', '时时彩', '六合彩', '彩金',
  '刷单', '兼职日结', '日赚', '月入过万', '加我微信', '加微信', '加v', '加微', '私聊我', '扫码', '返利', '代孕',
  '办证', '枪支', '迷药', '稳赚', '招代理', '色情', '约炮', '裸聊', '一夜情', '黄色网站', '成人视频',
  '傻逼', '傻b', '傻x', '煞笔', '沙比', '智障', '脑残', '弱智', '贱人', '婊子', '操你', '草你', '艹你', '日你',
  '干你娘', '你妈死', '去死', '死全家', '狗东西', '滚出去', '废物', '垃圾人', 'nmsl', 'cnm', 'wdnmd',
  'fuck', 'shit', 'bitch',
];

function squash(text) {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

export function checkText(raw) {
  // 存原文（中文的全角标点要保留）；检查时把全角字母数字换成半角，防止用全角绕过
  const text = String(raw || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const length = [...text].length;
  if (!length) throw new ApiError(400, '评论不能是空的');
  if (length > BODY_MAX) throw new ApiError(400, `评论最多 ${BODY_MAX} 个字`);
  const plain = text.normalize('NFKC');
  if (CONTACT.some(rule => rule.test(plain))) throw new ApiError(400, '评论里不能留链接、网址或联系方式（包括长串数字）');
  const flat = squash(text);
  return { text, watch: WATCH.some(word => flat.includes(word)) };
}

async function reviewMode(env) {
  const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'comment_review'").first();
  return row && MODES.includes(row.value) ? row.value : DEFAULT_MODE;
}

// 能看评论的文章：公开发布的
async function openPost(env, id) {
  const post = await env.DB.prepare(
    'SELECT id, author_id, title, comments_off FROM posts WHERE id = ? AND draft = 0 AND hidden = 0'
  ).bind(Number(id) || 0).first();
  if (!post) throw new ApiError(404, '这篇文章不存在');
  return post;
}

// 文章作者和园主能审核、删除这篇文章下的评论。开放之前的文章没有作者，算园主的
function moderates(post, user, admin) {
  return !!user && (admin || post.author_id === user.id);
}

// 不能评论的原因，能评论时返回空字符串
async function whyNot(env, user, post, admin) {
  if (!user) return 'login';
  if (!user.email) return 'guest';
  if (post.comments_off && !moderates(post, user, admin)) return 'off';
  if (admin) return '';
  const [banned, account] = await Promise.all([
    env.DB.prepare('SELECT 1 FROM comment_bans WHERE user_id = ?').bind(user.id).first(),
    env.DB.prepare('SELECT created_at FROM users WHERE id = ?').bind(user.id).first(),
  ]);
  if (banned) return 'banned';
  if (account && Date.now() - account.created_at < ACCOUNT_AGE) return 'new';
  return '';
}

async function list(env, postId, user) {
  const post = await openPost(env, postId);
  const admin = await isAdmin(env, user);
  const mod = moderates(post, user, admin);
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.parent_id, c.author_id, c.body, c.status, c.reports, c.created_at,
       u.name AS author, r.name AS reply_name, c.reply_to,
       ${user ? 'EXISTS (SELECT 1 FROM comment_reports x WHERE x.comment_id = c.id AND x.user_id = ?)' : '0'} AS reported
     FROM comments c LEFT JOIN users u ON u.id = c.author_id LEFT JOIN users r ON r.id = c.reply_to
     WHERE c.post_id = ? ORDER BY c.id LIMIT ?`
  ).bind(...(user ? [user.id] : []), post.id, PER_POST).all();

  const mine = row => !!user && row.author_id === user.id;
  const visible = row => row.status === 'shown' || (row.status === 'pending' && (mine(row) || mod));
  // 删掉的顶层评论下面还有看得到的回复时，留一个「已删除」的位置
  const keptParents = new Set(results.filter(row => row.parent_id && visible(row)).map(row => row.parent_id));
  const comments = [];
  for (const row of results) {
    const deleted = row.status === 'deleted';
    if (deleted ? row.parent_id || !keptParents.has(row.id) : !visible(row)) continue;
    // 回复所在的顶层评论看不到了（等审核、或者被删且没留位置），回复也不显示
    comments.push({
      id: row.id,
      parent: row.parent_id,
      author: deleted ? '' : row.author || GONE,
      replyTo: row.reply_to ? row.reply_name || GONE : null,
      body: deleted ? '' : row.body,
      time: row.created_at,
      deleted,
      pending: row.status === 'pending',
      reports: mod ? row.reports : undefined,
      mine: mine(row),
      reported: !!row.reported,
      canDelete: !deleted && (mine(row) || mod),
      postAuthor: !deleted && post.author_id !== null && row.author_id === post.author_id,
    });
  }
  const tops = new Set(comments.filter(c => !c.parent).map(c => c.id));
  return {
    comments: comments.filter(c => !c.parent || tops.has(c.parent)),
    off: !!post.comments_off,
    canModerate: mod,
    cannot: await whyNot(env, user, post, admin),
    max: BODY_MAX,
  };
}

async function purgeOld(env) {
  await env.DB.prepare(
    "UPDATE comments SET body = '' WHERE status = 'deleted' AND deleted_at < ? AND body != ''"
  ).bind(Date.now() - KEEP_DELETED).run();
}

async function add(env, body, user) {
  const post = await openPost(env, body.post);
  const admin = await isAdmin(env, user);
  const reason = await whyNot(env, user, post, admin);
  const messages = {
    login: '请先登录', guest: '游客账号不能评论，请用邮箱或 Google 登录', off: '这篇文章关闭了评论',
    banned: '你的账号已被禁止评论', new: '新注册的账号要过一天才能评论',
  };
  if (reason) throw new ApiError(reason === 'login' ? 401 : 403, messages[reason]);
  const { text, watch } = checkText(body.body);

  if (!admin) {
    if (await overLimit(env, `comment:${user.id}`, 5, 60000)) throw new ApiError(429, '评论太快了，歇一会儿再发');
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE author_id = ? AND created_at > ?')
      .bind(user.id, Date.now() - DAY).first();
    if (n >= PER_DAY) throw new ApiError(429, `每人每天最多发 ${PER_DAY} 条评论`);
  }
  const { n: total } = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?').bind(post.id).first();
  if (total >= PER_POST) throw new ApiError(400, '这篇文章的评论已经满了');

  // 回复：楼中楼都挂在顶层评论下面，记下被回复的人
  let parent = null, replyTo = null;
  if (body.parent) {
    const target = await env.DB.prepare('SELECT id, parent_id, author_id, status FROM comments WHERE id = ? AND post_id = ?')
      .bind(Number(body.parent) || 0, post.id).first();
    if (!target || target.status !== 'shown') throw new ApiError(404, '要回复的评论不存在');
    parent = target.parent_id || target.id;
    if (target.parent_id) replyTo = target.author_id;
  }

  // 审核：园主和文章作者自己的评论不用审；其余看审核方式，命中敏感词的一律先审
  let status = 'shown';
  if (!moderates(post, user, admin)) {
    const mode = await reviewMode(env);
    let review = watch || mode === 'all';
    if (!review && mode === 'first') {
      const passed = await env.DB.prepare("SELECT 1 FROM comments WHERE author_id = ? AND status = 'shown' LIMIT 1").bind(user.id).first();
      review = !passed;
    }
    if (review) status = 'pending';
  }
  const row = await env.DB.prepare(
    `INSERT INTO comments (post_id, author_id, parent_id, reply_to, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(post.id, user.id, parent, replyTo, text, status, Date.now()).first();
  await purgeOld(env);
  return { id: row.id, pending: status === 'pending' };
}

// 一条评论和它所在的文章，顺便算出当前用户对它有什么权限
async function target(env, id, user) {
  const row = await env.DB.prepare(
    `SELECT c.id, c.post_id, c.author_id, c.status, p.author_id AS post_author
     FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?`
  ).bind(Number(id) || 0).first();
  if (!row || row.status === 'deleted') throw new ApiError(404, '这条评论不存在');
  const admin = await isAdmin(env, user);
  return { row, admin, mod: moderates({ author_id: row.post_author }, user, admin) };
}

async function remove(env, body, user) {
  const { row, mod } = await target(env, body.id, user);
  if (row.author_id !== user.id && !mod) throw new ApiError(403, '只能删自己的评论');
  await env.DB.prepare("UPDATE comments SET status = 'deleted', deleted_by = ?, deleted_at = ? WHERE id = ?")
    .bind(user.id, Date.now(), row.id).run();
  return { ok: true };
}

async function approve(env, body, user) {
  const { row, mod } = await target(env, body.id, user);
  if (!mod) throw new ApiError(403, '只有文章作者和园主能审核');
  await env.DB.prepare("UPDATE comments SET status = 'shown', reports = 0 WHERE id = ?").bind(row.id).run();
  return { ok: true };
}

async function report(env, body, user) {
  if (!user.email) throw new ApiError(403, '游客账号不能举报，请用邮箱或 Google 登录');
  const { row } = await target(env, body.id, user);
  if (row.author_id === user.id) throw new ApiError(400, '不能举报自己的评论');
  const added = await env.DB.prepare(
    'INSERT OR IGNORE INTO comment_reports (comment_id, user_id, created_at) VALUES (?, ?, ?) RETURNING comment_id'
  ).bind(row.id, user.id, Date.now()).first();
  if (added) {
    await env.DB.prepare(
      `UPDATE comments SET reports = reports + 1,
         status = CASE WHEN status = 'shown' AND reports + 1 >= ? THEN 'pending' ELSE status END WHERE id = ?`
    ).bind(REPORTS_HIDE, row.id).run();
  }
  return { ok: true };
}

async function switchPost(env, body, user) {
  const post = await openPost(env, body.post);
  if (!moderates(post, user, await isAdmin(env, user))) throw new ApiError(403, '只有文章作者能关评论');
  await env.DB.prepare('UPDATE posts SET comments_off = ? WHERE id = ?').bind(body.off ? 1 : 0, post.id).run();
  return { off: !!body.off };
}

const INBOX_FIELDS = `c.id, c.post_id AS post, p.title, c.body, c.status, c.reports, c.created_at AS time,
  COALESCE(u.name, '${GONE}') AS author, c.parent_id AS parent`;
const INBOX_FROM = `FROM comments c JOIN posts p ON p.id = c.post_id LEFT JOIN users u ON u.id = c.author_id
  LEFT JOIN comments t ON t.id = c.parent_id`;
const LIVE_POST = 'p.draft = 0 AND p.hidden = 0';

async function inbox(env, user) {
  const admin = await isAdmin(env, user);
  // 我文章下的、回复我的；园主还管开放之前那些没有作者的文章
  const mineWhere = `c.author_id != ? AND ${LIVE_POST} AND (
    (c.parent_id IS NULL AND (p.author_id = ?${admin ? ' OR p.author_id IS NULL' : ''}))
    OR c.reply_to = ? OR (c.parent_id IS NOT NULL AND c.reply_to IS NULL AND t.author_id = ?))`;
  const queueWhere = `c.status = 'pending' AND ${LIVE_POST} AND c.author_id != ?${admin ? '' : ' AND p.author_id = ?'}`;
  const [items, queue, seen, mode, bans] = await Promise.all([
    env.DB.prepare(`SELECT ${INBOX_FIELDS} ${INBOX_FROM} WHERE c.status = 'shown' AND ${mineWhere} ORDER BY c.id DESC LIMIT ?`)
      .bind(user.id, user.id, user.id, user.id, INBOX_MAX).all(),
    env.DB.prepare(`SELECT ${INBOX_FIELDS} ${INBOX_FROM} WHERE ${queueWhere} ORDER BY c.id LIMIT ?`)
      .bind(...(admin ? [user.id] : [user.id, user.id]), INBOX_MAX).all(),
    env.DB.prepare('SELECT comments_seen FROM users WHERE id = ?').bind(user.id).first(),
    admin ? reviewMode(env) : null,
    admin ? env.DB.prepare(
      'SELECT u.name FROM comment_bans b JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC LIMIT 200'
    ).all() : null,
  ]);
  const last = seen ? seen.comments_seen : 0;
  const list = items.results.map(item => ({ ...item, unread: item.id > last }));
  return {
    items: list,
    queue: queue.results,
    unread: list.filter(item => item.unread).length + queue.results.length,
    admin,
    mode,
    bans: bans ? bans.results.map(b => b.name) : undefined,
  };
}

async function markSeen(env, user) {
  const row = await env.DB.prepare('SELECT MAX(id) AS id FROM comments').first();
  await env.DB.prepare('UPDATE users SET comments_seen = ? WHERE id = ?').bind((row && row.id) || 0, user.id).run();
  return { ok: true };
}

async function setMode(env, body) {
  if (!MODES.includes(body.mode)) throw new ApiError(400, '审核方式不对');
  await env.DB.prepare(
    "INSERT INTO site_settings (key, value) VALUES ('comment_review', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
  ).bind(body.mode).run();
  return { mode: body.mode };
}

async function ban(env, body, user) {
  const name = String(body.name || '').trim();
  const who = name && name !== OWNER_NAME
    ? await env.DB.prepare('SELECT id FROM users WHERE name = ?').bind(name).first()
    : null;
  if (!who) throw new ApiError(404, '没有这个昵称');
  if (who.id === user.id) throw new ApiError(400, '不能禁止自己');
  if (body.off) {
    await env.DB.prepare('DELETE FROM comment_bans WHERE user_id = ?').bind(who.id).run();
    return { ok: true };
  }
  const steps = [
    env.DB.prepare('INSERT OR IGNORE INTO comment_bans (user_id, created_at) VALUES (?, ?)').bind(who.id, Date.now()),
  ];
  if (body.wipe) {
    steps.push(env.DB.prepare(
      "UPDATE comments SET status = 'deleted', deleted_by = ?, deleted_at = ? WHERE author_id = ? AND status != 'deleted'"
    ).bind(user.id, Date.now(), who.id));
  }
  await env.DB.batch(steps);
  return { ok: true };
}

// 注销账号时：评论正文立刻清空（不再保留 90 天），位置留着，免得别人的回复没了上下文
export function forgetCommenter(env, userId) {
  return [
    env.DB.prepare(
      "UPDATE comments SET status = 'deleted', body = '', deleted_by = ?, deleted_at = ? WHERE author_id = ?"
    ).bind(userId, Date.now(), userId),
    env.DB.prepare('DELETE FROM comment_reports WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM comment_bans WHERE user_id = ?').bind(userId),
  ];
}

export async function commentsRoute(env, key, url, body, user) {
  if (key === 'GET /api/life/comments') return list(env, url.searchParams.get('post'), user);
  if (!user) throw new ApiError(401, '请先登录');
  switch (key) {
    case 'POST /api/life/comments/add':
      return add(env, body, user);
    case 'POST /api/life/comments/delete':
      return remove(env, body, user);
    case 'POST /api/life/comments/approve':
      return approve(env, body, user);
    case 'POST /api/life/comments/report':
      return report(env, body, user);
    case 'POST /api/life/comments/switch':
      return switchPost(env, body, user);
    case 'GET /api/life/comments/inbox':
      return inbox(env, user);
    case 'POST /api/life/comments/seen':
      return markSeen(env, user);
  }
  if (!(await isAdmin(env, user))) throw new ApiError(403, '只有园主能做这件事');
  switch (key) {
    case 'POST /api/life/comments/mode':
      return setMode(env, body);
    case 'POST /api/life/comments/ban':
      return ban(env, body, user);
  }
  throw new ApiError(404, '接口不存在');
}
