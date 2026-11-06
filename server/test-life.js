// 园中小记接口自测，要先启动本地 Worker：cd worker && npm run dev
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

async function signIn(email) {
  const sent = await api('/login/email/send', { email });
  return (await api('/login/email/verify', { email, code: sent.testCode })).token;
}

(async () => {
  const stamp = Date.now();
  const admin = await signIn('admin@test.local');
  const other = await signIn(`reader${stamp}@test.local`);
  const post = { title: '测试文章', date: '2030-01-02', tags: '测试', body: '第一段\n\n第二段' };

  check((await api('/life/posts')).list.some(p => p.id === 1), '样例文章已经在数据库里');

  check((await api('/life/save', post)).status === 401, '没登录不能写');
  check((await api('/life/save', post, other)).status === 403, '别的账号不能写');
  check((await api('/life/admin', undefined, other)).status === 403, '别的账号看不到后台列表');
  check((await api('/life/delete', { id: 1 }, other)).status === 403, '别的账号不能删');
  check((await api('/life/save', { ...post, title: '' }, admin)).status === 400, '标题不能为空');
  check((await api('/life/save', { ...post, date: '2030-13-45' }, admin)).status === 400, '日期要合法');

  const draft = await api('/life/save', { ...post, draft: true }, admin);
  check(draft.id > 0, '作者能保存草稿');
  check(!(await api('/life/posts')).list.some(p => p.id === draft.id), '草稿不在公开列表');
  check((await api(`/life/post?id=${draft.id}`)).status === 404, '别人打不开草稿');
  check((await api(`/life/post?id=${draft.id}`, undefined, other)).status === 404, '别的账号打不开草稿');
  check((await api(`/life/post?id=${draft.id}`, undefined, admin)).post.draft === 1, '作者能打开草稿');
  check((await api('/life/admin', undefined, admin)).list.some(p => p.id === draft.id), '后台列表有草稿');

  await api('/life/save', { ...post, id: draft.id, title: '改过的标题', draft: false }, admin);
  const published = await api(`/life/post?id=${draft.id}`);
  check(published.post.title === '改过的标题', '修改并发布后别人能看到');
  check(published.older && published.older.id === 1 && !published.newer, '前后篇按日期排列');
  check((await api('/life/post?id=1')).newer.id === draft.id, '旧文章能找到下一篇');
  check((await api('/life/save', { ...post, id: 999999 }, admin)).status === 404, '不能修改不存在的文章');

  await api('/life/delete', { id: draft.id }, admin);
  check((await api(`/life/post?id=${draft.id}`)).status === 404, '删除后打不开');
  check((await api('/life/post?id=abc')).status === 404, '错误的编号返回 404');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
