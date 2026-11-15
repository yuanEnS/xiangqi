// 纪念日和生日的邮件提醒。每个人可以给纪念日园地里的某一条设几个提醒日（当天、提前 3 天、提前 7 天……可以多选），
// 每天北京时间早上 8 点（wrangler.toml 的 crons）检查一遍：某个提醒日到了（离下一次还有 0 到 days 天）、这一次还没提醒过，
// 就给他发一封邮件。同一天有几个提醒日一起到了（比如快到了才设），只发一封。农历的按农历算下一次是哪天（server/lunar.js）。
// 邮件用 Resend 发，和登录验证码共用每天的发信额度（mail:all），每次最多发 REMIND_PER_RUN 封，留给验证码一些余量。
import lunarModule from '../../server/lunar.js';
import { ApiError, overLimit } from './accounts.js';
import { openGarden } from './garden.js';
import { runCycleReminders } from './cycle.js';

const Lunar = lunarModule;
const MAX_DAYS = 60;
const MAX_CHOICES = 8;
const REMIND_PER_RUN = 60;
const MAIL_PER_DAY = 90;
const DAY = 86400000;
const SITE = 'https://gamesyuan.com';

// 北京时间的今天
export function beijingToday() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

export async function setReminder(env, body, user) {
  if (!user.email) throw new ApiError(403, '要用邮箱或 Google 登录，才能收到邮件提醒');
  const item = await env.DB.prepare(
    `SELECT i.id, i.garden_id, g.kind FROM garden_items i JOIN gardens g ON g.id = i.garden_id WHERE i.id = ?`
  ).bind(Number(body.item) || 0).first();
  if (!item || item.kind !== 'dates') throw new ApiError(404, '这一条不存在');
  const { role } = await openGarden(env, item.garden_id, user);
  if (!['owner', 'member'].includes(role)) throw new ApiError(403, '只有园地的主人和一起写的人能设提醒');
  // days 是提醒日的列表，比如 [0, 3, 7]；空的就是不提醒。也认单个数字
  const raw = body.days === null || body.days === undefined || body.days === '' ? [] : [].concat(body.days);
  const days = [...new Set(raw.map(Number))].sort((a, b) => a - b);
  if (days.some(d => !Number.isInteger(d) || d < 0 || d > MAX_DAYS)) throw new ApiError(400, `提前 0 到 ${MAX_DAYS} 天`);
  if (days.length > MAX_CHOICES) throw new ApiError(400, `最多设 ${MAX_CHOICES} 个提醒`);
  const keep = days.length ? `AND days NOT IN (${days.map(() => '?').join(', ')})` : '';
  await env.DB.batch([
    // 去掉的提醒日删掉，新加的插进去，原来就有的不动（保留「已经提醒过」的记录）
    env.DB.prepare(`DELETE FROM date_reminders WHERE user_id = ? AND item_id = ? ${keep}`).bind(user.id, item.id, ...days),
    ...days.map(d => env.DB.prepare(
      'INSERT OR IGNORE INTO date_reminders (user_id, item_id, days, created_at) VALUES (?, ?, ?, ?)'
    ).bind(user.id, item.id, d, Date.now())),
  ]);
  return { remind: days.length ? days : null };
}

const cnDate = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y} 年 ${m} 月 ${d} 日`;
};
const weekday = iso => '日一二三四五六'[new Date(`${iso}T00:00:00Z`).getUTCDay()];

// 一封提醒信的标题和正文
export function reminderMail(row, occurrence, today) {
  const left = Lunar.dayNumber(occurrence.date) - Lunar.dayNumber(today);
  const when = left === 0 ? '今天' : left === 1 ? '明天' : left === 2 ? '后天' : `${left} 天后`;
  const birthday = row.date_type === 'birthday';
  const lunarText = row.lunar ? `（农历${Lunar.name(Lunar.toLunar(row.date))}）` : '';
  let what;
  if (birthday) what = occurrence.years > 0 ? `${row.title}的 ${occurrence.years} 岁生日` : `${row.title}的生日`;
  else what = occurrence.years > 0 ? `「${row.title}」${occurrence.years} 周年` : `「${row.title}」`;
  const subject = `${when}是${what}`;
  const text = [
    `${row.name}，你好：`,
    '',
    `${when}（${cnDate(occurrence.date)}，星期${weekday(occurrence.date)}）是${what}${lunarText}。`,
    '',
    `在生活园里看：${SITE}/life/garden/?id=${row.garden_id}`,
    '',
    '这封邮件是你自己在 gamesyuan 生活园的纪念日里设的提醒。不想再收到，打开上面的链接，把这一条的提醒改成「不提醒」就行。',
  ].join('\n');
  return { subject, text };
}

async function sendMail(env, to, { subject, text }) {
  if (env.EMAIL_TEST_MODE === '1') return; // 本地测试不真的发信
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject: `[生活园] ${subject}`, text }),
  });
  if (!res.ok) throw new Error(`发送提醒失败 ${res.status} ${await res.text()}`);
}

// 每天跑一次。today 是北京时间的日期（测试时可以指定）。返回发了哪些
export async function runReminders(env, today = beijingToday()) {
  if (!env.RESEND_API_KEY && env.EMAIL_TEST_MODE !== '1') return [];
  const { results } = await env.DB.prepare(
    `SELECT r.user_id, r.item_id, r.days, r.last_sent, i.title, i.date, i.date_type, i.lunar, i.garden_id, u.email, u.name
     FROM date_reminders r JOIN garden_items i ON i.id = r.item_id JOIN users u ON u.id = r.user_id
     WHERE u.email IS NOT NULL LIMIT 5000`
  ).all();
  // 同一个人、同一条的几个提醒日放在一起看：今天到了的（还没提醒过这一次的）合成一封
  const groups = new Map();
  for (const row of results) {
    const key = `${row.user_id}:${row.item_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const sent = [];
  for (const rows of groups.values()) {
    if (sent.length >= REMIND_PER_RUN) break;
    const row = rows[0];
    if (!Lunar.validIso(row.date)) continue;
    const occurrence = Lunar.next({ date: row.date, lunar: !!row.lunar }, today);
    if (!occurrence) continue;
    const left = Lunar.dayNumber(occurrence.date) - Lunar.dayNumber(today);
    const due = rows.filter(r => r.last_sent !== occurrence.date && left >= 0 && left <= r.days);
    if (!due.length) continue;
    // 发信前再看一次：他还是不是这块园地的主人或一起写的人（被请出去了就删掉提醒）
    let role = 'none';
    try {
      role = (await openGarden(env, row.garden_id, { id: row.user_id, email: row.email })).role;
    } catch (e) { /* 园地没了 */ }
    if (!['owner', 'member'].includes(role)) {
      await env.DB.prepare('DELETE FROM date_reminders WHERE user_id = ? AND item_id = ?').bind(row.user_id, row.item_id).run();
      continue;
    }
    if (await overLimit(env, 'mail:all', MAIL_PER_DAY, DAY)) break;
    const mail = reminderMail(row, occurrence, today);
    try {
      await sendMail(env, row.email, mail);
    } catch (err) {
      console.error(err);
      continue;
    }
    await env.DB.batch(due.map(r => env.DB.prepare('UPDATE date_reminders SET last_sent = ? WHERE user_id = ? AND item_id = ? AND days = ?')
      .bind(occurrence.date, r.user_id, r.item_id, r.days)));
    sent.push({ item: row.item_id, user: row.user_id, date: occurrence.date, subject: mail.subject });
  }
  // 经期记录的提醒（cycle.js），和纪念日一起算每天的发信额度
  const cycle = await runCycleReminders(env, today, (to, mail) => sendMail(env, to, mail), REMIND_PER_RUN - sent.length);
  return [...sent, ...cycle];
}
