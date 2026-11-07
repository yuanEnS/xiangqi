// 私人园里的园地：心愿单、旅行地图、纪念日。主人可以邀请别的账号一起写。
// 园地默认只有主人和一起写的人能看，主人可以改成公开，公开的会出现在他的私人园里。
//   GET  /api/garden/list?author=昵称       某人公开的园地；不带 author 是自己的，含收到的邀请
//   GET  /api/garden/view?id=1              一块园地、一起写的人和全部条目
//   POST /api/garden/save {id?, kind, title, intro, public}
//   POST /api/garden/delete {id}
//   POST /api/garden/item {garden, id?, title, body, date, lat, lon, done}
//   POST /api/garden/item/delete {id}
//   POST /api/garden/invite {id, name}      主人按昵称邀请
//   POST /api/garden/answer {id, accept}    受邀的人答应或拒绝
//   POST /api/garden/remove {id, name?}     主人请人离开；不带 name 是自己退出
import { ApiError } from './accounts.js';
import { isAdmin, validDate } from './life.js';

export const KINDS = ['wish', 'travel', 'dates'];
const TITLE_MAX = 40;
const INTRO_MAX = 300;
const ITEM_TITLE_MAX = 100;
const ITEM_BODY_MAX = 5000;
const GARDENS_MAX = 20; // 每人最多开几块园地
const MEMBERS_MAX = 9; // 除了主人，最多几人一起写（含没答应的）
const ITEMS_MAX = 300;

const SUMMARY = `g.id, g.kind, g.title, g.public, u.name AS owner,
  (SELECT COUNT(*) FROM garden_items WHERE garden_id = g.id) AS items,
  (SELECT COUNT(*) FROM garden_members WHERE garden_id = g.id AND joined = 1) AS members`;
const WITH_OWNER = 'FROM gardens g JOIN users u ON u.id = g.owner_id';

function text(value, max, label, required = false) {
  const result = String(value ?? '').trim();
  if (required && !result) throw new ApiError(400, `${label}不能为空`);
  if ([...result].length > max) throw new ApiError(400, `${label}最多 ${max} 个字`);
  return result;
}

// 我在这块园地里的身份：owner 主人、member 一起写、invited 收到邀请还没答应、none 路人
async function open(env, id, user) {
  const garden = await env.DB.prepare(`SELECT g.*, u.name AS owner ${WITH_OWNER} WHERE g.id = ?`).bind(Number(id) || 0).first();
  if (!garden) throw new ApiError(404, '这块园地不存在');
  let role = 'none';
  if (user && garden.owner_id === user.id) role = 'owner';
  else if (user) {
    const member = await env.DB.prepare('SELECT joined FROM garden_members WHERE garden_id = ? AND user_id = ?')
      .bind(garden.id, user.id).first();
    if (member) role = member.joined ? 'member' : 'invited';
  }
  if (role === 'none' && !garden.public) throw new ApiError(404, '这块园地不存在');
  return { garden, role };
}

function needWriter(role) {
  if (role !== 'owner' && role !== 'member') throw new ApiError(403, '只有一起写的人才能改');
}

function needOwner(role) {
  if (role !== 'owner') throw new ApiError(403, '只有园地的主人能这样做');
}

async function touch(env, id) {
  await env.DB.prepare('UPDATE gardens SET updated_at = ? WHERE id = ?').bind(Date.now(), id).run();
}

async function list(env, user, author) {
  if (author) {
    const { results } = await env.DB.prepare(
      `SELECT ${SUMMARY} ${WITH_OWNER} WHERE u.name = ? AND g.public = 1 ORDER BY g.updated_at DESC`
    ).bind(author).all();
    return { list: results };
  }
  const [mine, invites] = await Promise.all([
    env.DB.prepare(
      `SELECT ${SUMMARY}, g.owner_id = ?1 AS owned ${WITH_OWNER}
       WHERE g.owner_id = ?1 OR g.id IN (SELECT garden_id FROM garden_members WHERE user_id = ?1 AND joined = 1)
       ORDER BY g.updated_at DESC`
    ).bind(user.id).all(),
    env.DB.prepare(
      `SELECT ${SUMMARY} ${WITH_OWNER}
       WHERE g.id IN (SELECT garden_id FROM garden_members WHERE user_id = ? AND joined = 0)
       ORDER BY g.updated_at DESC`
    ).bind(user.id).all(),
  ]);
  return { list: mine.results, invites: invites.results };
}

async function view(env, id, user) {
  const { garden, role } = await open(env, id, user);
  const insider = role !== 'none';
  const [members, items] = await Promise.all([
    env.DB.prepare(
      `SELECT u.name, m.joined FROM garden_members m JOIN users u ON u.id = m.user_id
       WHERE m.garden_id = ? ${insider ? '' : 'AND m.joined = 1'} ORDER BY m.created_at`
    ).bind(garden.id).all(),
    env.DB.prepare(
      `SELECT i.id, i.title, i.body, i.date, i.lat, i.lon, i.done, i.updated_at,
         COALESCE(u.name, '') AS author, i.author_id = ? AS mine
       FROM garden_items i LEFT JOIN users u ON u.id = i.author_id
       WHERE i.garden_id = ? ORDER BY i.date, i.id LIMIT ?`
    ).bind(user ? user.id : -1, garden.id, ITEMS_MAX).all(),
  ]);
  return {
    garden: {
      id: garden.id, kind: garden.kind, title: garden.title, intro: garden.intro,
      public: garden.public, owner: garden.owner, role,
    },
    members: members.results,
    items: items.results,
  };
}

async function save(env, body, user) {
  const title = text(body.title, TITLE_MAX, '名字', true);
  const intro = text(body.intro, INTRO_MAX, '介绍');
  const pub = body.public ? 1 : 0;
  const now = Date.now();
  if (body.id) {
    const { garden, role } = await open(env, body.id, user);
    needOwner(role);
    await env.DB.prepare('UPDATE gardens SET title = ?, intro = ?, public = ?, updated_at = ? WHERE id = ?')
      .bind(title, intro, pub, now, garden.id).run();
    return { id: garden.id };
  }
  if (!KINDS.includes(body.kind)) throw new ApiError(400, '不认识的园地种类');
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM gardens WHERE owner_id = ?').bind(user.id).first();
  if (n >= GARDENS_MAX) throw new ApiError(400, `每人最多开 ${GARDENS_MAX} 块园地`);
  const row = await env.DB.prepare(
    'INSERT INTO gardens (owner_id, kind, title, intro, public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id'
  ).bind(user.id, body.kind, title, intro, pub, now, now).first();
  return { id: row.id };
}

export function deleteGardens(env, where, value) {
  const ids = `SELECT id FROM gardens WHERE ${where}`;
  return [
    env.DB.prepare(`DELETE FROM garden_items WHERE garden_id IN (${ids})`).bind(value),
    env.DB.prepare(`DELETE FROM garden_members WHERE garden_id IN (${ids})`).bind(value),
    env.DB.prepare(`DELETE FROM gardens WHERE ${where}`).bind(value),
  ];
}

async function remove(env, id, user) {
  const { garden, role } = await open(env, id, user);
  // 园主可以删掉公开的、不合适的园地
  if (role !== 'owner' && !(garden.public && await isAdmin(env, user))) needOwner(role);
  await env.DB.batch(deleteGardens(env, 'id = ?', garden.id));
  return { ok: true };
}

async function saveItem(env, body, user) {
  const { garden, role } = await open(env, body.garden, user);
  needWriter(role);
  const title = text(body.title, ITEM_TITLE_MAX, '标题', true);
  const note = text(body.body, ITEM_BODY_MAX, '内容');
  const date = String(body.date || '');
  if (date && !validDate(date)) throw new ApiError(400, '日期不对');
  if (garden.kind === 'dates' && !date) throw new ApiError(400, '纪念日要填日期');
  let lat = null, lon = null;
  if (garden.kind === 'travel') {
    lat = Number(body.lat);
    lon = Number(body.lon);
    if (body.lat === null || body.lat === undefined || !(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) {
      throw new ApiError(400, '在地图上点一下，选出这个地方');
    }
    lat = Math.round(lat * 100) / 100;
    lon = Math.round(lon * 100) / 100;
  }
  const done = garden.kind === 'wish' && body.done ? 1 : 0;
  const now = Date.now();

  let row;
  if (body.id) {
    row = await env.DB.prepare(
      `UPDATE garden_items SET title = ?, body = ?, date = ?, lat = ?, lon = ?, done = ?, updated_at = ?
       WHERE id = ? AND garden_id = ? RETURNING id`
    ).bind(title, note, date, lat, lon, done, now, body.id, garden.id).first();
    if (!row) throw new ApiError(404, '这一条不存在');
  } else {
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM garden_items WHERE garden_id = ?').bind(garden.id).first();
    if (n >= ITEMS_MAX) throw new ApiError(400, `一块园地最多 ${ITEMS_MAX} 条`);
    row = await env.DB.prepare(
      `INSERT INTO garden_items (garden_id, author_id, title, body, date, lat, lon, done, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    ).bind(garden.id, user.id, title, note, date, lat, lon, done, now, now).first();
  }
  await touch(env, garden.id);
  return { id: row.id };
}

async function removeItem(env, id, user) {
  const item = await env.DB.prepare('SELECT garden_id, author_id FROM garden_items WHERE id = ?').bind(Number(id) || 0).first();
  if (!item) return { ok: true };
  const { role } = await open(env, item.garden_id, user);
  needWriter(role);
  // 一起写的人能改任何一条，但只能删自己写的；主人都能删
  if (role !== 'owner' && item.author_id !== user.id) throw new ApiError(403, '只能删自己写的，或者请主人删');
  await env.DB.prepare('DELETE FROM garden_items WHERE id = ?').bind(id).run();
  await touch(env, item.garden_id);
  return { ok: true };
}

async function invite(env, body, user) {
  const { garden, role } = await open(env, body.id, user);
  needOwner(role);
  const name = String(body.name || '').trim();
  const guest = await env.DB.prepare('SELECT id, email FROM users WHERE name = ?').bind(name).first();
  if (!guest) throw new ApiError(404, '没有这个昵称的账号');
  if (guest.id === user.id) throw new ApiError(400, '不用邀请自己');
  if (!guest.email) throw new ApiError(400, '对方是游客账号，要先用邮箱或 Google 登录');
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM garden_members WHERE garden_id = ?').bind(garden.id).first();
  if (n >= MEMBERS_MAX) throw new ApiError(400, `最多邀请 ${MEMBERS_MAX} 人一起写`);
  await env.DB.prepare('INSERT OR IGNORE INTO garden_members (garden_id, user_id, joined, created_at) VALUES (?, ?, 0, ?)')
    .bind(garden.id, guest.id, Date.now()).run();
  return { ok: true };
}

async function answer(env, body, user) {
  const { garden, role } = await open(env, body.id, user);
  if (role !== 'invited') throw new ApiError(400, '没有这个邀请');
  if (body.accept) {
    await env.DB.prepare('UPDATE garden_members SET joined = 1 WHERE garden_id = ? AND user_id = ?').bind(garden.id, user.id).run();
  } else {
    await env.DB.prepare('DELETE FROM garden_members WHERE garden_id = ? AND user_id = ?').bind(garden.id, user.id).run();
  }
  return { ok: true };
}

async function removeMember(env, body, user) {
  const { garden, role } = await open(env, body.id, user);
  if (!body.name || body.name === user.name) {
    if (role === 'owner') throw new ApiError(400, '主人不能退出，可以删掉整块园地');
    if (role === 'none') throw new ApiError(400, '你不在这块园地里');
    await env.DB.prepare('DELETE FROM garden_members WHERE garden_id = ? AND user_id = ?').bind(garden.id, user.id).run();
    return { ok: true };
  }
  needOwner(role);
  await env.DB.prepare(
    'DELETE FROM garden_members WHERE garden_id = ? AND user_id = (SELECT id FROM users WHERE name = ?)'
  ).bind(garden.id, String(body.name)).run();
  return { ok: true };
}

export async function gardenRoute(env, key, url, body, user) {
  const writer = () => {
    if (!user) throw new ApiError(401, '请先登录');
    if (!user.email) throw new ApiError(403, '游客账号没有私人园，请用邮箱或 Google 登录');
  };
  switch (key) {
    case 'GET /api/garden/list': {
      const author = url.searchParams.get('author');
      if (!author) writer();
      return list(env, user, author);
    }
    case 'GET /api/garden/view':
      return view(env, url.searchParams.get('id'), user);
  }
  writer();
  switch (key) {
    case 'POST /api/garden/save':
      return save(env, body, user);
    case 'POST /api/garden/delete':
      return remove(env, body.id, user);
    case 'POST /api/garden/item':
      return saveItem(env, body, user);
    case 'POST /api/garden/item/delete':
      return removeItem(env, body.id, user);
    case 'POST /api/garden/invite':
      return invite(env, body, user);
    case 'POST /api/garden/answer':
      return answer(env, body, user);
    case 'POST /api/garden/remove':
      return removeMember(env, body, user);
  }
  throw new ApiError(404, '接口不存在');
}
