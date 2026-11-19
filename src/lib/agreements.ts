/**
 * 계약 관리 1단계 — 계약서 보관 · 만료일 관리 (대표 11/19 요청 · docs/contract-docs-design.md)
 * - '전자계약'(contracts — 서명 받는 도구)과는 따로: 맺은 계약을 보관하고 만료일로 챙긴다.
 * - 모든 회사가 같은 칸을 쓰고 종류는 꼬리표로(대표 11/19 20시). 알림 받는 사람은 계약마다(기본: 담당자 + 등록한 사람).
 * - 알림: 기준일 90·60·30·7일 전(회사 기본값 · 계약별로 바꿈). 같은 단계는 한 번, 늦게 등록해도 가장 가까운 단계 하나만.
 *   기준일 = 보통 계약은 만료일 / 자동 연장 + 해지 통보 기한이 있으면 '해지 통보 마감일'(만료일 − 통보 기한 — 이 날이 지나면 손쓸 수 없음).
 * - 자동 연장 계약도 기간을 스스로 늘리지 않는다(계약마다 조건이 달라서) — 만료일이 지나면 '연장 확인 필요', 사람이 [갱신 등록].
 * - 파일은 계약 관리 권한이 있는 사람만 연다(자료실과 따로 보관). 열람은 감사 기록에 남고, 회사 저장공간 한도에 함께 센다.
 * 권한: 메뉴 권한 '계약 관리'(agreements) 보기/편집. 다른 회사 것은 없는 것처럼(404).
 */
import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, notFound } from './errors';
import { audit, logError } from './log';
import { requireMenu } from './menuPerms';
import { notify } from './notifications';
import { MAX_UPLOAD_BYTES, completeMultipart, downloadUrl, objectSize, uploadTargetFor } from './storage';
import { addDays, todaySeoul } from './time';
import { tenantOf, type SessionUser } from './types';

export const ALERT_DAYS_DEFAULT = [90, 60, 30, 7];
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const days = z.array(z.number().int().min(1).max(365)).min(1).max(6);
export const agreementInput = z.object({
  title: z.string().trim().min(1, '계약명을 적어 주세요').max(120),
  counterparty: z.string().trim().max(120).optional(),
  amount: z.number().int().min(0).max(9_999_999_999_999).nullable().optional(),
  ownerId: uuid.nullable().optional(),
  orgUnitId: uuid.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(20)).max(10).optional(),
  memo: z.string().trim().max(2000).nullable().optional(),
  startDate: date.nullable().optional(),
  endDate: date.nullable().optional(),
  autoRenew: z.boolean().optional(),
  noticeDays: z.number().int().min(0).max(365).nullable().optional(),
  alertDays: days.nullable().optional(),
  notifyUserIds: z.array(uuid).max(20).optional(),
  reviewTask: z.boolean().optional(),
});
export type AgreementInput = z.infer<typeof agreementInput>;

type Row = { id: string; title: string; counterparty: string; amount: string | null; owner_id: string | null; owner_name: string | null; org_unit_id: string | null; org_unit_name: string | null; tags: string[]; memo: string | null;
  start_date: string | null; end_date: string | null; auto_renew: boolean; notice_days: number | null; alert_days: number[] | null; notify_user_ids: string[]; review_task: boolean; review_task_id: string | null; term_no: number;
  status: 'active' | 'ended'; ended_at: Date | null; ended_reason: string | null; created_by: string | null; created_at: Date; updated_at: Date; files: number };
const COLS = (sql: Sql) => sql`a.id, a.title, a.counterparty, a.amount::text, a.owner_id, ow.name as owner_name, a.org_unit_id, o.name as org_unit_name, a.tags, a.memo, a.start_date::text, a.end_date::text, a.auto_renew, a.notice_days,
  a.alert_days, a.notify_user_ids, a.review_task, a.review_task_id, a.term_no, a.status, a.ended_at, a.ended_reason, a.created_by, a.created_at, a.updated_at,
  (select count(*)::int from agreement_files f where f.agreement_id = a.id and f.upload_status = 'ready') as files`;
const FROM = (sql: Sql) => sql`from agreements a left join users ow on ow.id = a.owner_id left join org_units o on o.id = a.org_unit_id`;

// ---------- 날짜 계산 ----------
const diff = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);
export type AgreementState = 'active' | 'soon' | 'notice_passed' | 'expired' | 'renew_check' | 'open_ended' | 'ended';
export const STATE_LABEL: Record<AgreementState, string> = { active: '진행 중', soon: '만료 임박', notice_passed: '통보 기한 지남', expired: '만료', renew_check: '연장 확인 필요', open_ended: '기한 없음', ended: '종료' };
/** 알림 기준일: 자동 연장 + 해지 통보 기한이 있으면 해지 통보 마감일, 아니면 만료일 */
export function basisOf(a: { end_date: string | null; auto_renew: boolean; notice_days: number | null }) {
  if (!a.end_date) return null;
  const notice = a.auto_renew && a.notice_days !== null && a.notice_days !== undefined && a.notice_days > 0;
  return { date: notice ? addDays(a.end_date, -a.notice_days!) : a.end_date, kind: notice ? ('notice' as const) : ('end' as const) };
}
export function stateOf(a: { status: string; end_date: string | null; auto_renew: boolean; notice_days: number | null; alert_days: number[] | null }, today: string, tenantDays: number[]): { state: AgreementState; basis: string | null; basisKind: 'notice' | 'end' | null; daysLeft: number | null } {
  if (a.status === 'ended') return { state: 'ended', basis: null, basisKind: null, daysLeft: null };
  const b = basisOf(a);
  if (!b || !a.end_date) return { state: 'open_ended', basis: null, basisKind: null, daysLeft: null };
  const toEnd = diff(a.end_date, today);
  if (toEnd < 0) return { state: a.auto_renew ? 'renew_check' : 'expired', basis: b.date, basisKind: b.kind, daysLeft: toEnd };
  const left = diff(b.date, today);
  if (left < 0) return { state: 'notice_passed', basis: b.date, basisKind: b.kind, daysLeft: toEnd };
  const window = Math.max(...(a.alert_days?.length ? a.alert_days : tenantDays));
  return { state: left <= window ? 'soon' : 'active', basis: b.date, basisKind: b.kind, daysLeft: left };
}
export async function tenantAlertDays(tenant: string, sql: Sql = db()) {
  const [t] = await sql<{ d: number[] | null }[]>`select agreement_alert_days as d from tenants where id = ${tenant}`;
  return t?.d?.length ? [...t.d].sort((x, y) => y - x) : ALERT_DAYS_DEFAULT;
}

// ---------- 목록 · 상세 ----------
const view = (r: Row, today: string, tdays: number[]) => {
  const s = stateOf(r, today, tdays);
  return { id: r.id, title: r.title, counterparty: r.counterparty, amount: r.amount === null ? null : Number(r.amount), ownerId: r.owner_id, ownerName: r.owner_name, orgUnitId: r.org_unit_id, orgUnitName: r.org_unit_name, tags: r.tags, memo: r.memo,
    startDate: r.start_date, endDate: r.end_date, autoRenew: r.auto_renew, noticeDays: r.notice_days, alertDays: r.alert_days, notifyUserIds: r.notify_user_ids, reviewTask: r.review_task, reviewTaskId: r.review_task_id, termNo: r.term_no,
    status: r.status, endedAt: r.ended_at, endedReason: r.ended_reason, createdAt: r.created_at, updatedAt: r.updated_at, files: r.files, state: s.state, stateLabel: STATE_LABEL[s.state], basis: s.basis, basisKind: s.basisKind, daysLeft: s.daysLeft };
};
const ORDER: Record<AgreementState, number> = { renew_check: 0, expired: 1, notice_passed: 2, soon: 3, active: 4, open_ended: 5, ended: 6 };
export async function listAgreements(u: SessionUser, f: { q?: string | null; tag?: string | null; state?: string | null; ownerId?: string | null } = {}) {
  await requireMenu(u, 'agreements', 'view');
  const sql = db(); const t = tenantOf(u); const today = todaySeoul(); const tdays = await tenantAlertDays(t, sql);
  const q = (f.q ?? '').trim().slice(0, 60);
  const rows = await sql<Row[]>`select ${COLS(sql)} ${FROM(sql)} where a.tenant = ${t} and a.deleted_at is null
    ${q ? sql`and (a.title ilike ${'%' + q + '%'} or a.counterparty ilike ${'%' + q + '%'} or a.memo ilike ${'%' + q + '%'})` : sql``}
    ${f.tag ? sql`and ${f.tag} = any(a.tags)` : sql``} ${f.ownerId ? sql`and a.owner_id = ${f.ownerId}` : sql``} limit 1000`;
  let items = rows.map((r) => view(r, today, tdays));
  const all = items;
  if (f.state === 'open') items = items.filter((x) => x.state !== 'ended');
  else if (f.state && f.state in STATE_LABEL) items = items.filter((x) => x.state === f.state);
  items.sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999) || a.title.localeCompare(b.title, 'ko'));
  const within = (n: number) => all.filter((x) => x.status === 'active' && x.endDate && diff(x.endDate, today) >= 0 && diff(x.endDate, today) <= n).length;
  const tags = [...new Set(all.flatMap((x) => x.tags))].sort((a, b) => a.localeCompare(b, 'ko'));
  return { agreements: items, counts: { total: all.filter((x) => x.status === 'active').length, in30: within(30), in90: within(90), attention: all.filter((x) => ['renew_check', 'expired', 'notice_passed'].includes(x.state)).length, ended: all.filter((x) => x.status === 'ended').length },
    tags, alertDays: tdays, today };
}
async function load(u: SessionUser, id: string, sql: Sql) {
  const [r] = await sql<Row[]>`select ${COLS(sql)} ${FROM(sql)} where a.id = ${id} and a.tenant = ${tenantOf(u)} and a.deleted_at is null`;
  if (!r) throw notFound();
  return r;
}
export async function getAgreement(u: SessionUser, id: string) {
  await requireMenu(u, 'agreements', 'view');
  const sql = db(); const t = tenantOf(u);
  const r = await load(u, id, sql);
  const terms = await sql`select t.term_no, t.start_date::text, t.end_date::text, t.amount::text, t.memo, t.created_at, us.name as by_name from agreement_terms t left join users us on us.id = t.by_user
    where t.agreement_id = ${id} and t.tenant = ${t} order by t.term_no desc`;
  const files = await sql`select f.id, f.term_no, f.file_name, f.mime_type, f.size_bytes::float8 as size_bytes, f.created_at, us.name as by_name from agreement_files f left join users us on us.id = f.by_user
    where f.agreement_id = ${id} and f.tenant = ${t} and f.upload_status = 'ready' order by f.created_at desc`;
  const people = r.notify_user_ids.length ? await sql<{ id: string; name: string }[]>`select id, name from users where id = any(${r.notify_user_ids}::uuid[]) and tenant = ${t}` : [];
  return { agreement: view(r, todaySeoul(), await tenantAlertDays(t, sql)), terms, files, notifyUsers: people };
}

// ---------- 등록 · 고치기 · 갱신 · 종료 ----------
async function assertRefs(u: SessionUser, i: Partial<AgreementInput>, sql: Sql) {
  const t = tenantOf(u);
  const ids = [...new Set([...(i.ownerId ? [i.ownerId] : []), ...(i.notifyUserIds ?? [])])];
  if (ids.length) {
    const ok = await sql`select id from users where id = any(${ids}::uuid[]) and tenant = ${t} and status = 'active'`;
    if (ok.length !== ids.length) throw badRequest('담당자·알림 받는 사람을 다시 골라 주세요');
  }
  if (i.orgUnitId && !(await sql`select 1 from org_units where id = ${i.orgUnitId} and tenant = ${t}`).length) throw notFound();
  if (i.startDate && i.endDate && i.endDate < i.startDate) throw badRequest('만료일이 시작일보다 앞섭니다');
}
const cleanTags = (tags: string[] | undefined) => [...new Set((tags ?? []).map((x) => x.trim()).filter(Boolean))].slice(0, 10);
export async function createAgreement(u: SessionUser, i: AgreementInput, ip: string | null = null) {
  await requireMenu(u, 'agreements', 'edit');
  const sql = db(); const t = tenantOf(u);
  await assertRefs(u, i, sql);
  const owner = i.ownerId === undefined ? u.id : i.ownerId;
  const notifyIds = i.notifyUserIds ?? [...new Set([owner, u.id].filter((x): x is string => !!x))]; // 기본: 담당자 + 등록한 사람
  const [r] = await sql<{ id: string }[]>`insert into agreements (tenant, title, counterparty, amount, owner_id, org_unit_id, tags, memo, start_date, end_date, auto_renew, notice_days, alert_days, notify_user_ids, review_task, created_by)
    values (${t}, ${i.title}, ${i.counterparty ?? ''}, ${i.amount ?? null}, ${owner}, ${i.orgUnitId ?? null}, ${cleanTags(i.tags)}, ${i.memo ?? null}, ${i.startDate ?? null}, ${i.endDate ?? null}, ${i.autoRenew ?? false},
      ${i.noticeDays ?? null}, ${i.alertDays ? [...i.alertDays].sort((a, b) => b - a) : null}, ${notifyIds}::uuid[], ${i.reviewTask ?? true}, ${u.id}) returning id`;
  await audit(sql, u.id, 'agreement.create', 'agreement', r.id, { title: i.title }, ip);
  return { id: r.id };
}
export async function updateAgreement(u: SessionUser, id: string, i: Partial<AgreementInput>, ip: string | null = null) {
  await requireMenu(u, 'agreements', 'edit');
  const sql = db(); const t = tenantOf(u);
  const cur = await load(u, id, sql);
  await assertRefs(u, { ...i, startDate: i.startDate === undefined ? cur.start_date : i.startDate, endDate: i.endDate === undefined ? cur.end_date : i.endDate }, sql);
  const owner = i.ownerId === undefined ? cur.owner_id : i.ownerId;
  // 담당자를 바꾸면 새 담당자가 알림 받는 사람에 자동으로 들어간다(받는 사람 목록을 함께 보냈으면 그 목록 그대로)
  let notifyIds = i.notifyUserIds ?? cur.notify_user_ids;
  if (i.notifyUserIds === undefined && owner && owner !== cur.owner_id && !notifyIds.includes(owner)) notifyIds = [...notifyIds, owner];
  await sql`update agreements set title = ${i.title ?? cur.title}, counterparty = ${i.counterparty ?? cur.counterparty}, amount = ${i.amount === undefined ? cur.amount : i.amount}, owner_id = ${owner},
      org_unit_id = ${i.orgUnitId === undefined ? cur.org_unit_id : i.orgUnitId}, tags = ${i.tags === undefined ? cur.tags : cleanTags(i.tags)}, memo = ${i.memo === undefined ? cur.memo : i.memo},
      start_date = ${i.startDate === undefined ? cur.start_date : i.startDate}, end_date = ${i.endDate === undefined ? cur.end_date : i.endDate}, auto_renew = ${i.autoRenew ?? cur.auto_renew},
      notice_days = ${i.noticeDays === undefined ? cur.notice_days : i.noticeDays}, alert_days = ${i.alertDays === undefined ? cur.alert_days : i.alertDays ? [...i.alertDays].sort((a, b) => b - a) : null},
      notify_user_ids = ${notifyIds}::uuid[], review_task = ${i.reviewTask ?? cur.review_task}, updated_at = now()
    where id = ${id} and tenant = ${t}`;
  await audit(sql, u.id, 'agreement.update', 'agreement', id, { title: i.title ?? cur.title }, ip);
  return { id };
}
export const renewInput = z.object({ startDate: date.nullable().optional(), endDate: date, amount: z.number().int().min(0).max(9_999_999_999_999).nullable().optional(), memo: z.string().trim().max(500).optional() });
/** 갱신 등록: 지금 기간을 이력으로 넘기고 새 기간을 잇는다(보낸 알림 기록은 기준일이 달라져 새로 셈) */
export async function renewAgreement(u: SessionUser, id: string, i: z.infer<typeof renewInput>, ip: string | null = null) {
  await requireMenu(u, 'agreements', 'edit');
  const sql = db(); const t = tenantOf(u);
  const cur = await load(u, id, sql);
  const start = i.startDate ?? (cur.end_date ? addDays(cur.end_date, 1) : null);
  if (start && i.endDate < start) throw badRequest('새 만료일이 새 시작일보다 앞섭니다');
  if (cur.end_date && i.endDate <= cur.end_date) throw badRequest('새 만료일은 지금 만료일보다 뒤여야 합니다');
  await sql.begin(async (tx) => {
    await tx`insert into agreement_terms (tenant, agreement_id, term_no, start_date, end_date, amount, memo, by_user) values (${t}, ${id}, ${cur.term_no}, ${cur.start_date}, ${cur.end_date}, ${cur.amount}, ${i.memo ?? null}, ${u.id})
      on conflict (agreement_id, term_no) do nothing`;
    await tx`update agreements set term_no = term_no + 1, start_date = ${start}, end_date = ${i.endDate}, amount = ${i.amount === undefined ? cur.amount : i.amount}, status = 'active', ended_at = null, ended_reason = null,
      review_task_id = null, review_task_basis = null, updated_at = now() where id = ${id} and tenant = ${t}`;
  });
  await audit(sql, u.id, 'agreement.renew', 'agreement', id, { title: cur.title, termNo: cur.term_no + 1, endDate: i.endDate }, ip);
  return { id, termNo: cur.term_no + 1 };
}
export const endInput = z.object({ reason: z.string().trim().min(1, '종료 까닭을 적어 주세요').max(300) });
export async function endAgreement(u: SessionUser, id: string, i: z.infer<typeof endInput>, ip: string | null = null) {
  await requireMenu(u, 'agreements', 'edit');
  const sql = db(); const cur = await load(u, id, sql);
  await sql`update agreements set status = 'ended', ended_at = now(), ended_reason = ${i.reason}, updated_at = now() where id = ${id} and tenant = ${tenantOf(u)}`;
  await audit(sql, u.id, 'agreement.end', 'agreement', id, { title: cur.title, reason: i.reason }, ip);
  return { id, status: 'ended' };
}

// ---------- 계약서 파일 ----------
export const fileInput = z.object({ fileName: z.string().trim().min(1).max(200), mimeType: z.string().trim().max(120).optional(), size: z.number().int().min(1).max(MAX_UPLOAD_BYTES) });
const safeName = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120);
export async function initFile(u: SessionUser, id: string, i: z.infer<typeof fileInput>) {
  await requireMenu(u, 'agreements', 'edit');
  const sql = db(); const t = tenantOf(u);
  const cur = await load(u, id, sql);
  await (await import('./plans')).assertStorage(u, i.size);
  const fid = crypto.randomUUID(); const mime = i.mimeType || 'application/octet-stream';
  const key = `agr/${t}/${id}/${fid}/${safeName(i.fileName)}`;
  await sql`insert into agreement_files (id, tenant, agreement_id, term_no, storage_key, file_name, mime_type, size_bytes, by_user) values (${fid}, ${t}, ${id}, ${cur.term_no}, ${key}, ${i.fileName}, ${mime}, ${i.size}, ${u.id})`;
  return { id: fid, upload: await uploadTargetFor(key, mime, i.size) };
}
export async function completeFile(u: SessionUser, fileId: string, i: { uploadId?: string }) {
  await requireMenu(u, 'agreements', 'edit');
  const sql = db(); const t = tenantOf(u);
  const [f] = await sql<{ id: string; storage_key: string; agreement_id: string; file_name: string }[]>`select id, storage_key, agreement_id, file_name from agreement_files where id = ${fileId} and tenant = ${t}`;
  if (!f) throw notFound();
  if (i.uploadId) await completeMultipart(f.storage_key, i.uploadId);
  const size = await objectSize(f.storage_key);
  if (size === null) throw badRequest('파일이 올라오지 않았습니다 — 다시 올려 주세요');
  await sql`update agreement_files set upload_status = 'ready', size_bytes = ${size} where id = ${fileId}`;
  await sql`update agreements set updated_at = now() where id = ${f.agreement_id}`;
  await audit(sql, u.id, 'agreement.file_add', 'agreement', f.agreement_id, { file: f.file_name }, null);
  return { id: fileId, sizeBytes: size };
}
/** 파일 열기 — 계약 관리 보기 권한. 열람은 감사 기록에 남긴다 */
export async function fileUrl(u: SessionUser, fileId: string, inline: boolean, ip: string | null = null) {
  await requireMenu(u, 'agreements', 'view');
  const sql = db();
  const [f] = await sql<{ storage_key: string; file_name: string; mime_type: string | null; agreement_id: string }[]>`select f.storage_key, f.file_name, f.mime_type, f.agreement_id from agreement_files f join agreements a on a.id = f.agreement_id
    where f.id = ${fileId} and f.tenant = ${tenantOf(u)} and f.upload_status = 'ready' and a.deleted_at is null`;
  if (!f) throw notFound();
  await audit(sql, u.id, 'agreement.file_open', 'agreement', f.agreement_id, { file: f.file_name }, ip);
  const canInline = inline && /^(image\/|application\/pdf)/.test(f.mime_type ?? '');
  return downloadUrl(f.storage_key, f.file_name, canInline, 300, f.mime_type ?? undefined);
}
export async function removeFile(u: SessionUser, fileId: string, ip: string | null = null) {
  await requireMenu(u, 'agreements', 'edit');
  const sql = db();
  const r = await sql<{ agreement_id: string; file_name: string }[]>`delete from agreement_files where id = ${fileId} and tenant = ${tenantOf(u)} returning agreement_id, file_name`;
  if (!r.length) throw notFound();
  await audit(sql, u.id, 'agreement.file_remove', 'agreement', r[0].agreement_id, { file: r[0].file_name }, ip);
  return { ok: true };
}

// ---------- 회사 기본 알림 날짜 ----------
export const settingsInput = z.object({ alertDays: days.nullable() });
export async function getSettings(u: SessionUser) { await requireMenu(u, 'agreements', 'view'); return { alertDays: await tenantAlertDays(tenantOf(u)), defaults: ALERT_DAYS_DEFAULT }; }
export async function saveSettings(u: SessionUser, i: z.infer<typeof settingsInput>) {
  await requireMenu(u, 'agreements', 'edit');
  await db()`update tenants set agreement_alert_days = ${i.alertDays ? [...new Set(i.alertDays)].sort((a, b) => b - a) : null} where id = ${tenantOf(u)}`;
  return getSettings(u);
}

// ---------- 엑셀 ----------
export async function exportAgreements(u: SessionUser) {
  const { agreements } = await listAgreements(u, {});
  const { writeXlsx } = await import('./xlsx');
  const data = writeXlsx([{ name: '계약', rows: [['계약명', '상대방', '꼬리표', '시작일', '만료일', '상태', '남은 날', '자동 연장', '해지 통보 기한(일 전)', '금액', '담당자', '소속', '메모'],
    ...agreements.map((a) => [a.title, a.counterparty, a.tags.join(', '), a.startDate ?? '', a.endDate ?? '', a.stateLabel, a.daysLeft ?? '', a.autoRenew ? '예' : '', a.noticeDays ?? '', a.amount ?? '', a.ownerName ?? '', a.orgUnitName ?? '', a.memo ?? ''])] }]);
  return { fileName: `계약_${todaySeoul()}.xlsx`, data };
}

// ---------- 홈 카드 ----------
/** 권한이 있는 사람에게만: 30일·90일 안 만료, 챙겨야 할 것(만료·연장 확인·통보 기한 지남) */
export async function agreementSummary(u: SessionUser) {
  const { counts } = await listAgreements(u, {});
  return counts;
}

// ---------- 정기 실행: 만료 알림 ----------
type TickRow = { id: string; tenant: string; title: string; counterparty: string; owner_id: string | null; end_date: string; auto_renew: boolean; notice_days: number | null; alert_days: number[] | null; notify_user_ids: string[];
  notified: Record<string, string>; review_task: boolean; review_task_id: string | null; created_by: string | null };
const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
/** 알림 한 건의 글(기준일 종류에 따라) */
export function alertText(a: { title: string; end_date: string; auto_renew: boolean }, b: { date: string; kind: 'notice' | 'end' }, stage: number | 'passed') {
  if (stage === 'passed') return b.kind === 'notice'
    ? { title: `해지 통보 기한이 지났습니다: ${a.title}`, body: `${md(a.end_date)}에 자동 연장됩니다. 연장되면 [갱신 등록]으로 새 기간을 적어 주세요.` }
    : { title: `${a.auto_renew ? '연장 확인 필요' : '계약이 만료됐습니다'}: ${a.title}`, body: a.auto_renew ? `만료일(${md(a.end_date)})이 지났습니다. 연장됐으면 [갱신 등록]으로 새 기간을 적어 주세요.` : `만료일 ${md(a.end_date)}. 갱신했으면 [갱신 등록], 끝났으면 [종료]로 정리해 주세요.` };
  const left = `${stage}일 전`;
  if (b.kind === 'notice') return { title: `해지 통보 기한 ${left}: ${a.title}`, body: `${md(b.date)}까지 통보하지 않으면 자동 연장됩니다(만료일 ${md(a.end_date)}).` };
  return a.auto_renew
    ? { title: `자동 연장 예정 ${left}: ${a.title}`, body: `만료일 ${md(a.end_date)}. 계약서의 해지 통보 기한을 확인해 주세요.` }
    : { title: `계약 만료 ${left}: ${a.title}`, body: `${md(a.end_date)} 만료 — 갱신·종료를 정해 주세요.` };
}
async function actorFor(userId: string, sql: Sql): Promise<SessionUser | null> {
  const [r] = await sql<any[]>`select u.id, u.email, u.name, u.role, u.status, u.timezone, u.is_demo, u.platform_admin, u.tenant, t.kind from users u join tenants t on t.id = u.tenant where u.id = ${userId} and u.status = 'active' and t.status = 'active'`;
  return r ? ({ id: r.id, email: r.email, name: r.name, role: r.role, status: r.status, timezone: r.timezone, sessionId: '', isDemo: r.is_demo, platformAdmin: r.platform_admin, tenant: r.tenant, personal: r.kind === 'personal' } as SessionUser) : null;
}
export async function agreementTick(now = new Date()) {
  const sql = db(); const today = todaySeoul(now);
  const rows = await sql<TickRow[]>`select a.id, a.tenant, a.title, a.counterparty, a.owner_id, a.end_date::text, a.auto_renew, a.notice_days, a.alert_days, a.notify_user_ids, a.notified, a.review_task, a.review_task_id, a.created_by
    from agreements a join tenants t on t.id = a.tenant where a.status = 'active' and a.deleted_at is null and a.end_date is not null and t.status = 'active'
      and a.end_date > (${today}::date - interval '60 days') limit 2000`;
  const tdays = new Map<string, number[]>(); let sent = 0, tasks = 0;
  for (const a of rows) {
    try {
      const b = basisOf(a)!;
      if (!tdays.has(a.tenant)) tdays.set(a.tenant, await tenantAlertDays(a.tenant, sql));
      const stages = (a.alert_days?.length ? a.alert_days : tdays.get(a.tenant)!).slice().sort((x, y) => x - y); // 가까운 단계부터
      const left = diff(b.date, today);
      // 지금 보낼 단계: 기준일이 지났으면 'passed'(한 번) · 아니면 이미 닿은 단계 가운데 가장 가까운 것 하나
      const stage: number | 'passed' | null = left < 0 ? 'passed' : stages.find((d) => left <= d) ?? null;
      if (stage === null) continue;
      const key = `${b.date}:${stage}`;
      // 더 가까운 단계를 이미 보냈으면(같은 기준일) 먼 단계는 다시 보내지 않는다
      const already = a.notified[key] || (typeof stage === 'number' && stages.some((d) => d < stage && a.notified[`${b.date}:${d}`])) || (stage !== 'passed' && a.notified[`${b.date}:passed`]);
      if (already) continue;
      const to = [...new Set(a.notify_user_ids.length ? a.notify_user_ids : [a.owner_id, a.created_by].filter((x): x is string => !!x))];
      const active = to.length ? (await sql<{ id: string }[]>`select id from users where id = any(${to}::uuid[]) and tenant = ${a.tenant} and status = 'active'`).map((x) => x.id) : [];
      await sql`update agreements set notified = notified || ${sql.json({ [key]: now.toISOString() } as never)} where id = ${a.id}`;
      const text = alertText(a, b, stage);
      if (active.length) { await notify(sql, { userIds: active, type: 'agreement_expiry', title: text.title, body: `${a.counterparty ? a.counterparty + ' · ' : ''}${text.body}`, link: `/agreements?open=${a.id}`, entityType: 'agreement', entityId: a.id, dedupeKey: `agr:${a.id}:${key}` }); sent++; }
      // 첫 알림 때 담당자에게 '[계약 갱신 검토]' 업무 1건 — 이 기간에 한 번(만료일을 조금 고쳐도 다시 만들지 않음 · [갱신 등록]하면 다음 기간에 새로)
      if (a.review_task && stage !== 'passed' && a.owner_id && !a.review_task_id) {
        const actor = await actorFor(a.owner_id, sql);
        if (actor) {
          const { createTask } = await import('./tasks');
          const due = left > 14 ? addDays(b.date, -14) : b.date;
          const t = await createTask(actor, { title: `[계약 갱신 검토] ${a.title}`, assigneeId: a.owner_id, dueDate: due >= today ? due : today, tags: ['계약 관리'],
            description: [`${text.title}`, text.body, a.counterparty ? `상대방: ${a.counterparty}` : null, '', '갱신할지·조건을 바꿀지·끝낼지 정하고, 정해지면 계약 관리에서 [갱신 등록] 또는 [종료]로 정리해 주세요.'].filter((x) => x !== null).join('\n') } as never, { quiet: true, skipQuota: true });
          await sql`update agreements set review_task_id = ${t.id}, review_task_basis = ${b.date} where id = ${a.id}`;
          tasks++;
        }
      }
    } catch (e) { await logError('agreements:tick', e, { id: a.id }).catch(() => {}); }
  }
  return { checked: rows.length, sent, tasks };
}
