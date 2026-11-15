// 纪念日和生日的邮件提醒。每个人可以给纪念日园地里的某一条设「提前几天」，每天北京时间早上 8 点（wrangler.toml 的 crons）
// 检查一遍：离下一次还有 0 到 days 天、这一次还没提醒过的，给他发一封邮件。农历的按农历算下一次是哪天（server/lunar.js）。
// 邮件用 Resend 发，和登录验证码共用每天的发信额度（mail:all），每次最多发 REMIND_PER_RUN 封，留给验证码一些余量。
import lunarModule from '../../server/lunar.js';
import { ApiError, overLimit } from './accounts.js';
import { openGarden } from './garden.js';

const Lunar = lunarModule;
const MAX_DAYS = 60;
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
  if (body.days === null || body.days === undefined || body.days === '') {
    await env.DB.prepare('DELETE FROM date_reminders WHERE user_id = ? AND item_id = ?').bind(user.id, item.id).run();
    return { remind: null };
  }
  const days = Number(body.days);
  if (!Number.isInteger(days) || days < 0 || days > MAX_DAYS) throw new ApiError(400, `提前 0 到 ${MAX_DAYS} 天`);
  await env.DB.prepare(
    `INSERT INTO date_reminders (user_id, item_id, days, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, item_id) DO UPDATE SET days = excluded.days`
  ).bind(user.id, item.id, days, Date.now()).run();
  return { remind: days };
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
  const sent = [];
  for (const row of results) {
    if (sent.length >= REMIND_PER_RUN) break;
    if (!Lunar.validIso(row.date)) continue;
    const occurrence = Lunar.next({ date: row.date, lunar: !!row.lunar }, today);
    if (!occurrence || row.last_sent === occurrence.date) continue;
    const left = Lunar.dayNumber(occurrence.date) - Lunar.dayNumber(today);
    if (left < 0 || left > row.days) continue;
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
    await env.DB.prepare('UPDATE date_reminders SET last_sent = ? WHERE user_id = ? AND item_id = ?')
      .bind(occurrence.date, row.user_id, row.item_id).run();
    sent.push({ item: row.item_id, user: row.user_id, date: occurrence.date, subject: mail.subject });
  }
  return sent;
}
