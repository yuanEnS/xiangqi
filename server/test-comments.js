// 评论接口自测，要先启动本地 Worker：cd worker && npm run dev
// 新账号要满一天才能评论，测试用 wrangler 把测试账号的注册时间往前挪两天。
const { execSync } = require('child_process');
const path = require('path');
const HOST = process.env.SERVER_HOST || '127.0.0.1:8787';
const API = `http://${HOST}/api`;

function check(cond, label) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) process.exitCode = 1;
}

async function api(route, body, token) {
  const res = await fetch(API + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json()) };
}

async function signIn(email) {
  const sent = await api('/login/email/send', { email });
  return (await api('/login/email/verify', { email, code: sent.testCode })).token;
}

function sql(command) {
  execSync(`npx wrangler d1 execute gamesyuan --local --command ${JSON.stringify(command.replace(/\s+/g, " "))}`, {
    cwd: path.join(__dirname, '../worker'), stdio: 'ignore',
  });
}

(async () => {
  const stamp = Date.now();
  const admin = await signIn('admin@test.local');
  const writer = await signIn(`cw${stamp}@test.local`);
  const reader = await signIn(`cr${stamp}@test.local`);
  const third = await signIn(`ct${stamp}@test.local`);
  const fourth = await signIn(`cf${stamp}@test.local`);
  const fresh = await signIn(`cn${stamp}@test.local`);
  sql(`UPDATE users SET created_at = created_at - 172800000 WHERE email LIKE 'c_${stamp}@test.local' AND email NOT LIKE 'cn%'`);
  sql("DELETE FROM site_settings WHERE key = 'comment_review'");

  const me = async token => (await api('/me', undefined, token)).user.name;
  const [writerName, readerName] = [await me(writer), await me(reader)];

  // 作者发一篇公开文章（每天一篇的名额，测试用新账号）
  const post = await api('/life/save', { title: '评论测试', date: '2026-01-02', body: '正文' }, writer);
  check(post.id > 0, '作者发布了一篇文章');
  const P = post.id;

  const empty = await api(`/life/comments?post=${P}`);
  check(empty.comments.length === 0 && empty.cannot === 'login', '没登录能看评论，但不能发');
  check((await api('/life/comments/add', { post: P, body: '你好' })).status === 401, '没登录不能评论');
  check((await api(`/life/comments?post=${P}`, undefined, fresh)).cannot === 'new', '新注册的账号要等一天');
  check((await api('/life/comments/add', { post: P, body: '你好' }, fresh)).status === 403, '新账号发不了');

  // 链接、联系方式
  for (const body of ['看这里 https://a.b', '电话１３８００１３８０００', '去 example.com 看看', '加我 vx: abc12345', '电话 138 0013 8000', 'a@b.com']) {
    check((await api('/life/comments/add', { post: P, body }, reader)).status === 400, `拦下「${body}」`);
  }
  check((await api('/life/comments/add', { post: P, body: 'x'.repeat(501) }, reader)).status === 400, '超过 500 字不行');
  check((await api('/life/comments/add', { post: P, body: '   ' }, reader)).status === 400, '空评论不行');

  // 第一次评论先审
  const c1 = await api('/life/comments/add', { post: P, body: '写得真好，2026 年 11 月读到。' }, reader);
  check(c1.id > 0 && c1.pending, '第一次评论进审核');
  check((await api(`/life/comments?post=${P}`, undefined, reader)).comments[0].body === '写得真好，2026 年 11 月读到。', '全角标点原样保存');
  check(!(await api(`/life/comments?post=${P}`)).comments.length, '路人看不到等审核的评论');
  const own = await api(`/life/comments?post=${P}`, undefined, reader);
  check(own.comments.length === 1 && own.comments[0].pending && own.comments[0].mine, '评论者自己看得到，标着等审核');
  const inboxW = await api('/life/comments/inbox', undefined, writer);
  check(inboxW.queue.some(c => c.id === c1.id) && inboxW.unread >= 1, '文章作者的消息里有待审核');
  check((await api('/life/comments/approve', { id: c1.id }, third)).status === 403, '别人不能审核');
  check((await api('/life/comments/approve', { id: c1.id }, writer)).ok, '文章作者通过审核');
  check((await api(`/life/comments?post=${P}`)).comments[0].body.startsWith('写得真好'), '通过后大家都能看');

  // 审过一次以后直接公开
  const c2 = await api('/life/comments/add', { post: P, body: '再说一句' }, reader);
  check(c2.id > 0 && !c2.pending, '审过一次的人直接公开');
  // 敏感词照样先审
  const c3 = await api('/life/comments/add', { post: P, body: '你真是个傻 逼' }, reader);
  check(c3.pending, '骂人的话进审核');

  // 作者自己的评论不用审；回复和楼中楼
  const r1 = await api('/life/comments/add', { post: P, body: '谢谢', parent: c1.id }, writer);
  check(r1.id > 0 && !r1.pending, '作者回复不用审');
  sql(`INSERT INTO comments (post_id, author_id, parent_id, body, status, created_at)
       SELECT ${P}, id, NULL, '旧评论', 'shown', 0 FROM users WHERE email = 'ct${stamp}@test.local'`);
  const r2 = await api('/life/comments/add', { post: P, body: '同意', parent: r1.id }, third);
  check(!r2.pending, '审过的人回复楼中楼');
  const view = await api(`/life/comments?post=${P}`, undefined, reader);
  const reply = view.comments.find(c => c.id === r2.id);
  check(reply && reply.parent === c1.id && reply.replyTo === writerName, '楼中楼挂在顶层评论下，带「回复 @作者」');
  check(view.comments.find(c => c.id === r1.id).postAuthor, '作者的回复标着「作者」');
  const inboxR = await api('/life/comments/inbox', undefined, reader);
  check(inboxR.items.some(c => c.id === r1.id && c.unread), '回复我的出现在消息里');
  await api('/life/comments/seen', {}, reader);
  check((await api('/life/comments/inbox', undefined, reader)).unread === 0, '标成已读');
  check((await api('/life/comments/inbox', undefined, writer)).items.some(c => c.id === r2.id), '回复作者的楼中楼通知作者');

  // 举报：三人举报先藏起来
  check((await api('/life/comments/report', { id: c2.id }, reader)).status === 400, '不能举报自己');
  await api('/life/comments/report', { id: c2.id }, writer);
  await api('/life/comments/report', { id: c2.id }, writer);
  await api('/life/comments/report', { id: c2.id }, third);
  check((await api(`/life/comments?post=${P}`)).comments.some(c => c.id === c2.id), '同一人重复举报只算一次');
  await api('/life/comments/report', { id: c2.id }, fourth);
  check(!(await api(`/life/comments?post=${P}`)).comments.some(c => c.id === c2.id), '三个人举报后先藏起来');
  check((await api('/life/comments/inbox', undefined, admin)).queue.some(c => c.id === c2.id && c.reports === 3), '园主的待审核里有它');

  // 删除：本人、作者能删，别人不能；顶层删了回复还在
  check((await api('/life/comments/delete', { id: r1.id }, third)).status === 403, '不能删别人的评论');
  check((await api('/life/comments/delete', { id: c1.id }, reader)).ok, '能删自己的评论');
  const after = (await api(`/life/comments?post=${P}`)).comments;
  const top = after.find(c => c.id === c1.id);
  check(top && top.deleted && !top.body && after.some(c => c.id === r1.id), '删掉的顶层评论留个位置，回复还在');
  check((await api('/life/comments/add', { post: P, body: '回复已删', parent: c1.id }, third)).status === 404, '不能回复已删除的评论');

  // 关评论
  check((await api('/life/comments/switch', { post: P, off: true }, reader)).status === 403, '别人不能关评论');
  check((await api('/life/comments/switch', { post: P, off: true }, writer)).off, '作者关掉评论');
  check((await api('/life/comments/add', { post: P, body: '还能说吗' }, reader)).status === 403, '关了以后不能评论');
  await api('/life/comments/switch', { post: P, off: false }, writer);

  // 园主：审核方式、禁言
  check((await api('/life/comments/mode', { mode: 'off' }, writer)).status === 403, '普通账号不能改审核方式');
  check((await api('/life/comments/mode', { mode: 'all' }, admin)).mode === 'all', '园主改成全部先审');
  check((await api('/life/comments/add', { post: P, body: '全部先审' }, third)).pending, '全部先审时审过的人也要审');
  await api('/life/comments/mode', { mode: 'first' }, admin);
  check((await api('/life/comments/ban', { name: readerName, wipe: true }, admin)).ok, '园主禁止某人评论并删掉他的评论');
  check((await api(`/life/comments?post=${P}`, undefined, reader)).cannot === 'banned', '被禁的人看到原因');
  check((await api('/life/comments/add', { post: P, body: '我还能说吗' }, reader)).status === 403, '被禁的人发不了');
  check(!(await api(`/life/comments?post=${P}`)).comments.some(c => !c.deleted && c.author === readerName), '他的评论都删了');
  check((await api('/life/comments/inbox', undefined, admin)).bans.includes(readerName), '园主能看到禁言名单');
  await api('/life/comments/ban', { name: readerName, off: true }, admin);
  check((await api(`/life/comments?post=${P}`, undefined, reader)).cannot === '', '恢复后能评论');

  // 文章删掉，评论跟着删；注销账号，评论正文清空
  const thirdName = await me(third);
  await api('/delete', {}, third);
  check(!(await api(`/life/comments?post=${P}`)).comments.some(c => c.body === '同意'), '注销后评论正文清空');
  await api('/life/delete', { id: P }, writer);
  check((await api(`/life/comments?post=${P}`)).status === 404, '文章删了评论也打不开');
  check(thirdName.length > 0, '测试账号已注销');

  for (const token of [writer, reader, fourth, fresh]) await api('/delete', {}, token);
})();
