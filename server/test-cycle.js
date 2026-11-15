// 经期记录自测：预测（server/cycle.js）和接口、隐私、邮件提醒。接口部分要先启动本地 Worker：cd worker && npm run dev
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const Cycle = require('./cycle.js');
const HOST = process.env.SERVER_HOST || '127.0.0.1:8787';
const API = `http://${HOST}/api`;

function check(cond, label) {
  console.log((cond ? '✓ ' : '✗ ') + label);
  if (!cond) process.exitCode = 1;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const log = (start, len, flow = 2) => Array.from({ length: len }, (_, i) => ({ date: Cycle.addDays(start, i), flow }));

// ---------- 预测 ----------
const history = [...log('2026-07-01', 5), ...log('2026-07-30', 4), ...log('2026-08-28', 5), ...log('2026-09-27', 5)];
const p = Cycle.predict(history, '2026-10-15');
check(p.cycle === 29 && p.period === 5 && p.next === '2026-10-26', '平均周期 29 天、经期 5 天，下次 10 月 26 日');
check(p.upcoming[0].ovulation === '2026-10-12' && p.upcoming[0].fertileStart === '2026-10-07', '排卵日按下次前 14 天估');
check(Cycle.predict(history, '2026-10-30').late === 4, '过了 4 天还没来：推迟 4 天');
check(Cycle.predict(history, '2026-09-29').dayOfPeriod === 3, '经期第 3 天');
check(Cycle.periods([...log('2026-10-01', 2), { date: '2026-10-04', flow: 1 }]).length === 1, '中间漏记一天算同一次');
check(Cycle.predict(log('2026-10-01', 6), '2026-10-10').guessed, '只记了一次时周期按 28 天估');
const site = path.join(__dirname, '..', '..', 'yuanEnS.github.io', 'life', 'cycle.js');
if (fs.existsSync(site)) check(fs.readFileSync(site, 'utf8') === fs.readFileSync(path.join(__dirname, 'cycle.js'), 'utf8'), '网站上的 cycle.js 和服务器一致');

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
const run = async today => (await (await fetch(`http://${HOST}/api/test/reminders`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ today }),
})).json()).sent;
function count(table, gardenId) {
  const file = path.join(os.tmpdir(), 'cycle-count.json');
  execSync(`npx wrangler d1 execute gamesyuan --local --command "SELECT COUNT(*) AS n FROM ${table} WHERE garden_id = ${gardenId}" --json > ${file}`,
    { cwd: path.join(__dirname, '../worker'), stdio: 'ignore' });
  return JSON.parse(fs.readFileSync(file, 'utf8'))[0].results[0].n;
}

// ---------- 接口 ----------
(async () => {
  const stamp = Date.now();
  const me = await signIn(`c1${stamp}@test.local`);
  const other = await signIn(`c2${stamp}@test.local`);
  const otherName = (await api('/me', undefined, other)).user.name;

  const g = await api('/garden/save', { kind: 'cycle', title: '我的周期', intro: '', public: true }, me);
  check(g.id > 0, '开一块经期记录');
  const G = g.id;
  let view = await api(`/garden/view?id=${G}`, undefined, me);
  check(view.garden.public === 0 && view.garden.canNest === false, '要求公开也不公开，里面不能开小园地');
  check(same(view.cycle, { days: [], remind: [] }), '主人看得到（还是空的）记录');
  check((await api(`/garden/view?id=${G}`, undefined, other)).status === 404, '别人打不开');
  check((await api(`/garden/view?id=${G}`)).status === 404, '没登录打不开');
  check((await api('/garden/save', { id: G, title: '我的周期', public: true }, me)).id === G
    && (await api(`/garden/view?id=${G}`, undefined, me)).garden.public === 0, '改设置也公开不了');
  check((await api('/garden/invite', { id: G, name: otherName }, me)).status === 400, '不能邀请别人');
  check((await api('/garden/save', { kind: 'notes', title: '小园地', parent: G }, me)).status === 400, '里面不能开小园地');
  const notes = await api('/garden/save', { kind: 'notes', title: '随笔', public: true }, me);
  check((await api('/garden/save', { kind: 'cycle', title: '周期', parent: notes.id }, me)).status === 400, '不能开在别的园地里');

  for (const d of history) await api('/garden/cycle/day', { garden: G, date: d.date, flow: d.flow }, me);
  const withNote = await api('/garden/cycle/day', { garden: G, date: '2026-09-28', flow: 3, symptoms: ['cramps', 'tired'], note: '肚子疼，喝了红糖水' }, me);
  check(same(withNote.day.symptoms, ['cramps', 'tired']), '记流量、症状和一句话');
  check((await api('/garden/cycle/day', { garden: G, date: '2026-09-28', flow: 5 }, me)).status === 400, '流量不对被拒绝');
  check((await api('/garden/cycle/day', { garden: G, date: '2026-09-28', flow: 1, symptoms: ['xyz'] }, me)).status === 400, '不认识的症状被拒绝');
  check((await api('/garden/cycle/day', { garden: G, date: '2099-01-01', flow: 1 }, me)).status === 400, '还没到的日子不能记');
  check((await api('/garden/cycle/day', { garden: G, date: '2026-09-28', flow: 1 }, other)).status === 404, '别人记不了');
  view = await api(`/garden/view?id=${G}`, undefined, me);
  check(view.cycle.days.length === history.length && view.cycle.days.find(d => d.date === '2026-09-28').note === '肚子疼，喝了红糖水', '记录都在');
  const cleared = await api('/garden/cycle/day', { garden: G, date: '2026-07-03', flow: 0, symptoms: [], note: '' }, me);
  check(cleared.removed, '全部清空就删掉那一天');
  await api('/garden/cycle/day', { garden: G, date: '2026-07-03', flow: 2 }, me);

  // 提醒：预计 10 月 26 日，提前 3 天和当天
  check(same((await api('/garden/cycle/remind', { garden: G, days: [3, 0] }, me)).remind, [0, 3]), '提前 3 天和当天提醒（多选）');
  check((await api('/garden/cycle/remind', { garden: G, days: [30] }, me)).status === 400, '提前太多天被拒绝');
  const mine = list => list.filter(s => s.garden === G);
  check(mine(await run('2026-10-22')).length === 0, '提前 4 天还不发');
  const first = mine(await run('2026-10-23'));
  check(first.length === 1 && first[0].subject === '周期小提醒：预计 3 天后' && first[0].date === '2026-10-26', `提前 3 天发：「${first[0] && first[0].subject}」`);
  check(mine(await run('2026-10-23')).length === 0, '同一次不重复发');
  check(mine(await run('2026-10-26'))[0].subject === '周期小提醒：预计今天', '当天再发一封');
  check(mine(await run('2026-10-28')).length === 0, '推迟了就不再发');
  await api('/garden/cycle/day', { garden: G, date: '2026-10-28', flow: 2 }, me);
  check(mine(await run('2026-10-29')).length === 0, '来了以后不提醒');

  // 删除整块园地，记录和提醒一起删
  await api('/garden/delete', { id: G }, me);
  check(count('cycle_days', G) === 0 && count('cycle_reminders', G) === 0, '删掉园地，记录和提醒都删了');
  // 注销账号也一起删
  const g2 = await api('/garden/save', { kind: 'cycle', title: '周期', public: false }, other);
  await api('/garden/cycle/day', { garden: g2.id, date: '2026-10-01', flow: 2 }, other);
  await api('/delete', {}, other);
  check(count('cycle_days', g2.id) === 0, '注销账号，经期记录也删了');
  await api('/garden/delete', { id: notes.id }, me);
})();
