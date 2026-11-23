// #1135 메모 · 주요 메모(대표 11/23 · 설계 docs/research/SECURE_MEMO_DESIGN_2026-11-23.md)
// - 메모마다 볼 사람(사람·부서 + 보기/고치기). 기본 = 만든 사람만. 대표·관리자도 자동으로 보지 못함(권한 없으면 404)
// - 주요 메모의 아이디·비밀번호·참고는 암호문으로만 저장(memoVault). 목록·상세 응답에는 절대 넣지 않고, [보기]·[복사] 때만 따로(본인 확인 10분 안)
// - 모든 보기·복사·고치기·볼 사람 바꾸기를 감사 기록(값은 기록하지 않음). AI·알림·메일·내보내기·검색에는 넣지 않는다(이 파일 밖에서 memos 를 읽지 않음)
import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, forbidden, HttpError, notFound } from './errors';
import { audit } from './log';
import { isUuid } from './access';
import { requireMenu } from './menuPerms';
import { decrypt, verifyPassword } from './crypto';
import { verifyTotp } from './totp';
import { openSecret, sealSecret, vaultReady, VAULT_VER, type MemoSecret } from './memoVault';
import { tenantOf, type SessionUser } from './types';
import { zUuid } from './api';

const UNLOCK_MIN = 10;
type Level = 'view' | 'edit';
type MemoRow = { id: string; kind: 'note' | 'secret'; title: string; body: string | null; site_url: string | null; secret_ct: string | null; created_by: string; level: Level | null; deleted_at: Date | null };

async function gate(u: SessionUser) {
  if (u.support) throw notFound(); // 지원 모드(플랫폼 운영자가 고객사 화면을 보는 중)에는 메모를 아예 보이지 않음
  await requireMenu(u, 'memos', 'use');
}

/** 나의 부서와 그 위 부서들 — 부서에 공유된 메모는 그 부서와 아래 부서 사람 모두가 받는다 */
const myUnits = (sql: Sql, u: SessionUser) => sql`with recursive my_units as (
    select o.id, o.parent_id from org_units o join memberships mb on mb.org_unit_id = o.id where mb.user_id = ${u.id} and o.tenant = ${tenantOf(u)}
    union select p.id, p.parent_id from org_units p join my_units c on p.id = c.parent_id
  )`;
/** 이 메모에서 나의 단계(없으면 null) — 만든 사람은 늘 '고치기' */
const levelOf = (sql: Sql, u: SessionUser) => sql`(case when m.created_by = ${u.id} then 'edit'
    when exists (select 1 from memo_access a where a.memo_id = m.id and a.level = 'edit' and (a.user_id = ${u.id} or a.org_unit_id in (select id from my_units))) then 'edit'
    when exists (select 1 from memo_access a where a.memo_id = m.id and (a.user_id = ${u.id} or a.org_unit_id in (select id from my_units))) then 'view' end)`;

async function loadMemo(u: SessionUser, id: string, need: Level = 'view', opts: { deleted?: boolean } = {}) {
  if (!isUuid(id)) throw notFound();
  const sql = db();
  const [m] = await sql<MemoRow[]>`${myUnits(sql, u)}
    select m.id, m.kind, m.title, m.body, m.site_url, m.secret_ct, m.created_by, m.deleted_at, ${levelOf(sql, u)} as level
    from memos m where m.id = ${id} and m.tenant = ${tenantOf(u)}`;
  if (!m || !m.level || (!!m.deleted_at !== !!opts.deleted)) throw notFound();
  if (need === 'edit' && m.level !== 'edit') throw forbidden('이 메모를 고칠 권한이 없습니다 — 만든 사람이나 고치기 권한을 받은 사람에게 요청하세요');
  return m;
}

/** 사이트 주소: http(s) 만(자바스크립트 주소 등 막음). 'example.com' 처럼 적으면 그대로 두고 화면이 https:// 를 붙여 연다 */
function cleanUrl(s: string | undefined | null) {
  const v = (s ?? '').trim();
  if (!v) return null;
  const m = v.match(/^([a-z][a-z0-9+.-]*):/i);
  if (m && !/^https?$/i.test(m[1])) throw badRequest('사이트 주소는 http:// 또는 https:// 로 시작하거나 example.com 처럼 적어 주세요');
  return v;
}

const accessItem = z.object({ userId: zUuid.optional(), unitId: zUuid.optional(), level: z.enum(['view', 'edit']) })
  .refine((x) => !!x.userId !== !!x.unitId, '사람이나 부서 중 하나를 고르세요');
type AccessItem = z.infer<typeof accessItem>;
const secretFields = { username: z.string().max(300).optional(), password: z.string().max(500).optional(), note: z.string().max(5000).optional() };
export const memoInput = z.object({
  kind: z.enum(['note', 'secret']),
  title: z.string().trim().min(1, '제목을 적어 주세요').max(120),
  body: z.string().max(20000).optional(),
  siteUrl: z.string().trim().max(500).optional(),
  ...secretFields,
  access: z.array(accessItem).max(200).default([]),
});
export const memoUpdateInput = z.object({
  title: z.string().trim().min(1, '제목을 적어 주세요').max(120).optional(),
  body: z.string().max(20000).optional(),
  siteUrl: z.string().trim().max(500).optional(),
  ...secretFields,
});
export const memoAccessInput = z.object({ access: z.array(accessItem).max(200) });
export const revealInput = z.object({ fields: z.array(z.enum(['username', 'password', 'note'])).min(1).max(3), purpose: z.enum(['view', 'copy']).default('view') });
export const unlockInput = z.object({ password: z.string().max(200).optional(), code: z.string().trim().max(8).optional() });

/** 볼 사람 목록 검사: 같은 회사의 사용 중인 사람·부서만, 만든 사람은 빼고(늘 고치기), 같은 대상이 두 번이면 높은 단계 */
async function cleanAccess(sql: Sql, u: SessionUser, creatorId: string, list: AccessItem[]) {
  const t = tenantOf(u);
  const users = [...new Set(list.filter((x) => x.userId && x.userId !== creatorId).map((x) => x.userId!))];
  const units = [...new Set(list.filter((x) => x.unitId).map((x) => x.unitId!))];
  if (users.length) {
    const ok = await sql<{ id: string }[]>`select id from users where id = any(${users}) and tenant = ${t} and status in ('active', 'invited') and deleted_at is null`;
    if (ok.length !== users.length) throw badRequest('같은 회사의 사용 중인 사람만 고를 수 있습니다');
  }
  if (units.length) {
    const ok = await sql<{ id: string }[]>`select id from org_units where id = any(${units}) and tenant = ${t}`;
    if (ok.length !== units.length) throw badRequest('같은 회사의 부서만 고를 수 있습니다');
  }
  const out = new Map<string, { userId: string | null; unitId: string | null; level: Level }>();
  for (const x of list) {
    if (x.userId === creatorId) continue;
    const key = x.userId ? `u:${x.userId}` : `o:${x.unitId}`;
    const prev = out.get(key);
    if (!prev || (prev.level === 'view' && x.level === 'edit')) out.set(key, { userId: x.userId ?? null, unitId: x.unitId ?? null, level: x.level });
  }
  return [...out.values()];
}
async function writeAccess(sql: Sql, memoId: string, rows: { userId: string | null; unitId: string | null; level: Level }[]) {
  await sql`delete from memo_access where memo_id = ${memoId}`;
  for (const r of rows) await sql`insert into memo_access (memo_id, user_id, org_unit_id, level) values (${memoId}, ${r.userId}, ${r.unitId}, ${r.level})`;
}

async function unlockedUntil(sql: Sql, u: SessionUser) {
  const [s] = await sql<{ until: Date | null }[]>`select case when memo_unlocked_until > now() then memo_unlocked_until end as until from sessions where id = ${u.sessionId ?? ''} and revoked_at is null`;
  return s?.until ?? null;
}
async function authMethod(sql: Sql, u: SessionUser) {
  const [r] = await sql<{ pw: boolean; totp: boolean }[]>`select password_hash is not null as pw, (totp_enabled_at is not null and totp_secret is not null) as totp from users where id = ${u.id}`;
  return r?.totp ? 'totp' as const : r?.pw ? 'password' as const : 'relogin' as const;
}

/** 메모 화면 첫 정보: 주요 메모를 쓸 수 있는지(키), 본인 확인이 언제까지인지, 확인 방법 */
export async function memoStatus(u: SessionUser) {
  await gate(u);
  const sql = db();
  return { secretReady: vaultReady(), unlockedUntil: await unlockedUntil(sql, u), method: await authMethod(sql, u), unlockMinutes: UNLOCK_MIN };
}

export async function listMemos(u: SessionUser, q: { kind?: string | null; q?: string | null; deleted?: boolean }) {
  await gate(u);
  const sql = db();
  const kind = q.kind === 'note' || q.kind === 'secret' ? q.kind : '';
  const term = (q.q ?? '').trim().slice(0, 100);
  const like = `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const rows = await sql<any[]>`${myUnits(sql, u)}
    select * from (
      select m.id, m.kind, m.title, case when m.kind = 'note' then left(m.body, 160) end as preview, m.site_url, m.created_at, m.updated_at, m.deleted_at,
        m.created_by, cu.name as creator_name, ${levelOf(sql, u)} as level,
        (select count(*) filter (where a.user_id is not null) from memo_access a where a.memo_id = m.id)::int as share_users,
        (select count(*) filter (where a.org_unit_id is not null) from memo_access a where a.memo_id = m.id)::int as share_units
      from memos m left join users cu on cu.id = m.created_by
      where m.tenant = ${tenantOf(u)} and ${q.deleted ? sql`m.deleted_at is not null` : sql`m.deleted_at is null`}
        and (${kind} = '' or m.kind = ${kind})
        and (${term} = '' or m.title ilike ${like} or coalesce(m.site_url, '') ilike ${like} or (m.kind = 'note' and coalesce(m.body, '') ilike ${like}))
    ) x where x.level is not null ${q.deleted ? sql`and x.level = 'edit'` : sql``}
    order by ${q.deleted ? sql`x.deleted_at desc` : sql`x.updated_at desc`} limit 300`;
  return { memos: rows, secretReady: vaultReady() };
}

export async function getMemo(u: SessionUser, id: string) {
  await gate(u);
  const m = await loadMemo(u, id);
  const sql = db();
  const access = await sql<any[]>`select a.user_id, a.org_unit_id, a.level, x.name as user_name, x.status as user_status, o.name as unit_name
    from memo_access a left join users x on x.id = a.user_id left join org_units o on o.id = a.org_unit_id where a.memo_id = ${m.id} order by a.level desc, coalesce(x.name, o.name)`;
  const [c] = await sql<{ name: string; updated_at: Date; created_at: Date; updater: string | null }[]>`select cu.name, m.updated_at, m.created_at, uu.name as updater from memos m
    left join users cu on cu.id = m.created_by left join users uu on uu.id = m.updated_by where m.id = ${m.id}`;
  return {
    memo: { id: m.id, kind: m.kind, title: m.title, body: m.kind === 'note' ? m.body : null, siteUrl: m.site_url, createdBy: m.created_by, creatorName: c?.name ?? null, createdAt: c?.created_at, updatedAt: c?.updated_at, updaterName: c?.updater ?? null, level: m.level, isCreator: m.created_by === u.id },
    access: access.map((a) => ({ userId: a.user_id, unitId: a.org_unit_id, level: a.level, name: a.user_name ?? a.unit_name ?? '(지워짐)', kind: a.user_id ? 'user' : 'unit', inactive: a.user_id ? a.user_status !== 'active' : false })),
    unlockedUntil: m.kind === 'secret' ? await unlockedUntil(sql, u) : null,
  };
}

export async function createMemo(u: SessionUser, i: z.infer<typeof memoInput>, ip: string | null) {
  await gate(u);
  const sql = db();
  const t = tenantOf(u);
  const access = await cleanAccess(sql, u, u.id, i.access);
  if (i.kind === 'secret' && !vaultReady()) throw new HttpError(503, 'vault_off', '주요 메모 암호화 키가 아직 설정되지 않았습니다 — 플랫폼 관리자 설정이 필요합니다(일반 메모는 쓸 수 있습니다)');
  const id = await sql.begin(async (tx) => {
    const [m] = await tx<{ id: string }[]>`insert into memos (tenant, kind, title, body, site_url, created_by, updated_by)
      values (${t}, ${i.kind}, ${i.title}, ${i.kind === 'note' ? (i.body ?? '') : null}, ${i.kind === 'secret' ? cleanUrl(i.siteUrl) : null}, ${u.id}, ${u.id}) returning id`;
    if (i.kind === 'secret') {
      const ct = sealSecret(t, m.id, { username: i.username ?? '', password: i.password ?? '', note: i.note ?? '' });
      await tx`update memos set secret_ct = ${ct}, key_ver = ${VAULT_VER} where id = ${m.id}`;
    }
    await writeAccess(tx as unknown as Sql, m.id, access);
    return m.id;
  });
  await audit(sql, u.id, 'memo.create', 'memo', id, { kind: i.kind, title: i.title, shares: access.length }, ip);
  return { id };
}

export async function updateMemo(u: SessionUser, id: string, i: z.infer<typeof memoUpdateInput>, ip: string | null) {
  await gate(u);
  const m = await loadMemo(u, id, 'edit');
  const sql = db();
  const t = tenantOf(u);
  const touchesSecret = i.username !== undefined || i.password !== undefined || i.note !== undefined;
  const changed: string[] = [];
  let ct: string | null = null;
  if (m.kind === 'secret' && touchesSecret) {
    if (!(await unlockedUntil(sql, u))) throw new HttpError(403, 'memo_locked', '아이디·비밀번호를 바꾸려면 먼저 본인 확인을 해 주세요');
    const cur = openSecret(t, m.id, m.secret_ct);
    const next: MemoSecret = { ...cur };
    for (const k of ['username', 'password', 'note'] as const) if (i[k] !== undefined && i[k] !== cur[k]) { next[k] = i[k]; changed.push(k); }
    if (changed.length) ct = sealSecret(t, m.id, next);
  }
  if (i.title !== undefined && i.title !== m.title) changed.push('title');
  if (m.kind === 'note' && i.body !== undefined && i.body !== m.body) changed.push('body');
  const url = m.kind === 'secret' && i.siteUrl !== undefined ? cleanUrl(i.siteUrl) : m.site_url;
  if (url !== m.site_url) changed.push('siteUrl');
  if (!changed.length) return { ok: true, changed };
  await sql`update memos set title = ${i.title ?? m.title}, body = ${m.kind === 'note' ? (i.body ?? m.body) : null}, site_url = ${url},
    secret_ct = ${ct ?? m.secret_ct}, key_ver = ${ct ? VAULT_VER : sql`key_ver`}, updated_by = ${u.id}, updated_at = now() where id = ${m.id}`;
  await audit(sql, u.id, 'memo.update', 'memo', m.id, { fields: changed }, ip); // 무엇을 바꿨는지만(값 없음)
  return { ok: true, changed };
}

export async function setMemoAccess(u: SessionUser, id: string, i: z.infer<typeof memoAccessInput>, ip: string | null) {
  await gate(u);
  const m = await loadMemo(u, id, 'edit');
  const sql = db();
  const before = await sql<{ user_id: string | null; org_unit_id: string | null; level: string }[]>`select user_id, org_unit_id, level from memo_access where memo_id = ${m.id}`;
  const rows = await cleanAccess(sql, u, m.created_by, i.access);
  // 고치기 권한을 받은 사람이 자기 자신을 빼면 더 이상 고칠 수 없음 — 그래도 허용(본인 선택), 만든 사람은 늘 남음
  await sql.begin((tx) => writeAccess(tx as unknown as Sql, m.id, rows));
  const key = (x: { user_id?: string | null; org_unit_id?: string | null; userId?: string | null; unitId?: string | null }) => (x.user_id ?? x.userId) ? `u:${x.user_id ?? x.userId}` : `o:${x.org_unit_id ?? x.unitId}`;
  const b = new Map(before.map((x) => [key(x), x.level])), a = new Map(rows.map((x) => [key(x), x.level]));
  const added = [...a].filter(([k]) => !b.has(k)).map(([k, l]) => `${k}:${l}`), removed = [...b.keys()].filter((k) => !a.has(k)), changedLv = [...a].filter(([k, l]) => b.has(k) && b.get(k) !== l).map(([k, l]) => `${k}:${l}`);
  await audit(sql, u.id, 'memo.share', 'memo', m.id, { added, removed, changed: changedLv }, ip);
  return { ok: true, count: rows.length };
}

/** 본인 확인: 2단계 인증을 켠 사람은 코드, 아니면 비밀번호, 비밀번호가 없는 소셜 계정은 '10분 안에 다시 로그인한 화면' */
export async function unlockMemos(u: SessionUser, i: z.infer<typeof unlockInput>, ip: string | null) {
  await gate(u);
  const sql = db();
  const [{ c }] = await sql<{ c: number }[]>`select count(*)::int c from audit_logs where action = 'memo.unlock_failed' and actor_id = ${u.id} and created_at > now() - interval '15 minutes'`;
  if (c >= 5) throw new HttpError(429, 'too_many', '본인 확인을 여러 번 틀렸습니다 — 15분 뒤 다시 해 주세요');
  const [r] = await sql<{ password_hash: string | null; totp_secret: string | null; totp_enabled_at: Date | null }[]>`select password_hash, totp_secret, totp_enabled_at from users where id = ${u.id}`;
  const method = await authMethod(sql, u);
  let ok = false;
  if (method === 'totp') ok = !!i.code && verifyTotp(decrypt(r.totp_secret!), i.code);
  else if (method === 'password') ok = !!i.password && (await verifyPassword(i.password, r.password_hash));
  else {
    const [s] = await sql<{ ok: boolean }[]>`select created_at > now() - interval '10 minutes' as ok from sessions where id = ${u.sessionId ?? ''}`;
    ok = !!s?.ok;
  }
  if (!ok) {
    await audit(sql, u.id, 'memo.unlock_failed', 'user', u.id, { method }, ip);
    throw new HttpError(400, 'bad_auth', method === 'totp' ? '2단계 인증 코드가 맞지 않습니다 — OTP 앱의 최신 6자리를 입력하세요'
      : method === 'password' ? '비밀번호가 맞지 않습니다' : '소셜 계정은 로그아웃 후 다시 로그인하고 10분 안에 열어 주세요');
  }
  const [s] = await sql<{ until: Date }[]>`update sessions set memo_unlocked_until = now() + ${UNLOCK_MIN} * interval '1 minute' where id = ${u.sessionId ?? ''} returning memo_unlocked_until as until`;
  await audit(sql, u.id, 'memo.unlock', 'user', u.id, { method }, ip);
  return { unlockedUntil: s?.until ?? null };
}
/** 본인 확인 끝내기([잠그기]) */
export async function lockMemos(u: SessionUser) {
  await gate(u);
  await db()`update sessions set memo_unlocked_until = null where id = ${u.sessionId ?? ''}`;
  return { ok: true };
}

/** [보기]·[복사]: 본인 확인 10분 안에만, 고른 칸만 돌려줌. 누가·언제·어느 칸을 열었는지 기록(값은 기록하지 않음) */
export async function revealMemo(u: SessionUser, id: string, i: z.infer<typeof revealInput>, ip: string | null) {
  await gate(u);
  const m = await loadMemo(u, id);
  if (m.kind !== 'secret') throw badRequest('주요 메모가 아닙니다');
  const sql = db();
  const until = await unlockedUntil(sql, u);
  if (!until) throw new HttpError(403, 'memo_locked', '본인 확인이 필요합니다');
  const data = openSecret(tenantOf(u), m.id, m.secret_ct);
  const values: MemoSecret = {};
  for (const f of i.fields) values[f] = data[f] ?? '';
  await audit(sql, u.id, 'memo.reveal', 'memo', m.id, { fields: i.fields, purpose: i.purpose }, ip);
  return { values, unlockedUntil: until };
}

export async function deleteMemo(u: SessionUser, id: string, ip: string | null) {
  await gate(u);
  const m = await loadMemo(u, id, 'edit');
  const sql = db();
  await sql`update memos set deleted_at = now(), deleted_by = ${u.id} where id = ${m.id}`;
  await audit(sql, u.id, 'memo.delete', 'memo', m.id, { title: m.title }, ip);
  return { ok: true };
}
export async function restoreMemo(u: SessionUser, id: string, ip: string | null) {
  await gate(u);
  const m = await loadMemo(u, id, 'edit', { deleted: true });
  const sql = db();
  await sql`update memos set deleted_at = null, deleted_by = null where id = ${m.id}`;
  await audit(sql, u.id, 'memo.restore', 'memo', m.id, { title: m.title }, ip);
  return { ok: true };
}

/** 그 메모의 기록(만들기·고치기·볼 사람 바꾸기·보기·복사·지우기) — 고치기 권한자만 */
export async function memoLog(u: SessionUser, id: string) {
  await gate(u);
  const m = await loadMemo(u, id, 'edit');
  const rows = await db()<any[]>`select a.id, a.action, a.detail, a.created_at, x.name as actor_name from audit_logs a left join users x on x.id = a.actor_id
    where a.target_type = 'memo' and a.target_id = ${m.id} order by a.id desc limit 200`;
  return { log: rows.map((r) => ({ id: r.id, action: r.action, at: r.created_at, actor: r.actor_name, fields: r.detail?.fields ?? null, purpose: r.detail?.purpose ?? null, added: r.detail?.added?.length ?? 0, removed: r.detail?.removed?.length ?? 0 })) };
}

/** 볼 사람 고르기용: 같은 회사 사람·부서(메모 화면 안에서만 씀) */
export async function memoPeople(u: SessionUser) {
  await gate(u);
  const sql = db();
  const t = tenantOf(u);
  const [users, units] = await Promise.all([
    sql<{ id: string; name: string; email: string }[]>`select id, name, email from users where tenant = ${t} and status = 'active' and deleted_at is null and id <> ${u.id} order by name limit 1000`,
    sql<{ id: string; name: string; parent_id: string | null }[]>`select id, name, parent_id from org_units where tenant = ${t} and active order by sort, name limit 500`,
  ]);
  return { users, units };
}

/** 정기 실행: 휴지통 30일 지난 메모를 완전히 지움(암호문까지) */
export async function memoPurge(sql: Sql = db()) {
  const r = await sql`delete from memos where deleted_at < now() - interval '30 days'`;
  return r.count;
}
