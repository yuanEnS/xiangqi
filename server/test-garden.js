// 私人园园地接口自测，要先启动本地 Worker：cd worker && npm run dev
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
  const owner = await signIn(`gowner${stamp}@test.local`);
  const friend = await signIn(`gfriend${stamp}@test.local`);
  const stranger = await signIn(`gstranger${stamp}@test.local`);
  const nameOf = async token => (await api('/me', undefined, token)).user.name;
  const friendName = await nameOf(friend);
  const ownerName = await nameOf(owner);

  check((await api('/garden/save', { kind: 'wish', title: '心愿' })).status === 401, '没登录不能开园地');
  check((await api('/garden/geo?q=Kyoto')).status === 401, '没登录不能搜地点');
  check((await api('/garden/geo?q=', undefined, owner)).status === 400, '搜地点要输入地名');
  check((await api('/garden/save', { kind: 'nope', title: '奇怪' }, owner)).status === 400, '只能开给定的几种');
  check((await api('/garden/save', { kind: 'wish', title: '' }, owner)).status === 400, '名字不能为空');
  const wish = await api('/garden/save', { kind: 'wish', title: '一起的心愿', intro: '慢慢实现' }, owner);
  check(wish.id > 0, '能开心愿单');
  const trip = await api('/garden/save', { kind: 'travel', title: '旅行地图', public: true }, owner);
  const days = await api('/garden/save', { kind: 'dates', title: '纪念日' }, owner);

  check((await api(`/garden/view?id=${wish.id}`)).status === 404, '不公开的园地路人打不开');
  check((await api(`/garden/view?id=${wish.id}`, undefined, stranger)).status === 404, '别的账号也打不开');
  check((await api(`/garden/view?id=${trip.id}`)).garden.role === 'none', '公开的园地路人能看');
  const pub = await api(`/garden/list?author=${encodeURIComponent(ownerName)}`);
  check(pub.list.length === 1 && pub.list[0].id === trip.id, '别人只看到公开的园地');

  check((await api('/garden/item', { garden: wish.id, title: '看极光' }, owner)).id > 0, '主人能加心愿');
  check((await api('/garden/item', { garden: wish.id, title: '偷加' }, stranger)).status === 404, '路人不能往私密园地加');
  check((await api('/garden/item', { garden: trip.id, title: '偷加', lat: 1, lon: 1 }, stranger)).status === 403, '路人不能往公开园地加');
  check((await api('/garden/item', { garden: trip.id, title: '京都' }, owner)).status === 400, '旅行要在地图上选地方');
  const kyoto = await api('/garden/item', { garden: trip.id, title: '京都', body: '下雨的寺庙', date: '2025-04-02', lat: 35.0116, lon: 135.7681 }, owner);
  check(kyoto.id > 0, '能加旅行故事');
  check((await api(`/garden/view?id=${trip.id}`)).items[0].lat === 35.01, '坐标取两位小数');
  check((await api('/garden/item', { garden: days.id, title: '认识那天' }, owner)).status === 400, '纪念日要填日期');
  check((await api('/garden/item', { garden: days.id, title: '认识那天', date: '2020-05-20' }, owner)).id > 0, '能加纪念日');

  check((await api('/garden/invite', { id: wish.id, name: friendName }, stranger)).status === 404, '路人不能邀请');
  check((await api('/garden/invite', { id: wish.id, name: '没有这个人zz' }, owner)).status === 404, '邀请不存在的昵称会提示');
  check((await api('/garden/invite', { id: wish.id, name: ownerName }, owner)).status === 400, '不能邀请自己');
  check((await api('/garden/invite', { id: wish.id, name: friendName }, owner)).ok, '能按昵称邀请');
  const pending = await api('/garden/list', undefined, friend);
  check(pending.invites.some(g => g.id === wish.id) && !pending.list.some(g => g.id === wish.id), '受邀的人能看到邀请');
  check((await api(`/garden/view?id=${wish.id}`, undefined, friend)).garden.role === 'invited', '受邀的人能先看看');
  check((await api('/garden/item', { garden: wish.id, title: '还没答应' }, friend)).status === 403, '没答应前不能写');
  check((await api('/garden/answer', { id: wish.id, accept: true }, friend)).ok, '能答应邀请');
  check((await api('/garden/list', undefined, friend)).list.some(g => g.id === wish.id && !g.owned), '答应后出现在自己的园地里');

  const friendWish = await api('/garden/item', { garden: wish.id, title: '去看海' }, friend);
  check(friendWish.id > 0, '一起写的人能加');
  const view = await api(`/garden/view?id=${wish.id}`, undefined, friend);
  const ownerWish = view.items.find(i => i.title === '看极光');
  check(view.items.find(i => i.id === friendWish.id).author === friendName, '条目带作者');
  check((await api('/garden/item', { garden: wish.id, id: ownerWish.id, title: '看极光', done: true }, friend)).id === ownerWish.id, '一起写的人能勾掉别人的心愿');
  check((await api(`/garden/view?id=${wish.id}`, undefined, owner)).items.find(i => i.id === ownerWish.id).done === 1, '勾掉后标成完成');
  check((await api('/garden/item/delete', { id: ownerWish.id }, friend)).status === 403, '一起写的人不能删别人写的');
  check((await api('/garden/item/delete', { id: friendWish.id }, owner)).ok, '主人能删任何一条');
  check((await api('/garden/save', { id: wish.id, title: '改名' }, friend)).status === 403, '只有主人能改园地设置');
  check((await api('/garden/delete', { id: wish.id }, friend)).status === 403, '一起写的人不能删园地');

  check((await api('/garden/remove', { id: wish.id }, friend)).ok, '一起写的人能退出');
  check((await api(`/garden/view?id=${wish.id}`, undefined, friend)).status === 404, '退出后看不到私密园地');
  await api('/garden/invite', { id: wish.id, name: friendName }, owner);
  check((await api('/garden/answer', { id: wish.id, accept: false }, friend)).ok, '能拒绝邀请');
  check(!(await api('/garden/list', undefined, friend)).invites.some(g => g.id === wish.id), '拒绝后邀请消失');
  await api('/garden/invite', { id: wish.id, name: friendName }, owner);
  check((await api('/garden/remove', { id: wish.id, name: friendName }, owner)).ok, '主人能撤回邀请或请人离开');
  check((await api('/garden/remove', { id: wish.id }, owner)).status === 400, '主人不能退出');

  check((await api('/garden/save', { id: wish.id, title: '改好的名字', public: true }, owner)).id === wish.id, '主人能改名、改成公开');
  check((await api(`/garden/view?id=${wish.id}`)).garden.title === '改好的名字', '改成公开后路人能看');
  check((await api('/garden/delete', { id: trip.id }, admin)).ok, '园主能删公开的园地');
  check((await api('/garden/delete', { id: days.id }, admin)).status === 404, '园主看不到也删不了私密园地');
  check((await api('/garden/delete', { id: days.id }, owner)).ok, '主人能删园地');
  check((await api(`/garden/view?id=${days.id}`, undefined, owner)).status === 404, '删掉后就没了');

  // 「其他」园地和园中园
  const notes = await api('/garden/save', { kind: 'notes', title: '我们的书房' }, owner);
  check(notes.id > 0, '能开自己起名的「其他」园地');
  check((await api('/garden/item', { garden: notes.id, title: '长文', body: '字'.repeat(12000) }, owner)).id > 0, '「其他」园地能写长文章');
  await api('/garden/invite', { id: notes.id, name: friendName }, owner);
  await api('/garden/answer', { id: notes.id, accept: true }, friend);
  const sub = await api('/garden/save', { parent: notes.id, kind: 'travel', title: '欧洲' }, friend);
  check(sub.id > 0, '一起写的人能在园地里开小园地');
  check((await api('/garden/save', { parent: notes.id, kind: 'wish', title: '偷开' }, stranger)).status === 404, '路人不能开小园地');
  const subView = await api(`/garden/view?id=${sub.id}`, undefined, friend);
  check(subView.garden.role === 'member' && subView.path[0].id === notes.id, '小园地跟着外层的身份，带着路径');
  check((await api(`/garden/view?id=${notes.id}`, undefined, owner)).children.some(g => g.id === sub.id), '外层园地列出小园地');
  check(!(await api('/garden/list', undefined, owner)).list.some(g => g.id === sub.id), '小园地不出现在私人园的列表里');
  check((await api(`/garden/view?id=${sub.id}`, undefined, stranger)).status === 404, '外层不公开，小园地路人也看不到');
  const deep = await api('/garden/save', { parent: sub.id, kind: 'dates', title: '第三层' }, owner);
  check(deep.id > 0, '能开第三层');
  check((await api('/garden/save', { parent: deep.id, kind: 'wish', title: '第四层' }, owner)).status === 400, '最多三层');
  check((await api('/garden/item', { garden: deep.id, title: '出发', date: '2024-07-01' }, friend)).id > 0, '一起写的人能往深层写');
  await api('/garden/save', { id: notes.id, title: '我们的书房', public: true }, owner);
  check((await api(`/garden/view?id=${deep.id}`)).garden.public === 1, '外层公开后小园地也公开');
  check((await api('/garden/save', { id: sub.id, title: '欧洲之旅' }, friend)).id === sub.id, '一起写的人能改小园地的名字');
  check((await api('/garden/delete', { id: deep.id }, friend)).status === 403, '一起写的人不能删别人开的小园地');
  check((await api('/garden/delete', { id: sub.id }, friend)).ok, '开小园地的人能删它，连里面的一起');
  check((await api(`/garden/view?id=${deep.id}`, undefined, owner)).status === 404, '里面的小园地也删掉了');
  const sub2 = await api('/garden/save', { parent: notes.id, kind: 'wish', title: '再开一块' }, owner);
  check((await api('/garden/delete', { id: notes.id }, owner)).ok, '主人删外层园地');
  check((await api(`/garden/view?id=${sub2.id}`, undefined, owner)).status === 404, '删外层会连小园地一起删');

  await api('/garden/invite', { id: wish.id, name: friendName }, owner);
  await api('/garden/answer', { id: wish.id, accept: true }, friend);
  const left = await api('/garden/item', { garden: wish.id, title: '注销前写的' }, friend);
  await api('/delete', {}, friend);
  check(!(await api(`/garden/view?id=${wish.id}`, undefined, owner)).items.some(i => i.id === left.id), '注销账号会删掉在别人园地写的');
  await api('/delete', {}, owner);
  check((await api(`/garden/view?id=${wish.id}`)).status === 404, '注销账号会删掉自己的园地');
  await api('/delete', {}, stranger);
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
