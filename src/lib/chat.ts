import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, forbidden, notFound } from './errors';
import { loadTaskForUser, teamScope } from './access';
import { notify } from './notifications';
import { audit } from './log';
import { completeMultipart, downloadUrl, getObject, maxUploadBytes, objectSize, putObject, tooLargeMsg, uploadTargetFor } from './storage';
import type { SessionUser } from './types';
import { ALL_ID, POLL_MAX, POLL_MIN, QUICK_DEFAULT, REACTIONS, stickerOf, whenText } from './chatShared';

/**
 * V13 10번 사내 메신저. 방 종류: 1:1(dm) · 그룹(group) · 회사 전체(company, 자동) · 업무별(task).
 * - 회사(tenant)별로 분리. 체험 계정은 'demo' 회사로 따로.
 * - 접근: dm·group = 멤버만 / company = 같은 회사 직원 모두(자동 가입) / task = 그 업무를 볼 수 있는 사람(자동 가입).
 *   볼 수 없는 방은 404 (있는 줄도 모르게).
 */
import { tenantOf } from './types';
type Room = { id: string; tenant: string; kind: 'dm' | 'group' | 'company' | 'task' | 'team'; name: string | null; task_id: string | null; dm_key: string | null; team_id?: string | null; owner_id?: string | null; history_visible?: boolean;
  photo_key?: string | null; owner_only?: boolean };
/** 메신저 1차(10/20): 초대·나감·내보냄 같은 시스템 메시지 — 글쓴이 없음, 알림 없음 */
async function systemMessage(sql: Sql, roomId: string, text: string) {
  const [m] = await sql<{ id: string }[]>`insert into chat_messages (room_id, author_id, body, kind) values (${roomId}, null, ${text}, 'system') returning id::text`;
  await sql`update chat_rooms set last_message_at = now() where id = ${roomId}`;
  return m.id;
}
/** 방장(만든 사람)·대표·관리자만 방을 관리(내보내기·이전 대화 공개) */
const canManage = (u: SessionUser, r: Room) => r.owner_id === u.id || u.role === 'owner' || u.role === 'admin';
/** 메신저 3차 D14: 그룹 대화에서 방장이 '방장만 관리'를 켜면 방 이름·사진·초대·공지는 방장·대표·관리자만(끄면 참여자 누구나) */
const canEdit = (u: SessionUser, r: Room) => r.kind !== 'group' || !r.owner_only || canManage(u, r);
/** 방 사진: 그룹 대화(위 규칙) · 회사 전체방(대표·관리자). 1:1 은 상대 사진, 업무·팀 방은 아이콘 그대로 */
const canPhoto = (u: SessionUser, r: Room) => (r.kind === 'group' && canEdit(u, r)) || (r.kind === 'company' && (u.role === 'owner' || u.role === 'admin'));
/** C12 방별 알림 단계: all(전체) · mention(멘션만 — 예전 '알림 끄기') · off(끄기 — 멘션도 안 옴) */
export const NOTIFY_LEVELS = ['all', 'mention', 'off'] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];
const autoName = (names: string[]) => (names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} 외 ${names.length - 3}`);

/** 메신저 2차 B8: 한 번에 보낸 사진 묶음은 안 읽은 수에 1건(묶음의 첫 장만 셈). x = chat_messages 별칭 */
const notBatchTail = (sql: Sql) => sql`not exists (select 1 from chat_messages y where y.batch_id = x.batch_id and y.id < x.id)`;

async function companyRoom(u: SessionUser, sql: Sql) {
  const t = tenantOf(u);
  await sql`insert into chat_rooms (tenant, kind, name) values (${t}, 'company', '회사 전체') on conflict do nothing`;
  const [r] = await sql<{ id: string }[]>`select id from chat_rooms where tenant = ${t} and kind = 'company'`;
  // V14 14번: 회사 전체방은 모든 직원이 자동 참여 (한 번도 메시지 화면을 안 연 사람도)
  // 로컬 10/19: 격리 팀 구성원(대표·관리자 제외)은 회사 전체방에 없음('회사 안의 작은 회사')
  const isolatedSql = sql`(exists (select 1 from team_members tm join teams tt on tt.id = tm.team_id where tm.user_id = users.id and tt.isolated and not tt.archived) and users.role not in ('owner', 'admin'))`; // 괄호: not ... and 우선순위
  await sql`insert into chat_members (room_id, user_id) select ${r.id}, id from users where status = 'active' and tenant = ${t} and not ${isolatedSql} on conflict do nothing`;
  await sql`delete from chat_members cm using users where users.id = cm.user_id and cm.room_id = ${r.id} and ${isolatedSql}`;
  return r.id;
}

/** 방 접근 확인 (+ 회사·업무 방은 자동 가입). 못 보면 404 */
export async function loadRoom(u: SessionUser, roomId: string, sql: Sql = db()): Promise<Room> {
  if (!/^[0-9a-f-]{36}$/.test(roomId)) throw notFound('대화방이 없습니다');
  const [r] = await sql<Room[]>`select id, tenant, kind, name, task_id, dm_key, team_id, owner_id, history_visible, photo_key, owner_only from chat_rooms where id = ${roomId}`;
  if (!r || r.tenant !== tenantOf(u)) throw notFound('대화방이 없습니다');
  if (r.kind === 'task') {
    await loadTaskForUser(u, r.task_id!, sql).catch(() => { throw notFound('대화방이 없습니다'); });
    await sql`insert into chat_members (room_id, user_id) values (${r.id}, ${u.id}) on conflict do nothing`;
  } else if (r.kind === 'team') { // V14 8번 팀 대화방: 팀원만 (팀원이 바뀌면 teams.ts 가 멤버를 맞춘다)
    const [m] = await sql`select 1 from team_members where team_id = ${r.team_id ?? null} and user_id = ${u.id}`;
    if (!m) throw notFound('대화방이 없습니다');
    await sql`insert into chat_members (room_id, user_id) values (${r.id}, ${u.id}) on conflict do nothing`;
  } else if (r.kind === 'company') {
    await sql`insert into chat_members (room_id, user_id) values (${r.id}, ${u.id}) on conflict do nothing`;
  } else {
    const [m] = await sql`select 1 from chat_members where room_id = ${r.id} and user_id = ${u.id}`;
    if (!m) throw notFound('대화방이 없습니다');
  }
  return r;
}

export async function listRooms(u: SessionUser) {
  const sql = db();
  await companyRoom(u, sql);
  const rooms = await sql`
    select r.id, r.kind, r.task_id, r.last_message_at, m.muted, m.notify, m.last_read_id, m.pinned_at is not null as pinned,
      case when r.photo_key is not null then substr(md5(r.photo_key), 1, 8) end as photo_v,
      case when r.kind = 'dm' then (select ou.name from chat_members om join users ou on ou.id = om.user_id where om.room_id = r.id and om.user_id <> ${u.id} limit 1)
           when r.kind = 'task' then coalesce(r.name, t.title) else r.name end as name,
      case when r.kind = 'dm' then (select om.user_id from chat_members om where om.room_id = r.id and om.user_id <> ${u.id} limit 1) end as other_id,
      (select count(*)::int from chat_members cm where cm.room_id = r.id) as member_count,
      (select count(*)::int from chat_messages x where x.room_id = r.id and x.id > greatest(m.last_read_id, m.joined_after_id) and x.deleted_at is null and x.kind <> 'system' and x.author_id is distinct from ${u.id}
        and ${notBatchTail(sql)}) as unread,
      case when m.notify = 'mention' then (select count(*)::int from chat_messages x where x.room_id = r.id and x.id > greatest(m.last_read_id, m.joined_after_id) and x.deleted_at is null and x.kind <> 'system'
        and x.author_id is distinct from ${u.id} and ${u.id} = any(x.mentions)) else 0 end as mention_unread,
      lm.body as last_body, lm.file_name as last_file, lm.file_mime as last_mime, lm.kind as last_kind, lu.name as last_author, lm.deleted_at is not null as last_deleted
    from chat_members m join chat_rooms r on r.id = m.room_id
      left join tasks t on t.id = r.task_id
      left join lateral (select * from chat_messages x where x.room_id = r.id order by x.id desc limit 1) lm on true
      left join users lu on lu.id = lm.author_id
    where m.user_id = ${u.id} and r.tenant = ${tenantOf(u)} and (r.kind <> 'task' or t.deleted_at is null)
    order by (m.pinned_at is not null) desc, (r.kind = 'company') desc, coalesce(r.last_message_at, r.created_at) desc`;
  // C12 안 읽은 수 합계(앱 배지와 같은 기준): 전체 = 안 읽은 것 모두 · 멘션만 = 나를 부른 것만 · 끄기 = 빼기
  return { rooms, unread: rooms.reduce((a: number, r: any) => a + (r.notify === 'all' ? r.unread : r.notify === 'mention' ? r.mention_unread : 0), 0) };
}

export async function unreadTotal(u: Pick<SessionUser, 'id'>) {
  // 목록(listRooms)과 같은 기준: 초대 이전·안내(시스템) 메시지 빼고, 사진 묶음은 1건. C12: 멘션만 받는 방은 나를 부른 것만, 알림 끈 방은 빼기
  const sql = db();
  const [r] = await sql<{ n: number }[]>`select coalesce(sum((select count(*) from chat_messages x where x.room_id = m.room_id and x.id > greatest(m.last_read_id, m.joined_after_id)
      and x.deleted_at is null and x.kind <> 'system' and x.author_id is distinct from ${u.id} and ${notBatchTail(sql)}
      and (m.notify = 'all' or ${u.id} = any(x.mentions)))), 0)::int n from chat_members m where m.user_id = ${u.id} and m.notify <> 'off'`;
  return r.n;
}
/** C12 앱 아이콘 배지 = 안 읽은 알림(메시지 알림 빼고) + 안 읽은 메시지(위 기준) — 앱 화면·푸시가 같은 숫자 */
export async function appBadge(userId: string) {
  const [c] = await db()<{ c: number }[]>`select count(*)::int c from notifications where user_id = ${userId} and read_at is null and type <> 'chat'`;
  return c.c + (await unreadTotal({ id: userId }));
}

export const roomInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dm'), userId: z.string().uuid() }),
  z.object({ kind: z.literal('group'), name: z.string().trim().max(60).optional(), userIds: z.array(z.string().uuid()).min(1).max(100) }),
  z.object({ kind: z.literal('task'), taskId: z.string().uuid() }),
]);
/** 같은 회사의 활동 중인 사람만 초대할 수 있다 */
async function sameTenantUsers(u: SessionUser, ids: string[], sql: Sql) {
  const rows = await sql<{ id: string }[]>`select id from users where id = any(${ids}::uuid[]) and status = 'active' and tenant = ${tenantOf(u)}`;
  if (rows.length !== new Set(ids).size) throw badRequest('초대할 수 없는 사람이 있습니다');
  const sc = await teamScope(u, sql); // 격리 팀 구성원: 같은 팀 사람·대표·관리자에게만
  if (sc.isolated) {
    const ok = await sql<{ id: string }[]>`select id from users where id = any(${ids}::uuid[]) and (id = any(${sc.mates}::uuid[]) or role in ('owner', 'admin'))`;
    if (ok.length !== new Set(ids).size) throw badRequest('초대할 수 없는 사람이 있습니다');
  }
  return rows.map((r) => r.id);
}
export async function openRoom(u: SessionUser, i: z.infer<typeof roomInput>) {
  const sql = db();
  const t = tenantOf(u);
  if (i.kind === 'dm') {
    if (i.userId === u.id) throw badRequest('자기 자신과는 대화할 수 없습니다');
    await sameTenantUsers(u, [i.userId], sql);
    const key = [u.id, i.userId].sort().join(':');
    await sql`insert into chat_rooms (tenant, kind, dm_key, created_by) values (${t}, 'dm', ${key}, ${u.id}) on conflict do nothing`;
    const [r] = await sql<{ id: string }[]>`select id from chat_rooms where tenant = ${t} and dm_key = ${key}`;
    await sql`insert into chat_members (room_id, user_id) values (${r.id}, ${u.id}), (${r.id}, ${i.userId}) on conflict do nothing`;
    return { id: r.id };
  }
  if (i.kind === 'group') {
    const ids = await sameTenantUsers(u, i.userIds.filter((x) => x !== u.id), sql);
    // 메신저 1차: 2명 이상 고르면 그룹 — 이름 비우면 "홍길동, 김철수 외 2" 자동(바로 바꿀 수 있음), 만든 사람이 방장
    const names = (await sql<{ name: string }[]>`select name from users where id = any(${ids}::uuid[]) order by name`).map((x) => x.name);
    const name = (i.name ?? '').trim() || autoName([u.name, ...names]);
    const [r] = await sql<{ id: string }[]>`insert into chat_rooms (tenant, kind, name, created_by, owner_id) values (${t}, 'group', ${name}, ${u.id}, ${u.id}) returning id`;
    for (const id of [u.id, ...ids]) await sql`insert into chat_members (room_id, user_id) values (${r.id}, ${id}) on conflict do nothing`;
    await systemMessage(sql, r.id, `${u.name}님이 ${names.join(', ')}님을 초대했습니다`);
    return { id: r.id, name };
  }
  const { task } = await loadTaskForUser(u, i.taskId, sql);
  await sql`insert into chat_rooms (tenant, kind, task_id, created_by) values (${t}, 'task', ${task.id}, ${u.id}) on conflict do nothing`;
  const [r] = await sql<{ id: string }[]>`select id from chat_rooms where task_id = ${task.id}`;
  await sql`insert into chat_members (room_id, user_id) values (${r.id}, ${u.id}) on conflict do nothing`;
  return { id: r.id };
}

export async function addMembers(u: SessionUser, roomId: string, userIds: string[]) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  if (r.kind !== 'group') throw badRequest('그룹 대화에만 사람을 더할 수 있습니다');
  if (!canEdit(u, r)) throw forbidden('이 방은 방장만 초대할 수 있습니다 — 방장에게 부탁해 주세요');
  const ids = await sameTenantUsers(u, userIds, sql);
  const already = new Set((await sql<{ user_id: string }[]>`select user_id from chat_members where room_id = ${r.id}`).map((x) => x.user_id));
  const fresh = ids.filter((x) => !already.has(x));
  if (!fresh.length) return { ok: true, added: 0 };
  // 메신저 1차: 초대된 사람은 초대 시점 이후 메시지만(회사 보안) — 방장이 '이전 대화 공개'를 켠 방은 처음부터
  const [{ last }] = await sql<{ last: string }[]>`select coalesce(max(id), 0)::text as last from chat_messages where room_id = ${r.id}`;
  for (const id of fresh) await sql`insert into chat_members (room_id, user_id, joined_after_id, last_read_id) values (${r.id}, ${id}, ${r.history_visible ? 0 : last}::bigint, ${last}::bigint) on conflict do nothing`;
  const names = (await sql<{ name: string }[]>`select name from users where id = any(${fresh}::uuid[]) order by name`).map((x) => x.name);
  await systemMessage(sql, r.id, `${u.name}님이 ${names.join(', ')}님을 초대했습니다`);
  return { ok: true, added: fresh.length };
}
/** 메신저 1차: 내보내기 — 방장·대표·관리자만, 본인은 '나가기'로 */
export async function removeMember(u: SessionUser, roomId: string, userId: string) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  if (r.kind !== 'group') throw badRequest('그룹 대화에서만 내보낼 수 있습니다');
  if (!canManage(u, r)) throw forbidden('방장이나 관리자만 내보낼 수 있습니다');
  if (userId === u.id) throw badRequest('본인은 [나가기]로 나갑니다');
  const [m] = await sql<{ name: string }[]>`select us.name from chat_members cm join users us on us.id = cm.user_id where cm.room_id = ${r.id} and cm.user_id = ${userId}`;
  if (!m) throw notFound('이 방에 없는 사람입니다');
  await sql`delete from chat_members where room_id = ${r.id} and user_id = ${userId}`;
  await systemMessage(sql, r.id, `${u.name}님이 ${m.name}님을 내보냈습니다`);
  await audit(sql, u.id, 'chat.member_removed', 'chat_room', r.id, { userId }, null);
  return { ok: true };
}
/** 메신저 1차: 방장이 '이전 대화 공개'를 켜면 앞으로 초대되는 사람도 처음부터 본다(이미 들어온 사람도 공개) */
export async function setHistoryVisible(u: SessionUser, roomId: string, on: boolean) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  if (r.kind !== 'group') throw badRequest('그룹 대화에서만 정할 수 있습니다');
  if (!canManage(u, r)) throw forbidden('방장이나 관리자만 바꿀 수 있습니다');
  await sql`update chat_rooms set history_visible = ${on} where id = ${r.id}`;
  if (on) await sql`update chat_members set joined_after_id = 0 where room_id = ${r.id}`;
  await systemMessage(sql, r.id, on ? `${u.name}님이 이전 대화를 공개했습니다` : `${u.name}님이 이전 대화 공개를 껐습니다(앞으로 초대되는 사람은 초대 뒤 대화만 봅니다)`);
  return { ok: true };
}
export async function leaveRoom(u: SessionUser, roomId: string) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  if (r.kind !== 'group') throw badRequest('그룹 대화만 나갈 수 있습니다');
  await sql`delete from chat_members where room_id = ${r.id} and user_id = ${u.id}`;
  await systemMessage(sql, r.id, `${u.name}님이 나갔습니다`);
  if (r.owner_id === u.id) await sql`update chat_rooms set owner_id = (select user_id from chat_members where room_id = ${r.id} order by joined_at limit 1) where id = ${r.id}`; // 방장이 나가면 가장 오래된 사람에게
  return { ok: true };
}
/** 대화방 이름 바꾸기: 그룹·업무 대화는 참여자 누구나, 회사 전체방은 대표·관리자. 1:1(상대 이름)·팀(팀 이름을 따름)은 안 됨.
 *  업무 대화는 빈 이름이면 업무 제목으로 되돌린다 */
export const canRenameRoom = (u: SessionUser, kind: Room['kind']) => kind === 'group' || kind === 'task' || (kind === 'company' && (u.role === 'owner' || u.role === 'admin'));
export async function renameRoom(u: SessionUser, roomId: string, name: string) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  if (!canRenameRoom(u, r.kind)) throw forbidden(r.kind === 'dm' ? '1:1 대화는 이름을 바꿀 수 없습니다' : r.kind === 'team' ? '팀 대화방 이름은 팀 이름을 따릅니다 — 팀 설정에서 바꿔 주세요' : '회사 전체방 이름은 대표·관리자만 바꿀 수 있습니다');
  if (!canEdit(u, r)) throw forbidden('이 방은 방장만 이름을 바꿀 수 있습니다');
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n && r.kind !== 'task') throw badRequest('이름을 입력해 주세요');
  await sql`update chat_rooms set name = ${n || null} where id = ${r.id}`;
  await audit(sql, u.id, 'chat.room_renamed', 'chat_room', r.id, { from: r.name, to: n || null }, null);
  return { ok: true, name: n || null };
}
export async function setRoomPinned(u: SessionUser, roomId: string, pinned: boolean) {
  const sql = db();
  await loadRoom(u, roomId, sql);
  await sql`update chat_members set pinned_at = ${pinned ? new Date() : null} where room_id = ${roomId} and user_id = ${u.id}`;
  return { ok: true };
}
/** C12 방별 알림 단계(나만). muted 는 옛 화면·옛 앱 호환으로 같이 맞춤(전체가 아니면 true) */
export async function setNotify(u: SessionUser, roomId: string, level: NotifyLevel) {
  const sql = db();
  await loadRoom(u, roomId, sql);
  await sql`update chat_members set notify = ${level}, muted = ${level !== 'all'} where room_id = ${roomId} and user_id = ${u.id}`;
  return { ok: true, notify: level };
}
/** 옛 '알림 끄기·켜기'(muted): 끄기 = 멘션만(예전처럼 나를 부르면 옴) · 켜기 = 전체 */
export const setMuted = (u: SessionUser, roomId: string, muted: boolean) => setNotify(u, roomId, muted ? 'mention' : 'all');

/** 메신저 3차 D14: '방장만 관리' 켜기·끄기 — 그룹 대화, 방장·대표·관리자만 */
export async function setOwnerOnly(u: SessionUser, roomId: string, on: boolean) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  if (r.kind !== 'group') throw badRequest('그룹 대화에서만 정할 수 있습니다');
  if (!canManage(u, r)) throw forbidden('방장이나 관리자만 바꿀 수 있습니다');
  if (!!r.owner_only === on) return { ok: true };
  await sql`update chat_rooms set owner_only = ${on} where id = ${r.id}`;
  await systemMessage(sql, r.id, on ? `${u.name}님이 방 이름·사진·초대·공지를 방장만 바꿀 수 있게 했습니다` : `${u.name}님이 방 이름·사진·초대·공지를 누구나 바꿀 수 있게 했습니다`);
  await audit(sql, u.id, 'chat.owner_only', 'chat_room', r.id, { on }, null);
  return { ok: true };
}
/** 방장 넘기기 — 지금 방장·대표·관리자가 이 방에 있는 (재직 중인) 사람에게 */
export async function transferOwner(u: SessionUser, roomId: string, userId: string) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  if (r.kind !== 'group') throw badRequest('그룹 대화에서만 방장을 넘길 수 있습니다');
  if (!canManage(u, r)) throw forbidden('방장이나 관리자만 방장을 넘길 수 있습니다');
  if (userId === r.owner_id) return { ok: true };
  const [m] = await sql<{ name: string }[]>`select us.name from chat_members cm join users us on us.id = cm.user_id where cm.room_id = ${r.id} and cm.user_id = ${userId} and us.status = 'active'`;
  if (!m) throw badRequest('이 방에 있는 사람에게만 넘길 수 있습니다');
  await sql`update chat_rooms set owner_id = ${userId} where id = ${r.id}`;
  await systemMessage(sql, r.id, `${u.name}님이 ${m.name}님에게 방장을 넘겼습니다`);
  await audit(sql, u.id, 'chat.owner_transferred', 'chat_room', r.id, { from: r.owner_id ?? null, to: userId }, null);
  return { ok: true };
}
/** 방 사진: 대화방 파일 올리기(files)로 올린 사진 키를 붙인다(null = 지우기). 이 방 저장 경로·사진 확장자·10MB 까지 */
const PHOTO_EXT = /\.(png|jpe?g|gif|webp)$/i;
/** 파일 앞머리로 본 사진 형식(png·jpg·gif·webp) — 이름만 .png 인 다른 파일은 null */
const imageMime = (b: Buffer) => b.length < 12 ? null : b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
  : b.toString('latin1', 0, 4) === 'GIF8' ? 'image/gif' : b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : null;
export async function setRoomPhoto(u: SessionUser, roomId: string, key: string | null) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  if (r.kind !== 'group' && r.kind !== 'company') throw badRequest('그룹 대화·회사 전체방만 방 사진을 바꿀 수 있습니다');
  if (!canPhoto(u, r)) throw forbidden(r.kind === 'company' ? '회사 전체방 사진은 대표·관리자만 바꿀 수 있습니다' : '이 방은 방장만 사진을 바꿀 수 있습니다');
  if (key) {
    if (!key.startsWith(`chat/${r.tenant}/${r.id}/`) || !PHOTO_EXT.test(key)) throw badRequest('사진 파일(png·jpg·gif·webp)만 쓸 수 있습니다');
    const size = await objectSize(key);
    if (size === null) throw badRequest('올린 사진을 찾을 수 없습니다. 다시 올려 주세요.');
    if (size > 10 * 1024 * 1024) throw badRequest('방 사진은 10MB까지입니다');
    const buf = await getObject(key);
    const mime = imageMime(buf);
    if (!mime) throw badRequest('사진 파일(png·jpg·gif·webp)만 쓸 수 있습니다');
    await putObject(key, buf, mime); // 올린 사람이 적은 파일 형식 대신 실제 사진 형식으로 다시 저장(내려받을 때 사진으로만 열리게)
  }
  if ((r.photo_key ?? null) === key) return { ok: true };
  await sql`update chat_rooms set photo_key = ${key} where id = ${r.id}`;
  await systemMessage(sql, r.id, key ? `${u.name}님이 방 사진을 바꿨습니다` : `${u.name}님이 방 사진을 지웠습니다`);
  return { ok: true };
}
/** 방 사진 보기(방 사람만) — 잠깐 쓰는 서명 주소 */
export async function roomPhoto(u: SessionUser, roomId: string) {
  const r = await loadRoom(u, roomId);
  if (!r.photo_key) throw notFound('방 사진이 없습니다');
  return downloadUrl(r.photo_key, r.photo_key.split('/').pop() || 'room.jpg', true, 600);
}

const MSG_COLS = (sql: Sql, u: SessionUser) => sql`m.id::text as id, m.room_id, m.author_id, au.name as author_name, m.created_at, m.edited_at, m.pinned_at, m.kind, m.forward_of::text as forward_of,
  (select count(*)::int from chat_members ux where ux.room_id = m.room_id and ux.user_id is distinct from m.author_id and ux.last_read_id < m.id and ux.joined_after_id < m.id) as unread,
  case when m.deleted_at is null then m.body else '' end as body, (m.deleted_at is not null) as deleted,
  case when m.deleted_at is null then m.file_name end as file_name, case when m.deleted_at is null then m.file_mime end as file_mime,
  case when m.deleted_at is null then m.file_size end as file_size, m.task_id, (m.author_id = ${u.id}) as mine,
  m.reply_to::text as reply_to,
  (select json_build_object('author', ru.name, 'body', case when rm.deleted_at is null then left(rm.body, 120) else '' end, 'file', case when rm.deleted_at is null then rm.file_name end, 'deleted', rm.deleted_at is not null,
     'mime', case when rm.deleted_at is null then rm.file_mime end, 'n', case when rm.batch_id is null then 1 else (select count(*)::int from chat_messages b where b.room_id = rm.room_id and b.batch_id = rm.batch_id and b.deleted_at is null) end)
     from chat_messages rm left join users ru on ru.id = rm.author_id where rm.id = m.reply_to) as reply, -- 로컬 10/25 사소 ②: 인용 라벨 '📷 사진 n장'용 mime·묶음 장 수
  coalesce((select json_agg(json_build_object('emoji', g.emoji, 'n', g.n, 'mine', g.mine, 'names', g.names) order by g.first)
     from (select r.emoji, count(*)::int n, bool_or(r.user_id = ${u.id}) mine, array_agg(ru2.name order by r.created_at) names, min(r.created_at) first
       from chat_reactions r join users ru2 on ru2.id = r.user_id where r.message_id = m.id group by r.emoji) g), '[]') as reactions,
  m.batch_id::text as batch_id, m.sticker,
  ${POLL_COL(sql, u)} as poll,
  (select json_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at, 'all_day', e.all_day, 'location', e.location,
       'cancelled', e.cancelled or e.deleted_at is not null, 'going', (select count(*)::int from event_attendees a where a.event_id = e.id and a.response = 'accepted'),
       'invited', (select count(*)::int from event_attendees a where a.event_id = e.id), 'response', (select a.response from event_attendees a where a.event_id = e.id and a.user_id = ${u.id}))
     from events e where e.id = m.event_id) as event`;
/** 메신저 2차 B9 투표: 보기·보기별 표 수·내 선택·참여 인원·(익명 아니면) 고른 사람 이름. 마감 시각이 지나면 closed */
const POLL_COL = (sql: Sql, u: SessionUser) => sql`(select json_build_object('question', p.question, 'options', p.options, 'multi', p.multi, 'anonymous', p.anonymous, 'closes_at', p.closes_at,
     'closed', p.closed_at is not null or (p.closes_at is not null and p.closes_at <= now()),
     'counts', (select coalesce(json_agg((select count(*)::int from chat_poll_votes v where v.message_id = p.message_id and v.option_idx = gi.i) order by gi.i), '[]') from generate_series(0, jsonb_array_length(p.options) - 1) as gi(i)),
     'mine', (select coalesce(json_agg(v.option_idx order by v.option_idx), '[]') from chat_poll_votes v where v.message_id = p.message_id and v.user_id = ${u.id}),
     'voters', (select count(distinct v.user_id)::int from chat_poll_votes v where v.message_id = p.message_id),
     'names', case when p.anonymous then null else (select json_object_agg(g.option_idx, g.names) from (select v.option_idx, array_agg(vu.name order by v.created_at) as names
       from chat_poll_votes v join users vu on vu.id = v.user_id where v.message_id = p.message_id group by v.option_idx) g) end)
   from chat_polls p where p.message_id = m.id)`;

/**
 * 대화방 열기·이전/다음 불러오기. before = 그 앞 60개, after = 그 뒤 60개(hasNewer), around = 그 메시지 앞 30·뒤 40개(답장 원문·검색 결과로 이동).
 * 처음 열 때는 안 읽은 메시지가 60개보다 많으면 그만큼 더(최대 300) — '여기까지 읽음' 선이 보이게(메신저 2차 B11)
 */
export async function roomDetail(u: SessionUser, roomId: string, q: { before?: string; after?: string; around?: string; q?: string }) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  const like = q.q ? '%' + q.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%' : null;
  const [me0] = await sql<{ joined_after_id: string; last_read_id: string }[]>`select joined_after_id::text, last_read_id::text from chat_members where room_id = ${r.id} and user_id = ${u.id}`;
  const after = me0?.joined_after_id ?? '0';
  const pick = (cond: any, dir: 'asc' | 'desc', n: number) => sql`select ${MSG_COLS(sql, u)} from chat_messages m left join users au on au.id = m.author_id
    where m.room_id = ${r.id} and m.id > ${after}::bigint ${cond} order by m.id ${dir === 'asc' ? sql`asc` : sql`desc`} limit ${n}`;
  let messages: any[]; let hasOlder = false; let hasNewer = false;
  if (q.around) {
    const older = await pick(sql`and m.id < ${q.around}::bigint`, 'desc', 31);
    const newer = await pick(sql`and m.id >= ${q.around}::bigint`, 'asc', 41);
    hasOlder = older.length > 30; hasNewer = newer.length > 40;
    messages = [...older.slice(0, 30).reverse(), ...newer.slice(0, 40)];
  } else if (q.after) {
    const rows = await pick(sql`and m.id > ${q.after}::bigint`, 'asc', 61);
    hasNewer = rows.length > 60; messages = rows.slice(0, 60);
  } else {
    let limit = 60;
    if (!q.before && !like) {
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from chat_messages where room_id = ${r.id} and id > greatest(${me0?.last_read_id ?? '0'}::bigint, ${after}::bigint) and author_id is distinct from ${u.id}`;
      limit = Math.min(300, Math.max(60, n + 10));
    }
    const rows = await pick(sql`${q.before ? sql`and m.id < ${q.before}::bigint` : sql``} ${like ? sql`and m.deleted_at is null and (m.body ilike ${like} or m.file_name ilike ${like})` : sql``}`, 'desc', limit + 1);
    hasOlder = rows.length > limit; messages = rows.slice(0, limit).reverse();
  }
  const members = await sql`select cm.user_id as id, us.name, us.title, us.phone, us.role, cm.last_read_id::text as last_read_id, (cm.user_id = ${r.owner_id ?? null}) as is_owner, cm.joined_at from chat_members cm join users us on us.id = cm.user_id where cm.room_id = ${r.id} order by (cm.user_id = ${r.owner_id ?? null}) desc, us.name`;
  const pinned = await sql`select ${MSG_COLS(sql, u)} from chat_messages m left join users au on au.id = m.author_id where m.room_id = ${r.id} and m.pinned_at is not null and m.deleted_at is null order by m.pinned_at desc limit 10`;
  const [me] = await sql<{ notify: NotifyLevel }[]>`select notify from chat_members where room_id = ${r.id} and user_id = ${u.id}`;
  const level = me?.notify ?? 'all';
  let name = r.name;
  if (r.kind === 'dm') name = (members as any[]).find((m) => m.id !== u.id)?.name ?? '대화';
  if (r.kind === 'task' && !r.name) name = (await sql<{ title: string }[]>`select title from tasks where id = ${r.task_id}`)[0]?.title ?? '업무';
  // B10 자주 쓰는 반응 6개: 내가 많이 쓴 반응 먼저, 모자라면 기본 6개로 채움
  const used = (await sql<{ emoji: string }[]>`select emoji from chat_reactions where user_id = ${u.id} and emoji = any(${[...REACTIONS]}) group by emoji order by count(*) desc, max(created_at) desc limit 6`).map((x) => x.emoji);
  const quickReactions = [...used, ...QUICK_DEFAULT.filter((e) => !used.includes(e))].slice(0, 6);
  // 메신저 3차: notify = 방별 알림 단계(muted 는 옛 화면 호환) · 방 사진 · 방장만 관리(ownerOnly)일 때 canEdit = 이름·사진·초대·공지 가능 여부
  return { room: { id: r.id, kind: r.kind, name, taskId: r.task_id, muted: level !== 'all', notify: level, canRename: canRenameRoom(u, r.kind) && canEdit(u, r), ownerId: r.owner_id ?? null, canManage: canManage(u, r), historyVisible: !!r.history_visible, joinedAfter: after,
    canMentionAll: canMentionAll(u, r), photo: r.photo_key ? `/api/chat/rooms/${r.id}/photo?v=${createHash('md5').update(r.photo_key).digest('hex').slice(0, 8)}` : null, ownerOnly: !!r.owner_only,
    canEdit: canEdit(u, r), canPhoto: canPhoto(u, r) }, messages, members, pinned, hasOlder, hasNewer, lastRead: me0?.last_read_id ?? '0', quickReactions };
}

const pollInput = z.object({
  question: z.string().trim().min(1, '질문을 입력하세요').max(200),
  options: z.array(z.string().trim().min(1, '빈 보기가 있습니다').max(80)).min(POLL_MIN, `보기를 ${POLL_MIN}개 이상 넣으세요`).max(POLL_MAX, `보기는 ${POLL_MAX}개까지입니다`),
  multi: z.boolean().optional(),
  anonymous: z.boolean().optional(),
  closesAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export const messageInput = z.object({
  body: z.string().max(5000).default(''),
  file: z.object({ key: z.string().max(400), name: z.string().max(200), mime: z.string().max(100), size: z.number().int().positive(), uploadId: z.string().max(400).optional() }).optional(),
  replyTo: z.string().regex(/^\d+$/).max(20).optional(),
  /** 메신저 2차 B8: 한 번에 고른 사진·영상(같은 값끼리 한 칸) · 묶음 장 수(알림 글 '사진 3장'용) */
  batch: z.string().uuid().optional(),
  batchSize: z.number().int().min(1).max(30).optional(),
  /** B10 회사 기본 스티커 코드 */
  sticker: z.string().max(30).optional(),
  /** B9 투표 */
  poll: pollInput.optional(),
});
/** 알림·목록 미리보기에 쓰는 파일 글: 사진 '📷 사진(3장)' · 영상 '🎬 동영상' · 나머지 '📎 이름' */
const fileLabel = (f: { name: string; mime: string }, n = 1) => /^image\//.test(f.mime) ? (n > 1 ? `📷 사진 ${n}장` : '📷 사진') : /^video\//.test(f.mime) ? (n > 1 ? `🎬 동영상 ${n}개` : '🎬 동영상') : `📎 ${f.name}`;
/** @전체: 1:1 은 안 되고, 회사 전체방은 대표·관리자만 */
const canMentionAll = (u: SessionUser, r: Room) => r.kind !== 'dm' && (r.kind !== 'company' || u.role === 'owner' || u.role === 'admin');
export async function sendMessage(u: SessionUser, roomId: string, i: z.infer<typeof messageInput>) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  const st = i.sticker ? stickerOf(i.sticker) : null;
  if (i.sticker && !st) throw badRequest('없는 스티커입니다');
  if ((st || i.poll) && i.file) throw badRequest('파일과 함께 보낼 수 없습니다');
  if (i.batch && !i.file) throw badRequest('묶음은 사진·영상만 보낼 수 있습니다');
  if (i.poll) {
    const keys = i.poll.options.map((o) => o.replace(/\s+/g, ' ').toLowerCase());
    if (new Set(keys).size !== keys.length) throw badRequest('같은 보기가 있습니다');
    if (i.poll.closesAt && Date.parse(i.poll.closesAt) <= Date.now() + 60_000) throw badRequest('마감 시각은 지금보다 뒤여야 합니다');
  }
  const kind = st ? 'sticker' : i.poll ? 'poll' : 'text';
  let body = st ? st.text : i.poll ? i.poll.question : i.body.trim();
  if (!body && !i.file) throw badRequest('내용을 입력하세요');
  if (i.file) {
    if (!i.file.key.startsWith(`chat/${r.tenant}/${r.id}/`)) throw badRequest('잘못된 파일입니다');
    if (i.file.uploadId) await completeMultipart(i.file.key, i.file.uploadId).catch((e) => { throw badRequest(`조각 합치기 실패: ${(e as Error).message}`); }); // #109 영상 조각 업로드
    if ((await objectSize(i.file.key)) === null) throw badRequest('업로드된 파일을 찾을 수 없습니다. 다시 올려 주세요.');
  }
  if (i.replyTo && !(await sql`select 1 from chat_messages where id = ${i.replyTo}::bigint and room_id = ${r.id}`).length) throw badRequest('답장할 메시지가 이 대화방에 없습니다');
  const mentionIds = [...body.matchAll(/@\[[^\]]{1,50}\]\(([0-9a-f-]{36})\)/g)].map((m) => m[1]);
  const members = (await sql<{ user_id: string; notify: NotifyLevel }[]>`select user_id, notify from chat_members where room_id = ${r.id}`);
  const memberIds = members.map((m) => m.user_id);
  // 업무 방은 업무를 볼 수 있지만 아직 방을 연 적 없는 담당·요청자에게도 알린다
  if (r.kind === 'task') {
    const [t] = await sql<{ assignee_id: string | null; requested_by: string | null; created_by: string }[]>`select assignee_id, requested_by, created_by from tasks where id = ${r.task_id}`;
    const co = (await sql<{ user_id: string }[]>`select user_id from task_assignees where task_id = ${r.task_id}`).map((x) => x.user_id); // #475 공동 담당도
    for (const id of [t?.assignee_id, ...co, t?.requested_by, t?.created_by]) if (id && !memberIds.includes(id)) {
      await sql`insert into chat_members (room_id, user_id) values (${r.id}, ${id}) on conflict do nothing`; memberIds.push(id); members.push({ user_id: id, notify: 'all' });
    }
  }
  // B11 @전체 = 방 사람 모두 멘션(멘션만 받는 사람에게도, C12 '끄기'는 빼고) — 쓸 수 없는 방이면 그냥 글자로
  const allTag = `@[전체](${ALL_ID})`;
  const toAll = body.includes(allTag) && canMentionAll(u, r);
  if (body.includes(allTag) && !toAll) body = body.split(allTag).join('@전체');
  const mentions = [...new Set([...mentionIds.filter((x) => memberIds.includes(x)), ...(toAll ? memberIds.filter((x) => x !== u.id) : [])])];
  const [m] = await sql.begin(async (tx) => {
    const rows = await tx<{ id: string; created_at: Date }[]>`insert into chat_messages (room_id, author_id, body, mentions, file_key, file_name, file_mime, file_size, reply_to, kind, sticker, batch_id)
      values (${r.id}, ${u.id}, ${body}, ${mentions}, ${i.file?.key ?? null}, ${i.file?.name ?? null}, ${i.file?.mime ?? null}, ${i.file?.size ?? null}, ${i.replyTo ?? null}, ${kind}, ${st?.code ?? null}, ${i.batch ?? null})
      returning id::text, created_at`;
    if (i.poll) await tx`insert into chat_polls (message_id, question, options, multi, anonymous, closes_at)
      values (${rows[0].id}::bigint, ${body}, ${tx.json(i.poll.options)}, ${!!i.poll.multi}, ${!!i.poll.anonymous}, ${i.poll.closesAt ?? null})`;
    return rows;
  });
  await sql`update chat_rooms set last_message_at = now() where id = ${r.id}`;
  await sql`update chat_members set last_read_id = ${m.id}::bigint where room_id = ${r.id} and user_id = ${u.id}`;
  await sql`delete from chat_typing where room_id = ${r.id} and user_id = ${u.id}`;
  // 푸시(C12 방별 알림): 전체 = 모두 · 멘션만 = 나를 부른 것(@전체 포함)만 · 끄기 = 안 보냄. 보낸 사람 제외. 알림 목록에는 쌓지 않는다(메시지 화면이 따로 있음)
  const roomName = r.kind === 'dm' ? u.name : r.kind === 'task' ? `업무 대화 · ${(await sql<{ title: string }[]>`select title from tasks where id = ${r.task_id}`)[0]?.title ?? ''}` : r.name ?? '대화';
  const preview = (st ? `(스티커) ${st.text}` : i.poll ? `📊 투표: ${body}` : body.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1') || (i.file ? fileLabel(i.file, i.batchSize) : '')).slice(0, 120);
  const targets = members.filter((x) => x.user_id !== u.id && (x.notify === 'all' || (x.notify === 'mention' && mentions.includes(x.user_id)))).map((x) => x.user_id);
  // 사진 묶음은 첫 장에서 한 번만 알림('사진 3장'). meta.messageId = 푸시 [읽음] 버튼이 여기까지 읽음 처리(C12)
  await notify(sql, { userIds: targets, type: 'chat', title: roomName, body: r.kind === 'dm' ? preview : `${u.name}: ${preview}`,
    link: `/messages?room=${r.id}`, entityType: 'chat_room', entityId: r.id, actorId: u.id, dedupeKey: i.batch ? `chat:batch:${i.batch}` : `chat:${m.id}`, meta: { messageId: m.id } });
  // V35 2 2차 (#76): 1:1 상대가 부재중이면 안내 메시지(방마다 하루 1번)
  if (r.kind === 'dm') { const other = members.find((x) => x.user_id !== u.id); if (other) await (await import('./away')).autoReplyIfAway(sql, r.id, other.user_id).catch(() => false); }
  return { id: m.id, createdAt: m.created_at, notified: targets };
}

async function ownMessage(u: SessionUser, id: string, sql: Sql) {
  if (!/^\d+$/.test(id)) throw notFound();
  const [m] = await sql<{ id: string; room_id: string; author_id: string | null; deleted_at: Date | null; kind: string; sticker: string | null; event_id: string | null }[]>`
    select id::text, room_id, author_id, deleted_at, kind, sticker, event_id from chat_messages where id = ${id}::bigint`;
  if (!m) throw notFound('메시지가 없습니다');
  const room = await loadRoom(u, m.room_id, sql);
  return { ...m, room };
}
export async function editMessage(u: SessionUser, id: string, body: string) {
  const sql = db();
  const m = await ownMessage(u, id, sql);
  if (m.author_id !== u.id || m.deleted_at) throw forbidden('내가 보낸 메시지만 고칠 수 있습니다');
  if (!['text', 'forward'].includes(m.kind) || m.sticker || m.event_id) throw badRequest('투표·일정·스티커는 고칠 수 없습니다');
  if (!body.trim()) throw badRequest('내용을 입력하세요');
  await sql`update chat_messages set body = ${body.trim()}, edited_at = now() where id = ${id}::bigint`;
  return { ok: true };
}
export async function deleteMessage(u: SessionUser, id: string) {
  const sql = db();
  const m = await ownMessage(u, id, sql);
  if (m.author_id !== u.id) throw forbidden('내가 보낸 메시지만 지울 수 있습니다');
  await sql`update chat_messages set deleted_at = now(), pinned_at = null where id = ${id}::bigint`;
  return { ok: true };
}
export async function pinMessage(u: SessionUser, id: string, pin: boolean) {
  const sql = db();
  const m = await ownMessage(u, id, sql);
  if (m.deleted_at) throw badRequest('삭제된 메시지입니다');
  if (!canEdit(u, m.room)) throw forbidden('이 방은 방장만 공지를 올리거나 내릴 수 있습니다');
  await sql`update chat_messages set pinned_at = ${pin ? sql`now()` : null}, pinned_by = ${pin ? u.id : null} where id = ${id}::bigint`;
  return { ok: true };
}
/** 메신저 2차 B10: 반응 16개(앞 6개가 처음 쓰는 사람의 '자주 쓰는 반응') */
export const CHAT_EMOJI = REACTIONS;
export async function reactMessage(u: SessionUser, id: string, emoji: string) {
  const sql = db();
  const m = await ownMessage(u, id, sql);
  if (m.deleted_at) throw badRequest('삭제된 메시지입니다');
  if (!(CHAT_EMOJI as readonly string[]).includes(emoji)) throw badRequest('쓸 수 없는 반응입니다');
  const del = await sql`delete from chat_reactions where message_id = ${id}::bigint and user_id = ${u.id} and emoji = ${emoji} returning 1`;
  if (!del.length) await sql`insert into chat_reactions (message_id, user_id, emoji) values (${id}::bigint, ${u.id}, ${emoji}) on conflict do nothing`;
  await sql`update chat_messages set reacted_at = now() where id = ${id}::bigint`;
  return { ok: true, on: !del.length };
}
export async function markRead(u: SessionUser, roomId: string, upTo?: string) {
  const sql = db();
  await loadRoom(u, roomId, sql);
  await sql`update chat_members set last_read_id = greatest(last_read_id, coalesce(${upTo ?? null}::bigint, (select coalesce(max(id), 0) from chat_messages where room_id = ${roomId})))
    where room_id = ${roomId} and user_id = ${u.id}`;
  // 이 방 메시지 알림도 읽음 처리
  await sql`update notifications set read_at = now() where user_id = ${u.id} and type = 'chat' and entity_id = ${roomId} and read_at is null`;
  return { ok: true };
}
export async function setTyping(u: SessionUser, roomId: string) {
  const sql = db();
  await loadRoom(u, roomId, sql);
  await sql`insert into chat_typing (room_id, user_id) values (${roomId}, ${u.id}) on conflict (room_id, user_id) do update set at = now()`;
  return { ok: true };
}

/** 파일: 저장 키에 회사·방이 들어간다. 내려받기도 방 멤버 확인 후 서명 주소 */
export async function fileTarget(u: SessionUser, roomId: string, i: { fileName: string; mime: string; size: number }) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  if (i.size > maxUploadBytes(i.mime)) throw badRequest(tooLargeMsg(i.mime)); // #109: 영상 100MB(조각)
  if (/\.(exe|bat|cmd|com|msi|scr|ps1|vbs|jar|apk|ipa|dll|sh)$/i.test(i.fileName)) throw badRequest('실행 파일은 올릴 수 없습니다');
  await (await import('./plans')).assertStorage(u, i.size);
  const key = `chat/${r.tenant}/${r.id}/${crypto.randomUUID()}/${i.fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120)}`;
  return { key, upload: await uploadTargetFor(key, i.mime || 'application/octet-stream', i.size) };
}
export async function fileDownload(u: SessionUser, id: string, inline: boolean) {
  const sql = db();
  const m = await ownMessage(u, id, sql);
  const [f] = await sql<{ file_key: string | null; file_name: string; file_mime: string }[]>`select file_key, file_name, file_mime from chat_messages where id = ${m.id}::bigint and deleted_at is null`;
  if (!f?.file_key) throw notFound();
  // 메신저 2차 B8: 영상·소리도 대화창에서 바로 재생(inline)
  return downloadUrl(f.file_key, f.file_name, inline && /^(image\/(png|jpe?g|gif|webp)|application\/pdf|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|aac|ogg|webm|wav|x-m4a))$/.test(f.file_mime));
}

/** 실시간: 마지막으로 본 id 이후 새 메시지·수정·입력 중. SSE 와 폴링이 같이 쓴다 */
export async function changesSince(u: SessionUser, since: string, sinceTime: Date) {
  const sql = db();
  const rows = await sql`select ${MSG_COLS(sql, u)} from chat_messages m join chat_members cm on cm.room_id = m.room_id and cm.user_id = ${u.id}
    left join users au on au.id = m.author_id
    where m.id > cm.joined_after_id and (m.id > ${since}::bigint or (m.edited_at > ${sinceTime} or m.deleted_at > ${sinceTime} or m.pinned_at > ${sinceTime} or m.reacted_at > ${sinceTime}))
    order by m.id limit 200`;
  const typing = await sql`select t.room_id, us.name from chat_typing t join chat_members cm on cm.room_id = t.room_id and cm.user_id = ${u.id}
    join users us on us.id = t.user_id where t.user_id <> ${u.id} and t.at > now() - interval '6 seconds'`;
  const reads = await sql`select cm.room_id, cm.user_id, cm.last_read_id::text as last_read_id from chat_members cm
    where cm.room_id in (select room_id from chat_members where user_id = ${u.id}) and cm.user_id <> ${u.id}`;
  return { messages: rows, typing, reads };
}
export async function latestId() {
  const [r] = await db()<{ id: string }[]>`select coalesce(max(id), 0)::text id from chat_messages`;
  return r.id;
}

export async function searchMessages(u: SessionUser, q: string) {
  const sql = db();
  const like = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
  return { results: await sql`select ${MSG_COLS(sql, u)}, r.kind as room_kind, coalesce(r.name, t.title) as room_name
    from chat_messages m join chat_members cm on cm.room_id = m.room_id and cm.user_id = ${u.id} join chat_rooms r on r.id = m.room_id left join tasks t on t.id = r.task_id
    left join users au on au.id = m.author_id where m.id > cm.joined_after_id and m.deleted_at is null and (m.body ilike ${like} or m.file_name ilike ${like}) order by m.id desc limit 50` };
}

/** 메신저 3차 D15 방 안 검색: 이 방에서 찾는 말이 든 메시지 id(최신 순, 최대 300) — 화면은 위/아래로 옮겨 가며 그 메시지로 이동·강조. 초대 전·삭제·안내 메시지는 빼고 */
export async function searchRoom(u: SessionUser, roomId: string, q: string) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  const like = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
  const [me] = await sql<{ joined_after_id: string }[]>`select joined_after_id::text from chat_members where room_id = ${r.id} and user_id = ${u.id}`;
  const rows = await sql<{ id: string }[]>`select id::text from chat_messages where room_id = ${r.id} and id > ${me?.joined_after_id ?? '0'}::bigint and deleted_at is null and kind <> 'system'
    and (regexp_replace(body, '@\\[([^\\]]+)\\]\\([0-9a-f-]{36}\\)', '@\\1', 'g') ilike ${like} or file_name ilike ${like}) order by id desc limit 301`;
  return { ids: rows.slice(0, 300).map((x) => x.id), more: rows.length > 300 };
}

/** "업무로 만들기": 메시지에서 제목·마감·담당 제안(AI 가 켜져 있으면 AI, 아니면 첫 줄). 실제 생성은 사람이 확인 후 업무 등록 창에서 */
export async function messageToTaskSuggestion(u: SessionUser, id: string) {
  const sql = db();
  const m = await ownMessage(u, id, sql);
  const [x] = await sql<{ body: string; author_id: string | null; created_at: Date }[]>`select body, author_id, created_at from chat_messages where id = ${m.id}::bigint and deleted_at is null`;
  if (!x) throw notFound();
  const plain = x.body.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1');
  const mentioned = [...x.body.matchAll(/@\[[^\]]{1,50}\]\(([0-9a-f-]{36})\)/g)].map((y) => y[1]);
  let out = { title: plain.split('\n')[0].slice(0, 120) || '메시지에서 만든 업무', dueDate: null as string | null, assigneeId: mentioned[0] ?? null, description: plain, by: 'rule' as 'rule' | 'ai' };
  const { aiEnabled, anthropicProvider, costUsd } = await import('./ai/provider');
  if (aiEnabled() && await (await import('./plans')).assertAiRequest(u).then(() => true, () => false)) {
    try {
      const p = anthropicProvider({ tier: 'fast' });
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
      const r = await p.chat({ system: `사내 메신저 메시지를 업무 하나로 바꿉니다. 오늘은 ${today}(서울). 제목은 짧게(동사로 끝), 마감은 메시지에 날짜·요일·"내일" 등이 있을 때만 YYYY-MM-DD, 없으면 빈 문자열.`,
        tools: [], format: { type: 'object', additionalProperties: false, required: ['title', 'dueDate'], properties: { title: { type: 'string' }, dueDate: { type: 'string' } } },
        messages: [{ role: 'user', content: plain.slice(0, 3000) }] });
      const j = JSON.parse(r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''));
      out = { ...out, title: String(j.title || out.title).slice(0, 120), dueDate: /^\d{4}-\d{2}-\d{2}$/.test(j.dueDate) ? j.dueDate : null, by: 'ai' };
      await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
        values (${tenantOf(u)}, ${u.id}, ${crypto.randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0},
          ${r.usage.cache_creation_input_tokens ?? 0}, ${costUsd(r.model ?? p.model, r.usage)}, 'chat_to_task')`;
    } catch { /* 첫 줄 규칙으로 */ }
  }
  return { ...out, messageId: m.id, roomId: m.room_id };
}
export async function linkTask(u: SessionUser, id: string, taskId: string) {
  const sql = db();
  const m = await ownMessage(u, id, sql);
  await loadTaskForUser(u, taskId, sql);
  await sql`update chat_messages set task_id = ${taskId} where id = ${m.id}::bigint`;
  return { ok: true };
}

/** 대표만: 감사 목적 내보내기 (CSV). 내보낸 기록은 감사 로그에 남는다 */
export async function exportRoom(u: SessionUser, roomId: string, ip: string | null) {
  if (u.role !== 'owner' || u.isDemo) throw forbidden('대표만 내보낼 수 있습니다');
  const sql = db();
  const [r] = await sql<{ id: string; tenant: string }[]>`select id, tenant from chat_rooms where id = ${roomId}`;
  if (!r || r.tenant !== tenantOf(u)) throw notFound('대화방이 없습니다');
  const rows = await sql<{ id: string; created_at: Date; author: string | null; body: string; file_name: string | null; deleted_at: Date | null }[]>`
    select m.id::text, m.created_at, us.name as author, m.body, m.file_name, m.deleted_at from chat_messages m left join users us on us.id = m.author_id where m.room_id = ${roomId} order by m.id`;
  await audit(sql, u.id, 'chat.export', 'chat_room', roomId, { count: rows.length }, ip);
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return ['시각,보낸 사람,내용,파일,삭제', ...rows.map((x) => [x.created_at.toISOString(), x.author ?? '', x.body, x.file_name ?? '', x.deleted_at ? '삭제됨' : ''].map((v) => esc(String(v))).join(','))].join('\n');
}

/** 메신저 1차 B5: 전달 — 여러 방에 같은 내용(파일은 같은 저장 키를 가리킴)을 보낸다. 시스템 메시지·삭제된 메시지는 못 보냄 */
export async function forwardMessage(u: SessionUser, id: string, roomIds: string[]) {
  const sql = db();
  const m = await ownMessage(u, id, sql);
  if (m.deleted_at) throw badRequest('삭제된 메시지는 전달할 수 없습니다');
  const [src] = await sql<{ body: string; file_key: string | null; file_name: string | null; file_mime: string | null; file_size: number | null; kind: string; sticker: string | null; event_id: string | null; author_name: string | null }[]>`
    select m.body, m.file_key, m.file_name, m.file_mime, m.file_size, m.kind, m.sticker, m.event_id, au.name as author_name from chat_messages m left join users au on au.id = m.author_id where m.id = ${id}::bigint`;
  if (src.kind === 'system') throw badRequest('안내 메시지는 전달할 수 없습니다');
  if (src.kind === 'poll') throw badRequest('투표는 전달할 수 없습니다 — 새 투표를 만들어 주세요');
  const sent: string[] = [];
  for (const roomId of [...new Set(roomIds)].slice(0, 10)) {
    const r = await loadRoom(u, roomId, sql);
    const [n] = await sql<{ id: string }[]>`insert into chat_messages (room_id, author_id, body, file_key, file_name, file_mime, file_size, kind, forward_of, sticker, event_id)
      values (${r.id}, ${u.id}, ${src.body}, ${src.file_key}, ${src.file_name}, ${src.file_mime}, ${src.file_size}, 'forward', ${id}::bigint, ${src.sticker}, ${src.event_id}) returning id::text`;
    await sql`update chat_rooms set last_message_at = now() where id = ${r.id}`;
    await sql`update chat_members set last_read_id = ${n.id}::bigint where room_id = ${r.id} and user_id = ${u.id}`;
    const members = await sql<{ user_id: string; notify: NotifyLevel }[]>`select user_id, notify from chat_members where room_id = ${r.id}`;
    const roomName = r.kind === 'dm' ? u.name : r.name ?? '대화';
    await notify(sql, { userIds: members.filter((x) => x.user_id !== u.id && x.notify === 'all').map((x) => x.user_id), type: 'chat', title: roomName, body: `${u.name}: (전달) ${(src.body || `📎 ${src.file_name}`).slice(0, 100)}`,
      link: `/messages?room=${r.id}`, entityType: 'chat_room', entityId: r.id, actorId: u.id, dedupeKey: `chat:${n.id}`, meta: { messageId: n.id } });
    sent.push(n.id);
  }
  return { ok: true, sent };
}
/** 메신저 2차 B9 투표하기 — 고른 보기로 바꿈(빈 배열 = 투표 취소). 마감 뒤·초대 전 투표는 못 함 */
export async function votePoll(u: SessionUser, id: string, picks: number[]) {
  const sql = db();
  const m = await ownMessage(u, id, sql);
  if (m.deleted_at || m.kind !== 'poll') throw notFound('투표가 없습니다');
  const [me] = await sql<{ joined_after_id: string }[]>`select joined_after_id::text from chat_members where room_id = ${m.room_id} and user_id = ${u.id}`;
  if (me && BigInt(me.joined_after_id) >= BigInt(m.id)) throw notFound('투표가 없습니다');
  const [p] = await sql<{ options: string[]; multi: boolean; closed: boolean }[]>`
    select options, multi, (closed_at is not null or (closes_at is not null and closes_at <= now())) as closed from chat_polls where message_id = ${m.id}::bigint`;
  if (!p) throw notFound('투표가 없습니다');
  if (p.closed) throw badRequest('마감된 투표입니다');
  const pick = [...new Set(picks)].sort((a, b) => a - b);
  if (pick.some((x) => !Number.isInteger(x) || x < 0 || x >= p.options.length)) throw badRequest('없는 보기입니다');
  if (!p.multi && pick.length > 1) throw badRequest('하나만 고를 수 있는 투표입니다');
  await sql.begin(async (tx) => {
    await tx`delete from chat_poll_votes where message_id = ${m.id}::bigint and user_id = ${u.id}`;
    for (const x of pick) await tx`insert into chat_poll_votes (message_id, user_id, option_idx) values (${m.id}::bigint, ${u.id}, ${x})`;
    await tx`update chat_messages set reacted_at = now() where id = ${m.id}::bigint`; // 다른 사람 화면의 표 수도 실시간으로
  });
  return { ok: true, mine: pick };
}
/** 투표 마감: 만든 사람·방장·대표·관리자. 마감 안내는 방에 시스템 메시지로 */
export async function closePoll(u: SessionUser, id: string) {
  const sql = db();
  const m = await ownMessage(u, id, sql);
  if (m.deleted_at || m.kind !== 'poll') throw notFound('투표가 없습니다');
  if (m.author_id !== u.id && !canManage(u, m.room)) throw forbidden('투표를 만든 사람이나 방장만 마감할 수 있습니다');
  const [p] = await sql<{ question: string }[]>`update chat_polls set closed_at = now(), closed_by = ${u.id} where message_id = ${m.id}::bigint and closed_at is null returning question`;
  if (!p) return { ok: true, already: true };
  await sql`update chat_messages set reacted_at = now() where id = ${m.id}::bigint`;
  await systemMessage(sql, m.room_id, `${u.name}님이 투표를 마감했습니다: ${p.question}`);
  return { ok: true };
}

/** B9 일정 잡기: 대화방에서 캘린더 일정을 만들고(참석자 = 방 참여자, 고를 수 있음) 방에 일정 카드를 남긴다. 참석자에게는 캘린더 '일정 초대' 알림이 가므로 대화 알림은 따로 안 보냄 */
export const roomEventInput = z.object({
  title: z.string().trim().min(1, '제목을 입력하세요').max(200),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  allDay: z.boolean().optional(),
  location: z.string().trim().max(300).optional(),
  description: z.string().max(5000).optional(),
  attendeeIds: z.array(z.string().uuid()).max(100).optional(),
  fromMessage: z.string().regex(/^\d+$/).max(20).optional(),
});
export async function scheduleInRoom(u: SessionUser, roomId: string, i: z.infer<typeof roomEventInput>) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  const memberIds = (await sql<{ user_id: string }[]>`select cm.user_id from chat_members cm join users us on us.id = cm.user_id where cm.room_id = ${r.id} and us.status = 'active'`).map((x) => x.user_id);
  const others = [...new Set(i.attendeeIds ?? memberIds)].filter((x) => x !== u.id);
  if (others.some((x) => !memberIds.includes(x))) throw badRequest('이 대화방에 없는 사람이 있습니다');
  if (others.length > 99) throw badRequest('참석자는 100명까지입니다 — 참석자를 골라 주세요');
  let note = '';
  if (i.fromMessage) {
    const [src] = await sql<{ body: string }[]>`select body from chat_messages where id = ${i.fromMessage}::bigint and room_id = ${r.id} and deleted_at is null`;
    note = (src?.body ?? '').replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1').slice(0, 1000);
  }
  const roomName = r.kind === 'dm' ? '1:1 대화' : r.kind === 'task' && !r.name ? (await sql<{ title: string }[]>`select title from tasks where id = ${r.task_id}`)[0]?.title ?? '업무 대화' : r.name ?? '대화';
  const { ensurePersonalCalendar } = await import('./access');
  const calendarId = await ensurePersonalCalendar(u.id, u.name, sql);
  const { createEvent } = await import('./events');
  const ev = await createEvent(u, { calendarId, title: i.title, start: i.start, end: i.end, allDay: i.allDay ?? false, location: i.location || undefined,
    description: [i.description?.trim(), note && `메시지: ${note}`, `메신저 "${roomName}"에서 잡은 일정`].filter(Boolean).join('\n\n'), attendeeIds: [u.id, ...others] });
  const body = `📅 ${i.title} · ${whenText(new Date(i.start), new Date(i.end), !!i.allDay)}`;
  const [m] = await sql<{ id: string }[]>`insert into chat_messages (room_id, author_id, body, kind, event_id) values (${r.id}, ${u.id}, ${body}, 'event', ${ev.id}) returning id::text`;
  await sql`update chat_rooms set last_message_at = now() where id = ${r.id}`;
  await sql`update chat_members set last_read_id = ${m.id}::bigint where room_id = ${r.id} and user_id = ${u.id}`;
  return { id: m.id, eventId: ev.id, calendarId, invited: others.length };
}

/** 메신저 1차 B7: 이 메시지를 아직 안 읽은 사람 이름 */
export async function unreadNames(u: SessionUser, id: string) {
  const sql = db();
  const m = await ownMessage(u, id, sql);
  const rows = await sql<{ name: string }[]>`select us.name from chat_members cm join users us on us.id = cm.user_id where cm.room_id = ${m.room_id} and cm.user_id is distinct from ${m.author_id} and cm.last_read_id < ${id}::bigint and cm.joined_after_id < ${id}::bigint order by us.name`;
  return { names: rows.map((r) => r.name) };
}
/** 메신저 1차 A2: 방 정보 — 사진·파일·링크 모아보기(초대 이후 것만) */
export async function roomMedia(u: SessionUser, roomId: string) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  const [me] = await sql<{ joined_after_id: string }[]>`select joined_after_id::text from chat_members where room_id = ${r.id} and user_id = ${u.id}`;
  const after = me?.joined_after_id ?? '0';
  const files = await sql`select m.id::text as id, m.file_name, m.file_mime, m.file_size, m.created_at, au.name as author_name from chat_messages m left join users au on au.id = m.author_id
    where m.room_id = ${r.id} and m.id > ${after}::bigint and m.deleted_at is null and m.file_key is not null order by m.id desc limit 200`;
  const linkRows = await sql<{ id: string; body: string; created_at: Date; author_name: string | null }[]>`select m.id::text as id, m.body, m.created_at, au.name as author_name from chat_messages m left join users au on au.id = m.author_id
    where m.room_id = ${r.id} and m.id > ${after}::bigint and m.deleted_at is null and m.body ~ 'https?://' order by m.id desc limit 200`;
  const links = linkRows.flatMap((x) => (x.body.match(/https?:\/\/[^\s<]+/g) ?? []).map((url) => ({ id: x.id, url, created_at: x.created_at, author_name: x.author_name })));
  return { images: files.filter((f: any) => /^image\//.test(f.file_mime ?? '')), files: files.filter((f: any) => !/^image\//.test(f.file_mime ?? '')), links };
}
