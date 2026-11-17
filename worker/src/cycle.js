// 私人园的「经期记录」园地。为了隐私：只能开在最外面一层（不放进别人能看的园地里）、永远不公开、不能邀请别人、
// 不能开小园地，记录只有主人自己看得到。预测和统计在 server/cycle.js（网页也用同一份）。
//   POST /api/garden/cycle/day {garden, date, flow, symptoms, note}   记一天；全空就删掉这一天
//   POST /api/garden/cycle/remind {garden, days}                      预计开始前几天发邮件，days 是列表，空的就不提醒
// 园地页 GET /api/garden/view 会带上 cycle: { days, remind }（只给主人）。
import cycleModule from '../../server/cycle.js';
import { ApiError, overLimit } from './accounts.js';
import { openGarden } from './garden.js';
import { beijingToday } from './dates.js';

const Cycle = cycleModule;
const NOTE_MAX = 200;
const DAYS_MAX = 4000; // 十年多
const REMIND_MAX = 10;
const MAIL_PER_DAY = 90;
const DAY = 86400000;
const SITE = 'https://yuanens.com';

async function ownCycle(env, id, user) {
  const { garden, role } = await openGarden(env, id, user);
  if (garden.kind !== 'cycle') throw new ApiError(400, '这块园地不是经期记录');
  if (role !== 'owner') throw new ApiError(404, '这块园地不存在');
  return garden;
}

// 园地页用：主人才拿得到记录
export async function cycleData(env, garden, role) {
  if (garden.kind !== 'cycle' || role !== 'owner') return null;
  const [days, remind] = await Promise.all([
    env.DB.prepare('SELECT date, flow, symptoms, note FROM cycle_days WHERE garden_id = ? ORDER BY date DESC LIMIT ?').bind(garden.id, DAYS_MAX).all(),
    env.DB.prepare('SELECT days FROM cycle_reminders WHERE garden_id = ? ORDER BY days').bind(garden.id).all(),
  ]);
  return {
    days: days.results.reverse().map(d => ({ ...d, symptoms: d.symptoms ? d.symptoms.split(',') : [] })),
    remind: remind.results.map(r => r.days),
  };
}

async function saveDay(env, body, user) {
  const garden = await ownCycle(env, body.garden, user);
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Cycle.addDays(date, 0) !== date) throw new ApiError(400, '日期不对');
  if (date > Cycle.addDays(beijingToday(), 1)) throw new ApiError(400, '还没到的日子不能记');
  const flow = Number(body.flow) || 0;
  if (![0, 1, 2, 3].includes(flow)) throw new ApiError(400, '流量不对');
  const symptoms = [...new Set([].concat(body.symptoms || []).map(String))];
  if (symptoms.some(s => !Cycle.SYMPTOMS[s])) throw new ApiError(400, '不认识的症状');
  const note = String(body.note || '').replace(/\s+/g, ' ').trim();
  if ([...note].length > NOTE_MAX) throw new ApiError(400, `一句话最多 ${NOTE_MAX} 个字`);
  if (!flow && !symptoms.length && !note) {
    await env.DB.prepare('DELETE FROM cycle_days WHERE garden_id = ? AND date = ?').bind(garden.id, date).run();
    return { removed: true };
  }
  await env.DB.prepare(
    `INSERT INTO cycle_days (garden_id, date, flow, symptoms, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (garden_id, date) DO UPDATE SET flow = excluded.flow, symptoms = excluded.symptoms, note = excluded.note,
       updated_at = excluded.updated_at`
  ).bind(garden.id, date, flow, symptoms.join(','), note, Date.now()).run();
  return { day: { date, flow, symptoms, note } };
}

async function setRemind(env, body, user) {
  const garden = await ownCycle(env, body.garden, user);
  if (!user.email) throw new ApiError(403, '要用邮箱或 Google 登录，才能收到邮件提醒');
  const raw = body.days === null || body.days === undefined || body.days === '' ? [] : [].concat(body.days);
  const days = [...new Set(raw.map(Number))].sort((a, b) => a - b);
  if (days.some(d => !Number.isInteger(d) || d < 0 || d > REMIND_MAX)) throw new ApiError(400, `提前 0 到 ${REMIND_MAX} 天`);
  const keep = days.length ? `AND days NOT IN (${days.map(() => '?').join(', ')})` : '';
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM cycle_reminders WHERE garden_id = ? ${keep}`).bind(garden.id, ...days),
    ...days.map(d => env.DB.prepare('INSERT OR IGNORE INTO cycle_reminders (garden_id, days) VALUES (?, ?)').bind(garden.id, d)),
  ]);
  return { remind: days };
}

export async function cycleRoute(env, key, body, user) {
  switch (key) {
    case 'POST /api/garden/cycle/day':
      return saveDay(env, body, user);
    case 'POST /api/garden/cycle/remind':
      return setRemind(env, body, user);
  }
  throw new ApiError(404, '接口不存在');
}

const cnDate = iso => {
  const [, m, d] = iso.split('-').map(Number);
  return `${m} 月 ${d} 日`;
};

// 提醒信：标题写得含蓄一点（手机锁屏上会显示标题）
export function cycleMail(name, next, today, gardenId) {
  const left = Cycle.dayNumber(next) - Cycle.dayNumber(today);
  // 「预计今天」「预计明天」「预计 3 天后」
  const when = left === 0 ? '今天' : left === 1 ? '明天' : ` ${left} 天后`;
  const weekday = '日一二三四五六'[new Date(`${next}T00:00:00Z`).getUTCDay()];
  return {
    subject: `周期小提醒：预计${when}`,
    text: [
      `${name}，你好：`,
      '',
      `根据你在生活园里的记录，下次月经预计${when}（${cnDate(next)}，星期${weekday}）左右开始。`,
      '记得备好用品，注意保暖，好好照顾自己。',
      '',
      '预测只是按过去几次的平均周期估算的，提前或推迟几天都很常见。',
      '',
      `打开记录：${SITE}/life/garden/?id=${gardenId}`,
      '不想再收到，打开上面的链接，在提醒设置里取消勾选就行。',
    ].join('\n'),
  };
}

// 每天跑一次（和纪念日提醒一起，见 dates.js 的 runReminders）
export async function runCycleReminders(env, today, send, budget) {
  const { results } = await env.DB.prepare(
    `SELECT r.garden_id, r.days, r.last_sent, u.email, u.name FROM cycle_reminders r
     JOIN gardens g ON g.id = r.garden_id JOIN users u ON u.id = g.owner_id
     WHERE g.kind = 'cycle' AND u.email IS NOT NULL LIMIT 5000`
  ).all();
  const groups = new Map();
  for (const row of results) {
    if (!groups.has(row.garden_id)) groups.set(row.garden_id, []);
    groups.get(row.garden_id).push(row);
  }
  const sent = [];
  for (const [gardenId, rows] of groups) {
    if (sent.length >= budget) break;
    const { results: days } = await env.DB.prepare('SELECT date, flow FROM cycle_days WHERE garden_id = ? AND flow > 0 ORDER BY date DESC LIMIT 200')
      .bind(gardenId).all();
    const prediction = Cycle.predict(days.reverse(), today, 1);
    // 正在经期里、或者已经过了预计日子（推迟了），都不提醒
    if (!prediction || prediction.inPeriod || prediction.late) continue;
    const left = prediction.daysToNext;
    const due = rows.filter(r => r.last_sent !== prediction.next && left >= 0 && left <= r.days);
    if (!due.length) continue;
    if (await overLimit(env, 'mail:all', MAIL_PER_DAY, DAY)) break;
    const mail = cycleMail(rows[0].name, prediction.next, today, gardenId);
    try {
      await send(rows[0].email, mail);
    } catch (err) {
      console.error(err);
      continue;
    }
    await env.DB.batch(due.map(r => env.DB.prepare('UPDATE cycle_reminders SET last_sent = ? WHERE garden_id = ? AND days = ?')
      .bind(prediction.next, gardenId, r.days)));
    sent.push({ garden: gardenId, date: prediction.next, subject: mail.subject });
  }
  return sent;
}
