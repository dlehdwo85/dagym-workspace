/**
 * #1175 고객 요청함(설계 docs/research/COMMERCIAL_DESIGN_2026-11-26.md C, DB 291) — 플랫폼 운영자만.
 * - 출처: 앱 문의(support_tickets)·상담 신청(space_consults)은 화면을 열 때 자동으로 모음(같은 건은 한 번) · 운영자 메모·메일 요청은 직접 넣음
 * - 분류: ①설정으로 해결 ②공통 개선 ③맞춤 개발(유료 — 금액은 쓰지 않고 '견적 후 진행') ④불가
 * - 상태: 접수 → 검토 → 진행 → 완료/반려 · 담당 · 고객에게 한 답변 기록 · 바뀔 때마다 기록(customer_request_logs)
 * - 같은 요청 묶기: 대표 줄에 묶으면 '요청한 회사 n곳'으로 셈(공통 개선 우선순위)
 */
import { z } from 'zod';
import { db } from './db';
import { audit } from './log';
import { notFound } from './errors';
import type { SessionUser } from './types';

export const CATEGORY_LABEL = { setting: '설정으로 해결', common: '공통 개선', custom: '맞춤 개발(견적 후 진행)', impossible: '불가' } as const;
export const STATUS_LABEL = { received: '접수', review: '검토', progress: '진행', done: '완료', rejected: '반려' } as const;
export const SOURCE_LABEL = { ticket: '앱 문의', consult: '상담 신청', memo: '운영자 메모', mail: '메일' } as const;
const only = (u: SessionUser) => { if (!u.platformAdmin) throw notFound(); };

/** 앱 문의·상담 신청 → 요청함(없는 것만) */
async function sync() {
  const sql = db();
  await sql`insert into customer_requests (tenant, source, source_id, title, body, created_at)
    select t.tenant, 'ticket', t.id::text, left(t.subject, 200), t.body, t.created_at from support_tickets t
    where t.created_at > now() - interval '180 days' on conflict (source, source_id) do nothing`;
  await sql`insert into customer_requests (tenant, source, source_id, title, body, created_at)
    select c.tenant, 'consult', c.id::text, '상담 신청: ' || array_to_string(c.spaces, '·'), c.memo, c.created_at from space_consults c
    where c.created_at > now() - interval '180 days' on conflict (source, source_id) do nothing`;
}

// 로컬 11/26: 검수용 시험 회사·심사용 demo·결제 시험(test_*) 요청은 기본 목록·숫자에서 뺌(test=1 이면 함께, '시험 회사' 표시)
const TEST_TENANT = (col: string) => `(${col} = 'demo' or ${col} like 'test\\_%' or coalesce((select t.is_test from tenants t where t.id = ${col}), false))`;
export async function listRequests(u: SessionUser, f: { status?: string | null; category?: string | null; test?: boolean } = {}) {
  only(u); await sync();
  const sql = db();
  const rows = await sql<any[]>`
    select r.id, r.tenant, tn.name as tenant_name, (r.tenant is not null and ${sql.unsafe(TEST_TENANT('r.tenant'))}) as test_company, r.source, r.title, r.body, r.category, r.status, r.owner_id, ou.name as owner_name, r.group_id, r.reply, r.replied_at, r.created_at, r.updated_at,
      (select count(distinct coalesce(x.tenant, x.id::text))::int from customer_requests x where x.group_id = r.id or x.id = r.id) as companies,
      (select count(*)::int from customer_requests x where x.group_id = r.id) as grouped
    from customer_requests r left join tenants tn on tn.id = r.tenant left join users ou on ou.id = r.owner_id
    where r.group_id is null ${f.test ? sql`` : sql`and not (r.tenant is not null and ${sql.unsafe(TEST_TENANT('r.tenant'))})`}
      ${f.status ? sql`and r.status = ${f.status}` : sql`and r.status not in ('done', 'rejected')`}
      ${f.category ? sql`and r.category = ${f.category}` : sql``}
    order by (select count(distinct coalesce(x.tenant, x.id::text)) from customer_requests x where x.group_id = r.id or x.id = r.id) desc, r.created_at desc limit 200`;
  const counts = await sql<{ status: string; n: number }[]>`select status, count(*)::int as n from customer_requests where group_id is null ${f.test ? sql`` : sql`and not (tenant is not null and ${sql.unsafe(TEST_TENANT('tenant'))})`} group by status`;
  const [{ hidden }] = await sql<{ hidden: number }[]>`select count(*)::int as hidden from customer_requests where group_id is null and tenant is not null and ${sql.unsafe(TEST_TENANT('tenant'))}`;
  return { items: rows, testHidden: f.test ? 0 : hidden, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), labels: { category: CATEGORY_LABEL, status: STATUS_LABEL, source: SOURCE_LABEL } };
}

export const addInput = z.object({ source: z.enum(['memo', 'mail']), tenant: z.string().trim().max(60).nullable().optional(), title: z.string().trim().min(2).max(200), body: z.string().trim().max(5000).optional() });
export async function addRequest(u: SessionUser, i: z.infer<typeof addInput>, ip: string | null) {
  only(u);
  const sql = db();
  if (i.tenant) { const [t] = await sql`select 1 from tenants where id = ${i.tenant}`; if (!t) throw notFound('회사를 찾을 수 없습니다'); }
  const [r] = await sql<{ id: string }[]>`insert into customer_requests (tenant, source, title, body, created_by) values (${i.tenant ?? null}, ${i.source}, ${i.title}, ${i.body ?? null}, ${u.id}) returning id`;
  await sql`insert into customer_request_logs (request_id, actor_id, action) values (${r.id}, ${u.id}, 'add')`;
  await audit(sql, u.id, 'customer_request.add', 'customer_request', r.id, { source: i.source }, ip);
  return { id: r.id };
}

export const updateInput = z.object({
  category: z.enum(['setting', 'common', 'custom', 'impossible']).nullable().optional(),
  status: z.enum(['received', 'review', 'progress', 'done', 'rejected']).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  reply: z.string().trim().max(5000).optional(),
  groupInto: z.string().uuid().nullable().optional(), // 같은 요청의 대표 줄로 묶기(null = 풀기)
});
export async function updateRequest(u: SessionUser, id: string, i: z.infer<typeof updateInput>, ip: string | null) {
  only(u);
  const sql = db();
  const [r] = await sql<{ id: string; status: string }[]>`select id, status from customer_requests where id = ${id}`; if (!r) throw notFound();
  if (i.ownerId) { const [o] = await sql`select 1 from users where id = ${i.ownerId} and platform_admin`; if (!o) throw notFound('담당(운영자)을 찾을 수 없습니다'); }
  if (i.groupInto) {
    if (i.groupInto === id) throw notFound();
    const [g] = await sql<{ group_id: string | null }[]>`select group_id from customer_requests where id = ${i.groupInto}`; if (!g) throw notFound('묶을 요청을 찾을 수 없습니다');
    const head = g.group_id ?? i.groupInto;
    await sql`update customer_requests set group_id = ${head} where group_id = ${id}`; // 이 줄에 묶여 있던 것도 같이 옮김
    await sql`update customer_requests set group_id = ${head}, updated_at = now() where id = ${id}`;
  } else if (i.groupInto === null) await sql`update customer_requests set group_id = null, updated_at = now() where id = ${id}`;
  await sql`update customer_requests set
      category = ${i.category === undefined ? sql`category` : i.category}, status = ${i.status ?? sql`status`},
      owner_id = ${i.ownerId === undefined ? sql`owner_id` : i.ownerId},
      reply = ${i.reply === undefined ? sql`reply` : i.reply || null}, replied_at = ${i.reply ? sql`now()` : sql`replied_at`}, updated_at = now()
    where id = ${id}`;
  const note = [i.category !== undefined && `분류 ${i.category ? CATEGORY_LABEL[i.category] : '없음'}`, i.status && `상태 ${STATUS_LABEL[i.status]}`, i.ownerId !== undefined && '담당 바꿈', i.reply && '답변 기록', i.groupInto !== undefined && (i.groupInto ? '같은 요청으로 묶음' : '묶음 풂')].filter(Boolean).join(' · ');
  await sql`insert into customer_request_logs (request_id, actor_id, action, note) values (${id}, ${u.id}, 'update', ${note || null})`;
  await audit(sql, u.id, 'customer_request.update', 'customer_request', id, { ...i, reply: i.reply ? '(기록)' : undefined }, ip);
  return { ok: true };
}

export async function requestDetail(u: SessionUser, id: string) {
  only(u);
  const sql = db();
  const [r] = await sql`select r.*, tn.name as tenant_name from customer_requests r left join tenants tn on tn.id = r.tenant where r.id = ${id}`; if (!r) throw notFound();
  const members = await sql`select r.id, r.tenant, tn.name as tenant_name, r.source, r.title, r.created_at from customer_requests r left join tenants tn on tn.id = r.tenant where r.group_id = ${id} order by r.created_at`;
  const logs = await sql`select l.action, l.note, l.at, u.name as actor from customer_request_logs l left join users u on u.id = l.actor_id where l.request_id = ${id} order by l.at desc limit 50`;
  return { request: r, members, logs };
}
