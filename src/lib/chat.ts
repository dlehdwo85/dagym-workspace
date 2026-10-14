import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, forbidden, notFound } from './errors';
import { loadTaskForUser } from './access';
import { notify } from './notifications';
import { audit } from './log';
import { MAX_UPLOAD_BYTES, downloadUrl, objectSize, uploadTarget } from './storage';
import type { SessionUser } from './types';

/**
 * V13 10번 사내 메신저. 방 종류: 1:1(dm) · 그룹(group) · 회사 전체(company, 자동) · 업무별(task).
 * - 회사(tenant)별로 분리. 체험 계정은 'demo' 회사로 따로.
 * - 접근: dm·group = 멤버만 / company = 같은 회사 직원 모두(자동 가입) / task = 그 업무를 볼 수 있는 사람(자동 가입).
 *   볼 수 없는 방은 404 (있는 줄도 모르게).
 */
const tenantOf = (u: SessionUser) => (u.isDemo ? 'demo' : 'default');
type Room = { id: string; tenant: string; kind: 'dm' | 'group' | 'company' | 'task' | 'team'; name: string | null; task_id: string | null; dm_key: string | null; team_id?: string | null };

async function companyRoom(u: SessionUser, sql: Sql) {
  const t = tenantOf(u);
  await sql`insert into chat_rooms (tenant, kind, name) values (${t}, 'company', '회사 전체') on conflict do nothing`;
  const [r] = await sql<{ id: string }[]>`select id from chat_rooms where tenant = ${t} and kind = 'company'`;
  // V14 14번: 회사 전체방은 모든 직원이 자동 참여 (한 번도 메시지 화면을 안 연 사람도)
  await sql`insert into chat_members (room_id, user_id) select ${r.id}, id from users where status = 'active' and is_demo = ${t === 'demo'} on conflict do nothing`;
  return r.id;
}

/** 방 접근 확인 (+ 회사·업무 방은 자동 가입). 못 보면 404 */
export async function loadRoom(u: SessionUser, roomId: string, sql: Sql = db()): Promise<Room> {
  if (!/^[0-9a-f-]{36}$/.test(roomId)) throw notFound('대화방이 없습니다');
  const [r] = await sql<Room[]>`select id, tenant, kind, name, task_id, dm_key, team_id from chat_rooms where id = ${roomId}`;
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
    select r.id, r.kind, r.task_id, r.last_message_at, m.muted, m.last_read_id,
      case when r.kind = 'dm' then (select ou.name from chat_members om join users ou on ou.id = om.user_id where om.room_id = r.id and om.user_id <> ${u.id} limit 1)
           when r.kind = 'task' then coalesce(r.name, t.title) else r.name end as name,
      case when r.kind = 'dm' then (select om.user_id from chat_members om where om.room_id = r.id and om.user_id <> ${u.id} limit 1) end as other_id,
      (select count(*)::int from chat_members cm where cm.room_id = r.id) as member_count,
      (select count(*)::int from chat_messages x where x.room_id = r.id and x.id > m.last_read_id and x.deleted_at is null and x.author_id is distinct from ${u.id}) as unread,
      lm.body as last_body, lm.file_name as last_file, lu.name as last_author, lm.deleted_at is not null as last_deleted
    from chat_members m join chat_rooms r on r.id = m.room_id
      left join tasks t on t.id = r.task_id
      left join lateral (select * from chat_messages x where x.room_id = r.id order by x.id desc limit 1) lm on true
      left join users lu on lu.id = lm.author_id
    where m.user_id = ${u.id} and r.tenant = ${tenantOf(u)} and (r.kind <> 'task' or t.deleted_at is null)
    order by (r.kind = 'company') desc, coalesce(r.last_message_at, r.created_at) desc`;
  return { rooms, unread: rooms.reduce((a: number, r: any) => a + (r.muted ? 0 : r.unread), 0) };
}

export async function unreadTotal(u: SessionUser) {
  const [r] = await db()<{ n: number }[]>`select coalesce(sum((select count(*) from chat_messages x where x.room_id = m.room_id and x.id > m.last_read_id
      and x.deleted_at is null and x.author_id is distinct from ${u.id})), 0)::int n from chat_members m where m.user_id = ${u.id} and not m.muted`;
  return r.n;
}

export const roomInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dm'), userId: z.string().uuid() }),
  z.object({ kind: z.literal('group'), name: z.string().trim().min(1).max(60), userIds: z.array(z.string().uuid()).min(1).max(100) }),
  z.object({ kind: z.literal('task'), taskId: z.string().uuid() }),
]);
/** 같은 회사의 활동 중인 사람만 초대할 수 있다 */
async function sameTenantUsers(u: SessionUser, ids: string[], sql: Sql) {
  const rows = await sql<{ id: string }[]>`select id from users where id = any(${ids}::uuid[]) and status = 'active' and is_demo = ${!!u.isDemo}`;
  if (rows.length !== new Set(ids).size) throw badRequest('초대할 수 없는 사람이 있습니다');
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
    const [r] = await sql<{ id: string }[]>`insert into chat_rooms (tenant, kind, name, created_by) values (${t}, 'group', ${i.name}, ${u.id}) returning id`;
    for (const id of [u.id, ...ids]) await sql`insert into chat_members (room_id, user_id) values (${r.id}, ${id}) on conflict do nothing`;
    return { id: r.id };
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
  for (const id of await sameTenantUsers(u, userIds, sql)) await sql`insert into chat_members (room_id, user_id) values (${r.id}, ${id}) on conflict do nothing`;
  return { ok: true };
}
export async function leaveRoom(u: SessionUser, roomId: string) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  if (r.kind !== 'group') throw badRequest('그룹 대화만 나갈 수 있습니다');
  await sql`delete from chat_members where room_id = ${r.id} and user_id = ${u.id}`;
  return { ok: true };
}
export async function setMuted(u: SessionUser, roomId: string, muted: boolean) {
  const sql = db();
  await loadRoom(u, roomId, sql);
  await sql`update chat_members set muted = ${muted} where room_id = ${roomId} and user_id = ${u.id}`;
  return { ok: true };
}

const MSG_COLS = (sql: Sql, u: SessionUser) => sql`m.id::text as id, m.room_id, m.author_id, au.name as author_name, m.created_at, m.edited_at, m.pinned_at,
  case when m.deleted_at is null then m.body else '' end as body, (m.deleted_at is not null) as deleted,
  case when m.deleted_at is null then m.file_name end as file_name, case when m.deleted_at is null then m.file_mime end as file_mime,
  case when m.deleted_at is null then m.file_size end as file_size, m.task_id, (m.author_id = ${u.id}) as mine`;

export async function roomDetail(u: SessionUser, roomId: string, q: { before?: string; q?: string }) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  const like = q.q ? '%' + q.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%' : null;
  const messages = (await sql`select ${MSG_COLS(sql, u)} from chat_messages m left join users au on au.id = m.author_id
    where m.room_id = ${r.id} ${q.before ? sql`and m.id < ${q.before}::bigint` : sql``} ${like ? sql`and m.deleted_at is null and (m.body ilike ${like} or m.file_name ilike ${like})` : sql``}
    order by m.id desc limit 60`).reverse();
  const members = await sql`select cm.user_id as id, us.name, cm.last_read_id::text as last_read_id from chat_members cm join users us on us.id = cm.user_id where cm.room_id = ${r.id} order by us.name`;
  const pinned = await sql`select ${MSG_COLS(sql, u)} from chat_messages m left join users au on au.id = m.author_id where m.room_id = ${r.id} and m.pinned_at is not null and m.deleted_at is null order by m.pinned_at desc limit 10`;
  const [me] = await sql<{ muted: boolean }[]>`select muted from chat_members where room_id = ${r.id} and user_id = ${u.id}`;
  let name = r.name;
  if (r.kind === 'dm') name = (members as any[]).find((m) => m.id !== u.id)?.name ?? '대화';
  if (r.kind === 'task') name = (await sql<{ title: string }[]>`select title from tasks where id = ${r.task_id}`)[0]?.title ?? '업무';
  return { room: { id: r.id, kind: r.kind, name, taskId: r.task_id, muted: me?.muted ?? false }, messages, members, pinned };
}

export const messageInput = z.object({
  body: z.string().max(5000).default(''),
  file: z.object({ key: z.string().max(400), name: z.string().max(200), mime: z.string().max(100), size: z.number().int().positive() }).optional(),
});
export async function sendMessage(u: SessionUser, roomId: string, i: z.infer<typeof messageInput>) {
  const sql = db();
  const r = await loadRoom(u, roomId, sql);
  const body = i.body.trim();
  if (!body && !i.file) throw badRequest('내용을 입력하세요');
  if (i.file) {
    if (!i.file.key.startsWith(`chat/${r.tenant}/${r.id}/`)) throw badRequest('잘못된 파일입니다');
    if ((await objectSize(i.file.key)) === null) throw badRequest('업로드된 파일을 찾을 수 없습니다. 다시 올려 주세요.');
  }
  const mentionIds = [...body.matchAll(/@\[[^\]]{1,50}\]\(([0-9a-f-]{36})\)/g)].map((m) => m[1]);
  const members = (await sql<{ user_id: string; muted: boolean }[]>`select user_id, muted from chat_members where room_id = ${r.id}`);
  const memberIds = members.map((m) => m.user_id);
  // 업무 방은 업무를 볼 수 있지만 아직 방을 연 적 없는 담당·지시자에게도 알린다
  if (r.kind === 'task') {
    const [t] = await sql<{ assignee_id: string | null; requested_by: string | null; created_by: string }[]>`select assignee_id, requested_by, created_by from tasks where id = ${r.task_id}`;
    for (const id of [t?.assignee_id, t?.requested_by, t?.created_by]) if (id && !memberIds.includes(id)) {
      await sql`insert into chat_members (room_id, user_id) values (${r.id}, ${id}) on conflict do nothing`; memberIds.push(id); members.push({ user_id: id, muted: false });
    }
  }
  const mentions = mentionIds.filter((x) => memberIds.includes(x));
  const [m] = await sql<{ id: string; created_at: Date }[]>`insert into chat_messages (room_id, author_id, body, mentions, file_key, file_name, file_mime, file_size)
    values (${r.id}, ${u.id}, ${body}, ${mentions}, ${i.file?.key ?? null}, ${i.file?.name ?? null}, ${i.file?.mime ?? null}, ${i.file?.size ?? null}) returning id::text, created_at`;
  await sql`update chat_rooms set last_message_at = now() where id = ${r.id}`;
  await sql`update chat_members set last_read_id = ${m.id}::bigint where room_id = ${r.id} and user_id = ${u.id}`;
  await sql`delete from chat_typing where room_id = ${r.id} and user_id = ${u.id}`;
  // 푸시: 알림 끈 방은 제외(멘션은 예외), 보낸 사람 제외. 알림 목록에는 쌓지 않는다(메시지 화면이 따로 있음)
  const roomName = r.kind === 'dm' ? u.name : r.kind === 'task' ? `업무 대화 · ${(await sql<{ title: string }[]>`select title from tasks where id = ${r.task_id}`)[0]?.title ?? ''}` : r.name ?? '대화';
  const preview = (body.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1') || `📎 ${i.file?.name}`).slice(0, 120);
  const targets = members.filter((x) => x.user_id !== u.id && (!x.muted || mentions.includes(x.user_id))).map((x) => x.user_id);
  await notify(sql, { userIds: targets, type: 'chat', title: roomName, body: r.kind === 'dm' ? preview : `${u.name}: ${preview}`,
    link: `/messages?room=${r.id}`, entityType: 'chat_room', entityId: r.id, actorId: u.id, dedupeKey: `chat:${m.id}` });
  return { id: m.id, createdAt: m.created_at, notified: targets };
}

async function ownMessage(u: SessionUser, id: string, sql: Sql) {
  if (!/^\d+$/.test(id)) throw notFound();
  const [m] = await sql<{ id: string; room_id: string; author_id: string | null; deleted_at: Date | null }[]>`select id::text, room_id, author_id, deleted_at from chat_messages where id = ${id}::bigint`;
  if (!m) throw notFound('메시지가 없습니다');
  await loadRoom(u, m.room_id, sql);
  return m;
}
export async function editMessage(u: SessionUser, id: string, body: string) {
  const sql = db();
  const m = await ownMessage(u, id, sql);
  if (m.author_id !== u.id || m.deleted_at) throw forbidden('내가 보낸 메시지만 고칠 수 있습니다');
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
  await sql`update chat_messages set pinned_at = ${pin ? sql`now()` : null}, pinned_by = ${pin ? u.id : null} where id = ${id}::bigint`;
  return { ok: true };
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
  if (i.size > MAX_UPLOAD_BYTES) throw badRequest(`파일은 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 까지 올릴 수 있습니다`);
  if (/\.(exe|bat|cmd|com|msi|scr|ps1|vbs|jar|apk|ipa|dll|sh)$/i.test(i.fileName)) throw badRequest('실행 파일은 올릴 수 없습니다');
  await (await import('./plans')).assertStorage(u, i.size);
  const key = `chat/${r.tenant}/${r.id}/${crypto.randomUUID()}/${i.fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120)}`;
  return { key, upload: await uploadTarget(key, i.mime || 'application/octet-stream') };
}
export async function fileDownload(u: SessionUser, id: string, inline: boolean) {
  const sql = db();
  const m = await ownMessage(u, id, sql);
  const [f] = await sql<{ file_key: string | null; file_name: string; file_mime: string }[]>`select file_key, file_name, file_mime from chat_messages where id = ${m.id}::bigint and deleted_at is null`;
  if (!f?.file_key) throw notFound();
  return downloadUrl(f.file_key, f.file_name, inline && /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/.test(f.file_mime));
}

/** 실시간: 마지막으로 본 id 이후 새 메시지·수정·입력 중. SSE 와 폴링이 같이 쓴다 */
export async function changesSince(u: SessionUser, since: string, sinceTime: Date) {
  const sql = db();
  const rows = await sql`select ${MSG_COLS(sql, u)} from chat_messages m join chat_members cm on cm.room_id = m.room_id and cm.user_id = ${u.id}
    left join users au on au.id = m.author_id
    where m.id > ${since}::bigint or (m.edited_at > ${sinceTime} or m.deleted_at > ${sinceTime} or m.pinned_at > ${sinceTime})
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
    left join users au on au.id = m.author_id where m.deleted_at is null and (m.body ilike ${like} or m.file_name ilike ${like}) order by m.id desc limit 50` };
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
