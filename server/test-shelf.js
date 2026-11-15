// 研究园书架接口自测，要先启动本地 Worker：cd worker && npm run dev
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

(async () => {
  const stamp = Date.now();
  const me = await signIn(`s1${stamp}@test.local`);
  const other = await signIn(`s2${stamp}@test.local`);
  const paper = { item: '10.1093/jrsssb/qkac003', title: 'Covariate adjustment in multiarmed experiments', journal: 'JRSSB', date: '2023-01-27', link: 'https://doi.org/10.1093/jrsssb/qkac003' };

  check((await api('/shelf')).status === 401, '没登录不能看书架');
  check((await api('/shelf/save', { ...paper, starred: true })).status === 401, '没登录不能收藏');

  const starred = await api('/shelf/save', { ...paper, starred: true }, me);
  check(starred.item && starred.item.starred && !starred.item.status, '打星');
  const reading = await api('/shelf/save', { item: paper.item, status: 'reading' }, me);
  check(reading.item.status === 'reading' && reading.item.starred && reading.item.title === paper.title, '标「在读」，星还在，标题不用再传');
  const done = await api('/shelf/save', { item: paper.item, status: 'done', note: '回归调整的统一框架，\n第三节值得再看。' }, me);
  check(done.item.status === 'done' && done.item.done_at > 0 && done.item.note.includes('第三节'), '标「读完」记下时间，写笔记');
  check((await api('/shelf/save', { item: paper.item, status: 'bad' }, me)).status === 400, '不认识的状态被拒绝');
  check((await api('/shelf/save', { item: paper.item, note: '长'.repeat(301) }, me)).status === 400, '笔记超过 300 字被拒绝');
  check((await api('/shelf/save', { item: 'x', title: 't', link: 'javascript:alert(1)', starred: true }, me)).status === 400, '奇怪的链接被拒绝');
  check((await api('/shelf/save', { item: 'nothing', starred: true }, me)).status === 400, '新条目要有标题');

  const book = await api('/shelf/save', { item: 'book:ding-causal', title: 'A First Course in Causal Inference', link: '/research/books/ding-causal/', status: 'want' }, me);
  check(book.item.status === 'want', '书也能标「想读」');

  const mine = await api('/shelf', undefined, me);
  check(mine.items.length === 2 && mine.items[0].item === 'book:ding-causal', '书架上两条，最近改的在前');
  check((await api('/shelf', undefined, other)).items.length === 0, '别人看不到我的书架');

  const again = await api('/shelf/save', { item: paper.item, status: 'reading' }, me);
  check(!again.item.done_at, '从「读完」改回「在读」，读完时间清掉');
  const cleared = await api('/shelf/save', { item: paper.item, starred: false, status: null, note: '' }, me);
  check(cleared.removed, '星、状态、笔记都清掉就从书架拿掉');
  await api('/shelf/remove', { item: 'book:ding-causal' }, me);
  check((await api('/shelf', undefined, me)).items.length === 0, '删除以后书架空了');

  await api('/shelf/save', { ...paper, starred: true }, me);
  await api('/delete', {}, me);
  const relog = await signIn(`s1${stamp}@test.local`);
  check((await api('/shelf', undefined, relog)).items.length === 0, '注销账号会删掉书架');
})();
