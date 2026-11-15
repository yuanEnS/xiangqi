// 纪念日、生日和邮件提醒自测，要先启动本地 Worker：cd worker && npm run dev
// 农历换算的单元测试也在这里（server/lunar.js，不用 Worker）
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const Lunar = require('./lunar.js');
const HOST = process.env.SERVER_HOST || '127.0.0.1:8787';
const API = `http://${HOST}/api`;

function check(cond, label) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) process.exitCode = 1;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

// ---------- 农历 ----------
check(Lunar.toSolar(2026, 1, 1) === '2026-02-17', '2026 年春节是 2 月 17 日');
check(Lunar.toSolar(2026, 8, 15) === '2026-09-25', '2026 年中秋是 9 月 25 日');
check(Lunar.toSolar(2025, 6, 1, true) === '2025-07-25' && Lunar.toSolar(2026, 6, 1, true) === null, '2025 有闰六月，2026 没有');
check(Lunar.toSolar(2033, 11, 1, true) === '2033-12-22', '2033 年闰十一月');
check(Lunar.name({ month: 4, day: 1, leap: true }) === '闰四月初一' && Lunar.name({ month: 12, day: 30 }) === '腊月三十', '农历月日的中文');
check(same(Lunar.next({ date: '1990-10-03', lunar: true }, '2026-11-15'), { date: '2027-09-15', years: 37 }), '农历八月十五的生日，今年过了算明年');
check(same(Lunar.next({ date: '2000-02-29' }, '2026-11-15'), { date: '2027-03-01', years: 27 }), '阳历 2 月 29 日平年算 3 月 1 日');
const leapBorn = Lunar.toSolar(2023, 2, 10, true);
const leapNext = Lunar.next({ date: leapBorn, lunar: true }, '2026-01-01');
check(leapNext && Lunar.toLunar(leapNext.date).month === 2 && !Lunar.toLunar(leapNext.date).leap, '闰月出生，没有闰月的年份过平常那个月');
const site = path.join(__dirname, '..', '..', 'yuanEnS.github.io', 'life', 'lunar.js');
if (fs.existsSync(site)) {
  check(fs.readFileSync(site, 'utf8') === fs.readFileSync(path.join(__dirname, 'lunar.js'), 'utf8'), '网站上的 lunar.js 和服务器一致（不一致就运行 node tools/copy-rules.js）');
}

// ---------- 接口 ----------
(async () => {
  const stamp = Date.now();
  const owner = await signIn(`d1${stamp}@test.local`);
  const friend = await signIn(`d2${stamp}@test.local`);
  const stranger = await signIn(`d3${stamp}@test.local`);
  const name = async token => (await api('/me', undefined, token)).user.name;
  const friendName = await name(friend);

  const garden = await api('/garden/save', { kind: 'dates', title: '家里的日子', intro: '', public: false }, owner);
  check(garden.id > 0, '开一块纪念日园地');
  const G = garden.id;
  // 妈妈农历八月十五生日（1966 年中秋是阳历 9 月 29 日）
  const momDate = Lunar.toSolar(1966, 8, 15);
  const mom = await api('/garden/item', { garden: G, title: '妈妈', date: momDate, date_type: 'birthday', lunar: true }, owner);
  const wedding = await api('/garden/item', { garden: G, title: '结婚纪念日', date: '2020-05-20' }, owner);
  check(mom.id > 0 && wedding.id > 0, '记一个农历生日、一个阳历纪念日');
  const view = await api(`/garden/view?id=${G}`, undefined, owner);
  const momRow = view.items.find(i => i.id === mom.id);
  check(momRow.date_type === 'birthday' && momRow.lunar === 1 && momRow.remind === null, '生日、农历都存下了，还没设提醒');
  check(view.items.find(i => i.id === wedding.id).date_type === 'anniversary', '没说是什么的算纪念日');

  check((await api('/garden/remind', { item: mom.id, days: 3 })).status === 401, '没登录不能设提醒');
  check((await api('/garden/remind', { item: mom.id, days: 3 }, stranger)).status === 404, '别人的私人园地看不到，也设不了提醒');
  check((await api('/garden/remind', { item: mom.id, days: 99 }, owner)).status === 400, '提前太多天被拒绝');
  check((await api('/garden/remind', { item: mom.id, days: [61] }, owner)).status === 400, '提前太多天被拒绝（列表里的也算）');
  check(same((await api('/garden/remind', { item: mom.id, days: [3, 0, 3] }, owner)).remind, [0, 3]), '妈妈生日：当天和提前 3 天（多选，重复的去掉）');
  check(same((await api('/garden/remind', { item: wedding.id, days: 0 }, owner)).remind, [0]), '结婚纪念日当天提醒（单个数字也认）');
  check(same((await api(`/garden/view?id=${G}`, undefined, owner)).items.find(i => i.id === mom.id).remind, [0, 3]), '页面上看得到自己设的提醒');

  // 一起写的朋友也可以给自己设提醒
  await api('/garden/invite', { id: G, name: friendName }, owner);
  await api('/garden/answer', { id: G, accept: true }, friend);
  check(same((await api('/garden/remind', { item: mom.id, days: [1] }, friend)).remind, [1]), '一起写的人给自己设提前 1 天');
  check(same((await api(`/garden/view?id=${G}`, undefined, friend)).items.find(i => i.id === mom.id).remind, [1]), '各看各的提醒');

  // 跑提醒：2026 年中秋是 9 月 25 日
  const run = async today => (await (await fetch(`http://${HOST}/api/test/reminders`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ today }),
  })).json()).sent.filter(s => [mom.id, wedding.id].includes(s.item));
  check((await run('2026-09-21')).length === 0, '提前 4 天还不发');
  const first = await run('2026-09-22');
  check(first.length === 1 && first[0].date === '2026-09-25' && first[0].subject === '3 天后是妈妈的 60 岁生日', `提前 3 天发给主人：「${first[0] && first[0].subject}」`);
  check((await run('2026-09-22')).length === 0, '同一次不重复发');
  const second = await run('2026-09-24');
  check(second.length === 1 && second[0].subject === '明天是妈妈的 60 岁生日', '朋友提前 1 天收到');
  const third = await run('2026-09-25');
  check(third.length === 1 && third[0].subject === '今天是妈妈的 60 岁生日', '主人当天又收到一封（多选的第二个提醒日）');
  check((await run('2026-09-25')).length === 0, '当天的也只发一次');

  // 快到了才设提醒：提前 3 天、7 天都已经过了点，只发一封
  const dad = await api('/garden/item', { garden: G, title: '爸爸', date: '1964-10-03', date_type: 'birthday' }, owner);
  await api('/garden/remind', { item: dad.id, days: [3, 7] }, owner);
  const late = (await (await fetch(`http://${HOST}/api/test/reminders`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ today: '2026-10-01' }),
  })).json()).sent.filter(x => x.item === dad.id);
  check(late.length === 1 && late[0].subject === '后天是爸爸的 62 岁生日', `两个提醒日同一天到了，只发一封：「${late[0] && late[0].subject}」`);
  const anniversary = await run('2027-05-20');
  check(anniversary.length === 1 && anniversary[0].subject === '今天是「结婚纪念日」7 周年', `纪念日当天：「${anniversary[0] && anniversary[0].subject}」`);

  // 朋友被请出园地以后，不再给他发
  await api('/garden/remind', { item: mom.id, days: [30] }, friend);
  await api('/garden/remove', { id: G, name: friendName }, owner);
  check((await run('2027-09-01')).length === 0, '朋友设了提前 30 天，但被请出去了，收不到');
  const owners = await run('2027-09-12');
  check(owners.length === 1 && owners[0].date === '2027-09-15', '主人照常提前 3 天收到（2027 年的八月十五是 9 月 15 日）');
  check((await api('/garden/remind', { item: mom.id, days: [] }, owner)).remind === null, '一个都不选就是取消提醒');
  await api('/garden/item/delete', { id: wedding.id }, owner);
  execSync(`npx wrangler d1 execute gamesyuan --local --command "SELECT COUNT(*) AS n FROM date_reminders WHERE item_id = ${wedding.id}" --json > ${path.join(os.tmpdir(), 'dates-count.json')}`, { cwd: path.join(__dirname, '../worker'), stdio: 'ignore' });
  check(JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'dates-count.json'), 'utf8'))[0].results[0].n === 0, '删掉那一条，提醒也跟着删');
  await api('/garden/delete', { id: G }, owner);
})();
