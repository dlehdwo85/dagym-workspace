import { z } from 'zod';
import { db } from './db';
import { accessibleUnitIds, assertUnitAccess, atLeast } from './access';
import { newToken, sha256 } from './crypto';
import { badRequest, forbidden, notFound, HttpError } from './errors';
import { activity } from './log';
import { notify } from './notifications';
import { putObject } from './storage';
import { addDays, todaySeoul } from './time';
import type { SessionUser } from './types';
import { zUuid } from './api';

/** B-8 현장 신고 양식 + QR. 회원·직원이 현장에서 QR 로 시설 고장·민원·비품 요청 → 그 현장 업무 자동 생성·배정 */
export const KIND_LABEL = { facility: '시설 고장', complaint: '회원 민원', supply: '비품 요청' } as const;
const KIND_TEMPLATE = { facility: '시설 보수', complaint: '회원 민원', supply: null } as const;
const KIND_DUE = { facility: 3, complaint: 2, supply: 7 } as const;

export const formInput = z.object({
  orgUnitId: zUuid,
  kind: z.enum(['facility', 'complaint', 'supply']),
  title: z.string().trim().min(1).max(60).optional(),
  defaultAssigneeId: zUuid.nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function listForms(u: SessionUser) {
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  return sql`select f.id, f.org_unit_id, f.kind, f.title, f.token, f.default_assignee_id, f.enabled, f.created_at, o.name as org_unit_name,
      a.name as default_assignee_name, (select count(*)::int from form_submissions s where s.form_id = f.id) as submissions,
      (select max(created_at) from form_submissions s where s.form_id = f.id) as last_submitted
    from site_forms f join org_units o on o.id = f.org_unit_id left join users a on a.id = f.default_assignee_id
    where ${units === null ? sql`true` : sql`f.org_unit_id = any(${units}::uuid[])`} order by o.name, f.kind`;
}

export async function saveForm(u: SessionUser, id: string | null, i: z.infer<typeof formInput>) {
  if (!atLeast(u, 'site_manager')) throw forbidden('신고 양식은 현장 관리자 이상이 만듭니다');
  const sql = db();
  await assertUnitAccess(u, i.orgUnitId, sql);
  const title = i.title ?? KIND_LABEL[i.kind];
  if (id) {
    const [old] = await sql`select org_unit_id from site_forms where id = ${id}`;
    if (!old) throw notFound('양식이 없습니다');
    await assertUnitAccess(u, old.org_unit_id, sql);
    await sql`update site_forms set org_unit_id = ${i.orgUnitId}, kind = ${i.kind}, title = ${title}, default_assignee_id = ${i.defaultAssigneeId ?? null},
      enabled = ${i.enabled ?? true} where id = ${id}`;
    return { id };
  }
  const [r] = await sql<{ id: string }[]>`insert into site_forms (org_unit_id, kind, title, token, default_assignee_id, created_by)
    values (${i.orgUnitId}, ${i.kind}, ${title}, ${newToken(12)}, ${i.defaultAssigneeId ?? null}, ${u.id}) returning id`;
  return { id: r.id };
}

/** QR 주소를 새로 발급 (유출된 QR 무효화) */
export async function rotateToken(u: SessionUser, id: string) {
  const sql = db();
  const [f] = await sql`select org_unit_id from site_forms where id = ${id}`;
  if (!f) throw notFound('양식이 없습니다');
  if (!atLeast(u, 'site_manager')) throw forbidden();
  await assertUnitAccess(u, f.org_unit_id, sql);
  await sql`update site_forms set token = ${newToken(12)} where id = ${id}`;
  return { ok: true };
}

export async function publicForm(token: string) {
  const [f] = await db()`select f.id, f.kind, f.title, f.enabled, o.name as org_unit_name, b.name as brand_name
    from site_forms f join org_units o on o.id = f.org_unit_id left join brands b on b.id = o.brand_id where f.token = ${token}`;
  if (!f || !f.enabled) throw notFound('사용할 수 없는 신고 양식입니다. 현장 직원에게 문의해 주세요.');
  return { kind: f.kind, kindLabel: KIND_LABEL[f.kind as keyof typeof KIND_LABEL], title: f.title, place: f.org_unit_name, brand: f.brand_name };
}

export const submitInput = z.object({
  content: z.string().trim().min(5, '내용을 5자 이상 적어 주세요').max(2000),
  location: z.string().trim().max(100).optional(),
  name: z.string().trim().max(30).optional(),
  phone: z.string().trim().max(20).regex(/^[0-9+\-() ]*$/, '연락처 형식이 올바르지 않습니다').optional(),
  website: z.string().max(0).optional(), // 숨김 미끼 필드 — 사람은 비워 둔다
  photo: z.string().max(4_500_000).optional(), // data:image/jpeg;base64,... (화면에서 줄여서 보냄)
  agree: z.boolean().optional(),
});

export async function submitForm(token: string, i: z.infer<typeof submitInput>, ip: string | null, user: SessionUser | null) {
  const sql = db();
  const [f] = await sql`select * from site_forms where token = ${token}`;
  if (!f || !f.enabled) throw notFound('사용할 수 없는 신고 양식입니다');
  if (i.website) throw badRequest('잘못된 요청입니다');
  const ipHash = sha256(`form:${ip ?? 'unknown'}`);
  const [{ recent }] = await sql<{ recent: number }[]>`select count(*)::int recent from form_submissions where ip_hash = ${ipHash} and created_at > now() - interval '10 minutes'`;
  if (recent >= 5) throw new HttpError(429, 'too_many', '잠시 후 다시 신고해 주세요 (10분에 5건까지)');
  const [{ daily }] = await sql<{ daily: number }[]>`select count(*)::int daily from form_submissions where form_id = ${f.id} and created_at > now() - interval '1 day'`;
  if (daily >= 100) throw new HttpError(429, 'too_many', '오늘 접수량이 많아 잠시 받을 수 없습니다. 현장 직원에게 직접 알려 주세요.');
  if (!user && f.kind === 'complaint' && (!i.name || !i.phone)) throw badRequest('민원 회신을 위해 이름과 연락처를 적어 주세요');
  if (!user && (i.name || i.phone) && !i.agree) throw badRequest('개인정보 수집·이용에 동의해 주세요');
  let photo: { buf: Buffer; mime: string } | null = null;
  if (i.photo) {
    const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(i.photo);
    if (!m) throw badRequest('사진은 JPG·PNG·WEBP 만 올릴 수 있습니다');
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 3 * 1024 * 1024) throw badRequest('사진이 너무 큽니다 (3MB 이하)');
    photo = { buf, mime: m[1] };
  }

  return sql.begin(async (tx) => {
    // 담당자: 양식 기본 담당자 → 없으면 그 현장(및 상위)의 현장 관리자
    let assignee: string | null = f.default_assignee_id;
    if (assignee && !(await tx`select 1 from users where id = ${assignee} and status = 'active'`).length) assignee = null;
    const managers = (await tx<{ id: string }[]>`with recursive up as (select id, parent_id from org_units where id = ${f.org_unit_id}
        union select o.id, o.parent_id from org_units o join up on o.id = up.parent_id)
      select distinct u.id from users u join memberships m on m.user_id = u.id
      where m.org_unit_id in (select id from up) and u.status = 'active' and u.role in ('site_manager','dept_lead') order by u.id`).map((r) => r.id);
    assignee ??= managers[0] ?? null;
    const creator = user?.id ?? assignee ?? (await tx<{ id: string }[]>`select id from users where role = 'owner' and status = 'active' limit 1`)[0]?.id;
    const kind = f.kind as keyof typeof KIND_LABEL;
    const tplName = KIND_TEMPLATE[kind];
    const tpl = tplName ? (await tx`select payload from templates where name = ${tplName} and not archived and not personal
      and tenant = (select tenant from org_units where id = ${f.org_unit_id}) limit 1`)[0] : null;
    const reporter = user ? `${user.name} (직원)` : i.name ? `${i.name}${i.phone ? ` · ${i.phone}` : ''}` : '익명';
    const firstLine = i.content.split('\n')[0].slice(0, 60);
    const [o] = await tx<{ brand_id: string | null }[]>`select brand_id from org_units where id = ${f.org_unit_id}`;
    const [t] = await tx<{ id: string }[]>`insert into tasks (org_unit_id, brand_id, title, description, priority, assignee_id, due_date, tags, created_by, sort_order, task_type, photo_required)
      values (${f.org_unit_id}, ${o.brand_id}, ${`[${KIND_LABEL[kind]}] ${firstLine}`},
        ${`${i.content}\n\n위치: ${i.location || '-'}\n신고자: ${reporter}\n접수: 현장 QR 양식 '${f.title}'`},
        ${kind === 'complaint' ? 'high' : 'normal'}, ${assignee}, ${addDays(todaySeoul(), KIND_DUE[kind])}, ${['현장신고', KIND_LABEL[kind]]}, ${creator},
        extract(epoch from now()), ${kind === 'facility' ? 'inspection' : 'normal'}, ${kind === 'facility' ? 1 : 0})
      returning id`;
    let n = 0;
    for (const text of (tpl?.payload?.checklist ?? []) as string[]) await tx`insert into task_checklist_items (task_id, text, sort) values (${t.id}, ${text}, ${n++})`;
    if (photo) {
      const [a] = await tx<{ id: string }[]>`insert into attachments (task_id, kind, file_name, mime_type, size_bytes, upload_status, doc_title, source, created_by, captured_at)
        values (${t.id}, 'file', ${'신고사진.' + photo.mime.split('/')[1]}, ${photo.mime}, ${photo.buf.length}, 'ready', '신고자 사진', 'upload', ${creator}, now()) returning id`;
      const key = `att/${new Date().toISOString().slice(0, 7)}/${a.id}/report.${photo.mime.split('/')[1]}`;
      await putObject(key, photo.buf, photo.mime);
      await tx`update attachments set storage_key = ${key} where id = ${a.id}`;
    }
    await tx`insert into form_submissions (form_id, task_id, reporter_name, reporter_phone, reporter_user_id, ip_hash)
      values (${f.id}, ${t.id}, ${user ? null : i.name ?? null}, ${user ? null : i.phone ?? null}, ${user?.id ?? null}, ${ipHash})`;
    await activity(tx, 'task', t.id, user?.id ?? null, 'created', { title: firstLine, source: 'site_form', form: f.title });
    await notify(tx, { userIds: [assignee, ...managers], type: 'task_assigned', title: `현장 신고 접수 (${KIND_LABEL[kind]}): ${firstLine}`,
      body: `${reporter} · ${i.location || '위치 미기재'}`, link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id, actorId: user?.id ?? null,
      dedupeKey: `form:${t.id}` });
    const { runAutomations } = await import('./automation');
    await runAutomations(tx, { trigger: 'task_created', taskId: t.id, actorId: user?.id ?? null });
    return { ok: true, receipt: t.id.slice(0, 8).toUpperCase() };
  });
}
