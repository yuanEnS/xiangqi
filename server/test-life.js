// 生活园接口自测，要先启动本地 Worker：cd worker && npm run dev
const HOST = process.env.SERVER_HOST || '127.0.0.1:8787';
const WebSocket = require('ws');
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

async function signIn(email) {
  const sent = await api('/login/email/send', { email });
  return (await api('/login/email/verify', { email, code: sent.testCode })).token;
}

(async () => {
  const stamp = Date.now();
  const admin = await signIn('admin@test.local');
  const writer = await signIn(`writer${stamp}@test.local`);
  const other = await signIn(`other${stamp}@test.local`);
  const post = { title: '测试文章', date: '2026-01-02', tags: '测试', body: '第一段\n\n第二段' };

  check((await api('/life/posts')).list.some(p => p.id === 1 && p.author === '园主'), '样例文章还在，作者是园主');
  check((await api('/life/save', post)).status === 401, '没登录不能写');
  check((await api('/life/save', { ...post, title: '' }, writer)).status === 400, '标题不能为空');
  check((await api('/life/save', { ...post, date: '2026-13-45' }, writer)).status === 400, '日期要合法');
  check((await api('/life/save', { ...post, date: '2099-01-01' }, writer)).status === 400, '日期不能是将来');
  check(!(await api('/life/mine', undefined, writer)).wroteToday, '校验失败不占发布名额');

  const draft = await api('/life/save', { ...post, draft: true }, writer);
  check(draft.id > 0, '普通账号能存草稿');
  const draft2 = await api('/life/save', { ...post, draft: true, title: '第二篇草稿' }, writer);
  check(!(await api('/life/posts')).list.some(p => p.id === draft.id), '草稿不在公开列表');
  check((await api(`/life/post?id=${draft.id}`)).status === 404, '没登录打不开草稿');
  check((await api(`/life/post?id=${draft.id}`, undefined, other)).status === 404, '别的账号打不开草稿');
  check((await api(`/life/post?id=${draft.id}`, undefined, admin)).status === 404, '园主也打不开别人的草稿');
  check((await api(`/life/post?id=${draft.id}`, undefined, writer)).post.canEdit, '作者能打开自己的草稿');
  check((await api('/life/save', { ...post, id: draft.id }, other)).status === 404, '别的账号不能发布我的草稿');

  const first = await api('/life/save', { ...post, id: draft.id, title: '改过的标题', place: true }, writer);
  check(first.counted === 1, '发布占用今天的名额');
  const published = await api(`/life/post?id=${draft.id}`);
  check(published.post.title === '改过的标题' && published.post.canEdit === false, '发布后大家能看，路人不能改');
  check(/^writer|棋友/.test(published.post.author), '文章带作者昵称');

  const again = await api('/life/save', { ...post, id: draft2.id }, writer);
  check(again.status === 429, '一天只能发布一篇');
  check((await api('/life/save', { ...post, title: '新的一篇' }, writer)).status === 429, '新文章也不能再发布');
  check((await api('/life/mine', undefined, writer)).wroteToday, '名额用掉后接口能告诉页面');

  check((await api('/life/save', { ...post, id: draft.id, title: '再改一次' }, writer)).id === draft.id, '修改已发布的文章不受限制');
  await api('/life/save', { ...post, id: draft.id, draft: true }, writer);
  check((await api('/life/save', { ...post, id: draft.id }, writer)).id === draft.id, '改成草稿再发布不算新的一篇');

  check((await api('/life/save', { ...post, id: draft.id, title: '偷改' }, other)).status === 403, '别的账号不能改');
  check((await api('/life/delete', { id: draft.id }, other)).status === 403, '别的账号不能删');
  check((await api('/life/save', { ...post, id: 999999 }, writer)).status === 404, '不能修改不存在的文章');
  check((await api(`/life/post?id=${draft.id}`, undefined, admin)).post.canEdit, '园主能管理已发布的文章');

  const name = (await api('/life/mine', undefined, writer)).name;
  check(name && (await api(`/life/posts?author=${encodeURIComponent(name)}`)).list.every(p => p.author === name), '能按作者看文章');
  check((await api(`/life/posts?author=${encodeURIComponent(name)}`)).list.some(p => p.id === draft.id), '作者页有这篇文章');
  check((await api('/life/posts?author=没有这个人')).list.length === 0, '不存在的作者没有文章');
  check((await api(`/life/posts?author=${encodeURIComponent('园主')}`)).list.some(p => p.id === 1), '园主的页面有样例文章');
  check((await api(`/life/post?id=${draft.id}`)).older === null, '上一篇不会跳到别的作者');
  check((await api('/me', { name: '园主' }, writer)).status === 409, '昵称不能叫园主');

  const map = await api('/life/map');
  check(Array.isArray(map.cells) && Array.isArray(map.bubbles), '地图接口能读');
  check(map.cells.every(c => c.lat * 2 === Math.round(c.lat * 2) && c.lon * 2 === Math.round(c.lon * 2)), '地图上的坐标是取整过的');
  check(map.bubbles.every(b => !('email' in b) && !('user_id' in b)), '气泡里没有邮箱和账号编号');
  console.log(`  本地位置：${map.cells.length} 个格子，${map.bubbles.length} 位作者`);

  await api('/life/delete', { id: draft.id }, writer);
  check((await api(`/life/post?id=${draft.id}`)).status === 404, '删除后打不开');
  check((await api('/life/save', { ...post, id: draft2.id }, writer)).status === 429, '删掉文章不会多出名额');
  check((await api('/life/post?id=abc')).status === 404, '错误的编号返回 404');

  const other2 = await api('/life/save', { ...post, title: '别人的文章', place: false }, other);
  check((await api('/delete', {}, other)).ok, '能删除账号');
  check((await api(`/life/post?id=${other2.id}`)).status === 404, '删除账号时文章一起删掉');
  await api('/delete', {}, writer);

  const guest = await new Promise(resolve => {
    const socket = new WebSocket(`ws://${HOST}`);
    socket.on('open', () => socket.send(JSON.stringify({ t: 'auth' })));
    socket.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.t === 'auth') {
        socket.close();
        resolve(msg.token);
      }
    });
  });
  check((await api('/life/save', post, guest)).status === 403, '游客账号不能写');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
