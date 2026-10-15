import { z } from 'zod';
import { db, type Sql } from './db';
import { newToken, sha256 } from './crypto';
import { HttpError, badRequest, notFound, unauthorized } from './errors';
import { activity, audit } from './log';
import { notify } from './notifications';
import { addDays, toSeoulDate } from './time';
import { tenantOf, type SessionUser } from './types';

/**
 * 16차: 다짐·하이링크 웹사이트 문의 → 워크인 업무 자동 등록.
 * 다짐 회사(tenant 'default') 전용 — 토큰도 그 회사에 고정되고, 다른 회사·체험 계정에는 메뉴·API 가 없다(404).
 */
export const INQUIRY_TENANT = 'default';
export const INQUIRY_TYPES = ['위탁운영', 'HILINK 플랫폼', '운영 진단·컨설팅', '기타'] as const;
type InquiryType = (typeof INQUIRY_TYPES)[number];
const SITES = { dagym: { label: '다짐', tag: '다짐웹' }, hilink: { label: '하이링크', tag: '하이링크웹' } } as const;
type Site = keyof typeof SITES;
export const PROJECT_NAME = '웹사이트 문의';

const BASE_STEPS = ['1차 연락 (접수 24시간 이내)', '요구사항 확인·현장 정보 수집', '자료/제안서 발송', '견적', '미팅 일정', '결과 기록 (수주·보류·실패)'];
export function checklistFor(type: InquiryType) {
  const s = [...BASE_STEPS];
  if (type === '위탁운영') s.splice(2, 0, '현장 실사');
  if (type === 'HILINK 플랫폼') s.splice(2, 0, '데모 일정');
  return s;
}

export function normalizeType(raw: string | null | undefined): InquiryType {
  const v = (raw ?? '').toLowerCase();
  if (/위탁/.test(v)) return '위탁운영';
  if (/hilink|하이링크|플랫폼/.test(v)) return 'HILINK 플랫폼';
  if (/진단|컨설팅/.test(v)) return '운영 진단·컨설팅';
  return '기타';
}

const s = (max: number) => z.union([z.string(), z.number()]).transform((x) => String(x).trim().slice(0, max)).optional().nullable();
export const inquiryInput = z.object({
  lead_id: z.union([z.string(), z.number()]).transform((x) => String(x).trim()).pipe(z.string().min(1, 'lead_id 가 필요합니다').max(100)),
  inquiry_type: s(60),
  organization: s(120),
  region: s(40),
  facility_scale: s(60),
  name: s(60),
  phone: s(40),
  email: s(120),
  organization_type: s(60),
  services: z.union([z.array(z.string().max(60)).max(20), z.string().max(300)]).optional().nullable(),
  current_operation: s(500),
  message: s(5000),
  submitted_at: s(40),
  created_at: s(40),
  utm: z.union([z.record(z.string(), z.unknown()), z.string().max(500)]).optional().nullable(),
  utm_source: s(120), utm_medium: s(120), utm_campaign: s(120), utm_term: s(120), utm_content: s(120),
  landing_page: s(500), landing: s(500), referrer: s(500),
}).passthrough();
type InquiryInput = z.infer<typeof inquiryInput>;

/** 접수 + 1영업일(주말·공휴일 제외) */
async function nextBusinessDay(sql: Sql, from: string) {
  const hol = new Set((await sql<{ d: string }[]>`select to_char(date, 'YYYY-MM-DD') d from holidays
    where date between ${from} and ${addDays(from, 20)} and (tenant is null or tenant = ${INQUIRY_TENANT})`).map((h) => h.d));
  let d = addDays(from, 1);
  for (let i = 0; i < 20; i++, d = addDays(d, 1)) {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    if (dow !== 0 && dow !== 6 && !hol.has(d)) return d;
  }
  return addDays(from, 1);
}

const cellText = (v: unknown) => String(v ?? '').replace(/\|/g, '／').replace(/\s*\n\s*/g, ' / ').trim() || '-';

export function describeInquiry(site: Site, type: InquiryType, i: InquiryInput, received: Date, channel: Channel = 'web') {
  const services = Array.isArray(i.services) ? i.services.join(', ') : i.services;
  const utm = typeof i.utm === 'string' ? i.utm
    : Object.entries({ ...(i.utm && typeof i.utm === 'object' ? i.utm : {}), source: i.utm_source, medium: i.utm_medium, campaign: i.utm_campaign, term: i.utm_term, content: i.utm_content })
      .filter(([, v]) => v).map(([k, v]) => `${k.replace(/^utm_/, '')}=${String(v).slice(0, 120)}`).join(' · ');
  const when = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(received);
  const rows: [string, unknown][] = [
    ['문의 유형', i.inquiry_type || type], ['회사/단지명', i.organization], ['지역', i.region], ['시설 규모/세대수', i.facility_scale],
    ['소속', i.organization_type], ['관심 서비스', services], ['현재 운영 상황', i.current_operation],
    ['접수 시각', when], ['유입 경로', [utm, i.landing_page || i.landing ? `랜딩 ${i.landing_page || i.landing}` : '', i.referrer ? `참조 ${i.referrer}` : ''].filter(Boolean).join(' · ')],
    [channel === 'phone' ? '접수 경로' : '접수 사이트', channel === 'phone' ? `${SITES[site].label} 대표번호 전화` : `${SITES[site].label} 웹사이트`], ['Lead ID', i.lead_id],
  ];
  const contact: [string, unknown][] = [['담당자', i.name], ['연락처', i.phone], ['이메일', i.email]];
  return [
    '| 항목 | 내용 |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${cellText(v)} |`),
    '', '**연락처 (보안 등급: 내부 — 업무 담당자·지시자·관리자만 볼 수 있습니다)**',
    '| 항목 | 내용 |', '|---|---|', ...contact.map(([k, v]) => `| ${k} | ${cellText(v)} |`),
    '', '**문의 내용 원문**', (i.message ?? '').trim() || '-',
  ].join('\n');
}

async function tokenFromHeader(sql: Sql, auth: string | null) {
  const raw = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!raw) throw unauthorized('연동 토큰이 필요합니다');
  const [t] = await sql<{ id: string; tenant: string; site: Site }[]>`select id, tenant, site from integration_tokens
    where token_hash = ${sha256(`inquiry:${raw}`)} and revoked_at is null`;
  if (!t) throw unauthorized('연동 토큰이 올바르지 않습니다');
  if (t.tenant !== INQUIRY_TENANT) throw unauthorized('연동 토큰이 올바르지 않습니다'); // 다짐 회사 고정
  return t;
}

/** 사이트 → 워크인. 같은 lead_id 재전송은 같은 업무를 돌려준다 */
export async function receiveInquiry(auth: string | null, raw: unknown) {
  const sql = db();
  const tok = await tokenFromHeader(sql, auth);
  const i = inquiryInput.parse(raw);
  const [{ recent }] = await sql<{ recent: number }[]>`select count(*)::int recent from inquiries where token_id = ${tok.id} and created_at > now() - interval '1 hour'`;
  if (recent >= 120) throw new HttpError(429, 'too_many', '한 시간 접수 한도를 넘었습니다');
  await sql`update integration_tokens set last_used_at = now() where id = ${tok.id}`;
  const type = normalizeType(i.inquiry_type);
  const site = tok.site;
  const received = (() => { const d = new Date(String(i.submitted_at || i.created_at || '')); return isNaN(+d) || +d > Date.now() + 3600e3 ? new Date() : d; })();

  return insertInquiry(sql, { site, type, i, received, tokenId: tok.id, channel: 'web', actorId: null });
}

type Channel = 'web' | 'phone';
/** 문의 1건 → 문의 기록 + 업무(유형별 담당·체크리스트·알림). 웹사이트·전화 문의 공용 */
async function insertInquiry(sql: ReturnType<typeof db>, a: { site: Site; type: InquiryType; i: InquiryInput; received: Date; tokenId: string | null; channel: Channel; actorId: string | null }) {
  const { site, type, i, received } = a;
  const org = i.organization || i.name || '이름 없는 문의';
  const out = await sql.begin(async (tx) => {
    const [ins] = await tx<{ id: string }[]>`insert into inquiries (tenant, lead_id, site, inquiry_type, organization, token_id, payload)
      values (${INQUIRY_TENANT}, ${i.lead_id}, ${site}, ${type}, ${i.organization ?? null}, ${a.tokenId}, ${tx.json(i as never)})
      on conflict (tenant, lead_id) do nothing returning id`;
    if (!ins) {
      const [prev] = await tx<{ task_id: string | null }[]>`select task_id from inquiries where tenant = ${INQUIRY_TENANT} and lead_id = ${i.lead_id}`;
      return { ok: true, duplicate: true, taskId: prev?.task_id ?? null, taskIds: [] as string[] };
    }
    const [ceo] = await tx<{ id: string }[]>`select id from users where tenant = ${INQUIRY_TENANT} and role = 'owner' and status = 'active' and not is_demo order by created_at limit 1`;
    if (!ceo) throw new HttpError(503, 'no_owner', '받을 대표 계정이 없습니다');
    const [hq] = await tx<{ id: string; brand_id: string | null }[]>`select id, brand_id from org_units where tenant = ${INQUIRY_TENANT} and parent_id is null and not is_demo order by created_at limit 1`;
    let [proj] = await tx<{ id: string }[]>`select p.id from projects p join org_units o on o.id = p.org_unit_id
      where o.tenant = ${INQUIRY_TENANT} and p.name = ${PROJECT_NAME} and not p.archived order by p.created_at limit 1`;
    if (!proj) {
      [proj] = await tx<{ id: string }[]>`insert into projects (name, description, org_unit_id, owner_id, color, created_by)
        values (${PROJECT_NAME}, '다짐·하이링크 웹사이트 문의가 자동으로 등록됩니다 (16차 연동)', ${hq.id}, ${ceo.id}, '#0ea5e9', ${ceo.id}) returning id`;
    }
    let [sec] = await tx<{ id: string }[]>`select id from project_sections where project_id = ${proj.id} and name = ${type} limit 1`;
    if (!sec) [sec] = await tx<{ id: string }[]>`insert into project_sections (project_id, name, sort) values (${proj.id}, ${type}, ${INQUIRY_TYPES.indexOf(type)}) returning id`;
    // 유형별 기본 담당자(여러 명, 순서 = 첫 사람이 주 담당). 비활성·다른 회사 사람은 건너뛰고, 아무도 없으면 대표
    const [setting] = await tx<{ assignee_ids: string[]; mode: string }[]>`select assignee_ids, mode from inquiry_settings where tenant = ${INQUIRY_TENANT} and inquiry_type = ${type}`;
    const want = setting?.assignee_ids ?? [];
    const okIds = new Set((await tx<{ id: string }[]>`select id from users where id = any(${want}::uuid[]) and status = 'active' and tenant = ${INQUIRY_TENANT}`).map((r) => r.id));
    let people = want.filter((x) => okIds.has(x));
    if (!people.length) people = [ceo.id];
    const each = setting?.mode === 'each' && people.length > 1;
    const title = `[${SITES[site].label} ${a.channel === 'phone' ? '전화 ' : ''}문의] ${org}${i.inquiry_type || type !== '기타' ? ` · ${i.inquiry_type || type}` : ''}${i.region ? ` (${i.region})` : ''}`.slice(0, 200);
    const services = (Array.isArray(i.services) ? i.services : (i.services ?? '').split(/[,·]/)).map((x) => x.trim()).filter(Boolean);
    const tags = [...new Set([SITES[site].tag, i.region, ...services].filter((x): x is string => !!x).map((x) => x.slice(0, 30)))].slice(0, 20);
    const due = await nextBusinessDay(tx, toSeoulDate(received));
    const desc = describeInquiry(site, type, i, received, a.channel);
    const batchId = each ? crypto.randomUUID() : null;
    const taskIds: string[] = [];
    for (const assignee of each ? people : [people[0]]) {
      const [t] = await tx<{ id: string }[]>`insert into tasks (project_id, org_unit_id, brand_id, title, description, status, priority, assignee_id,
          due_date, due_time, tags, created_by, requested_by, sort_order, section_id, assignee_ack_at, batch_id)
        values (${proj.id}, ${hq.id}, ${site}, ${title}, ${desc}, 'todo', 'high', ${assignee},
          ${due}, '18:00', ${tags}, ${ceo.id}, ${ceo.id}, extract(epoch from now()), ${sec.id}, ${assignee === ceo.id ? new Date() : null}, ${batchId})
        returning id`;
      taskIds.push(t.id);
      if (!each) for (const c of people.slice(1)) await tx`insert into task_collaborators (task_id, user_id) values (${t.id}, ${c}) on conflict do nothing`;
      let n = 0;
      for (const text of checklistFor(type)) { // 1차 연락 항목 담당 = 주 담당
        await tx`insert into task_checklist_items (task_id, text, sort, assignee_id) values (${t.id}, ${text}, ${n}, ${n === 0 ? assignee : null})`; n++;
      }
      await activity(tx, 'task', t.id, a.actorId, 'created', { title, source: a.channel === 'phone' ? 'phone_inquiry' : 'website_inquiry', site, leadId: i.lead_id });
      await notify(tx, { userIds: each ? [assignee] : people, type: 'task_assigned', title: `새 ${a.channel === 'phone' ? '전화' : '웹사이트'} 문의 · ${org}`.slice(0, 120),
        body: `${SITES[site].label} · ${type}${i.region ? ` · ${i.region}` : ''} · 마감 ${due} 18:00${!each && people.length > 1 ? ` · 주 담당 외 협업 ${people.length - 1}명` : ''}`, link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
        actorId: a.actorId, dedupeKey: `inquiry:${t.id}` });
      const { runAutomations } = await import('./automation');
      await runAutomations(tx, { trigger: 'task_created', taskId: t.id, actorId: null });
    }
    await tx`update inquiries set task_id = ${taskIds[0]} where id = ${ins.id}`;
    return { ok: true, duplicate: false, taskId: taskIds[0], taskIds, ceoId: ceo.id };
  });
  return out;
}

/** 설명 맨 위에 AI 한 줄 요약(선택). 응답 뒤에 실행 — 실패·한도 초과면 조용히 건너뜀 */
export async function summarizeInquiry(taskIds: string[], ceoId: string) {
  const taskId = taskIds[0];
  const { aiEnabled, anthropicProvider, costUsd } = await import('./ai/provider');
  if (!aiEnabled() || process.env.INQUIRY_AI_SUMMARY === '0') return;
  const sql = db();
  try {
    const [u] = await sql`select id, tenant, is_demo from users where id = ${ceoId}`;
    if (!u) return;
    const ok = await (await import('./plans')).assertAiRequest({ id: u.id, tenant: u.tenant, isDemo: u.is_demo } as SessionUser).then(() => true, () => false);
    if (!ok) return;
    const [t] = await sql<{ description: string }[]>`select description from tasks where id = ${taskId}`;
    if (!t || t.description.startsWith('> AI 요약')) return;
    const body = t.description.replace(/\*\*연락처[\s\S]*?\*\*문의 내용 원문\*\*/, '**문의 내용 원문**'); // 연락처는 AI 에 보내지 않는다
    const p = anthropicProvider({ tier: 'fast' });
    const r = await p.chat({ system: '웹사이트 영업 문의를 담당자가 바로 이해하도록 한국어 한 문장(60자 이내)으로 요약합니다. 이름·전화·이메일은 쓰지 않습니다. 요약만 출력합니다.',
      tools: [], messages: [{ role: 'user', content: body.slice(0, 4000) }] });
    const line = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').replace(/\s+/g, ' ').trim().slice(0, 120);
    await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
      values (${INQUIRY_TENANT}, ${u.id}, ${crypto.randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0},
        ${r.usage.cache_creation_input_tokens ?? 0}, ${costUsd(r.model ?? p.model, r.usage)}, 'inquiry_summary')`;
    if (line) await sql`update tasks set description = ${`> AI 요약: ${line}\n\n`} || description where id = any(${taskIds}::uuid[]) and description not like '> AI 요약%'`;
  } catch { /* 요약은 선택 기능 */ }
}

// ---- 플랫폼 운영 화면(다짐 회사 슈퍼관리자 전용) ----
function assertInquiryAdmin(u: SessionUser) {
  if (!u.platformAdmin || tenantOf(u) !== INQUIRY_TENANT || u.isDemo) throw notFound(); // 있는 줄도 모르게
}

export async function inquiryAdmin(u: SessionUser) {
  assertInquiryAdmin(u);
  const sql = db();
  const [tokens, settings, users, recent] = await Promise.all([
    sql`select t.id, t.site, t.name, t.hint, t.created_at, t.last_used_at, t.revoked_at, u.name as created_by_name
      from integration_tokens t left join users u on u.id = t.created_by where t.tenant = ${INQUIRY_TENANT} order by t.revoked_at nulls first, t.created_at desc`,
    sql<{ inquiry_type: string; assignee_ids: string[]; mode: string }[]>`select inquiry_type, assignee_ids, mode from inquiry_settings where tenant = ${INQUIRY_TENANT}`,
    sql`select id, name, role from users where tenant = ${INQUIRY_TENANT} and status = 'active' and not is_demo order by name`,
    sql`select q.lead_id, q.site, q.inquiry_type, q.organization, q.created_at, q.task_id, t.title, t.status, a.name as assignee_name
      from inquiries q left join tasks t on t.id = q.task_id left join users a on a.id = t.assignee_id
      where q.tenant = ${INQUIRY_TENANT} order by q.created_at desc limit 20`,
  ]);
  return { types: INQUIRY_TYPES, tokens, assignees: Object.fromEntries(settings.map((x) => [x.inquiry_type, x.assignee_ids])), modes: Object.fromEntries(settings.map((x) => [x.inquiry_type, x.mode])), users, recent,
    endpoint: `${process.env.APP_URL ?? ''}/api/integrations/inquiries` };
}

export const tokenInput = z.object({ site: z.enum(['dagym', 'hilink']), name: z.string().trim().max(60).optional() });
export async function issueToken(u: SessionUser, i: z.infer<typeof tokenInput>) {
  assertInquiryAdmin(u);
  const raw = `wkin_${newToken(24)}`;
  const [t] = await db()`insert into integration_tokens (tenant, site, name, token_hash, hint, created_by)
    values (${INQUIRY_TENANT}, ${i.site}, ${i.name || `${SITES[i.site].label} 웹사이트`}, ${sha256(`inquiry:${raw}`)}, ${raw.slice(-4)}, ${u.id}) returning id`;
  await audit(db(), u.id, 'integration_token.issued', 'integration_token', t.id, { site: i.site });
  return { id: t.id, token: raw }; // 원문은 이번 한 번만
}

export async function revokeToken(u: SessionUser, id: string) {
  assertInquiryAdmin(u);
  const r = await db()`update integration_tokens set revoked_at = now() where id = ${id} and tenant = ${INQUIRY_TENANT} and revoked_at is null returning id`;
  if (!r.length) throw notFound();
  await audit(db(), u.id, 'integration_token.revoked', 'integration_token', id);
  return { ok: true };
}

export const assigneesInput = z.object({
  assignees: z.record(z.enum(INQUIRY_TYPES), z.union([z.array(z.string().uuid()).max(10), z.string().uuid(), z.null()])),
  modes: z.record(z.enum(INQUIRY_TYPES), z.enum(['together', 'each'])).optional(),
});
export async function setInquiryAssignees(u: SessionUser, i: z.infer<typeof assigneesInput>) {
  assertInquiryAdmin(u);
  const sql = db();
  const lists = Object.fromEntries(Object.entries(i.assignees).map(([k, v]) => [k, [...new Set(Array.isArray(v) ? v : v ? [v] : [])]])) as Record<string, string[]>;
  const ids = [...new Set(Object.values(lists).flat())];
  if (ids.length) {
    const ok = await sql`select id from users where id = any(${ids}::uuid[]) and tenant = ${INQUIRY_TENANT} and status = 'active'`;
    if (ok.length !== ids.length) throw badRequest('다짐 회사의 활성 사용자만 지정할 수 있습니다');
  }
  for (const [type, list] of Object.entries(lists)) {
    const mode = i.modes?.[type as InquiryType] ?? 'together';
    await sql`insert into inquiry_settings (tenant, inquiry_type, assignee_id, assignee_ids, mode) values (${INQUIRY_TENANT}, ${type}, ${list[0] ?? null}, ${list}, ${mode})
      on conflict (tenant, inquiry_type) do update set assignee_id = excluded.assignee_id, assignee_ids = excluded.assignee_ids, mode = excluded.mode, updated_at = now()`;
  }
  return { ok: true };
}

// ---- V21 1장: 대표번호 전화 문의 → 업무(문의 단계 그대로). 다짐 회사 직원 누구나 등록 ----
export const phoneInquiryInput = z.object({
  site: z.enum(['dagym', 'hilink']), inquiryType: z.enum(INQUIRY_TYPES), organization: z.string().trim().max(120).optional(),
  name: z.string().trim().max(60).optional(), phone: z.string().trim().max(40).optional(), email: z.string().trim().email('이메일 형식이 아닙니다').max(120).optional().or(z.literal('')),
  region: z.string().trim().max(40).optional(), message: z.string().trim().min(1, '문의 내용을 적어 주세요').max(5000),
});
export async function registerPhoneInquiry(u: SessionUser, x: z.infer<typeof phoneInquiryInput>) {
  if (tenantOf(u) !== INQUIRY_TENANT || u.isDemo) throw notFound();
  if (!x.organization && !x.name) throw badRequest('소속(아파트명 등) 또는 이름을 적어 주세요');
  const sql = db();
  const i = inquiryInput.parse({ lead_id: `phone-${crypto.randomUUID()}`, inquiry_type: x.inquiryType, organization: x.organization, name: x.name, phone: x.phone,
    email: x.email || undefined, region: x.region, message: x.message, submitted_at: new Date().toISOString() });
  const out = await insertInquiry(sql, { site: x.site, type: x.inquiryType, i, received: new Date(), tokenId: null, channel: 'phone', actorId: u.id });
  return { taskId: out.taskId, taskIds: out.taskIds };
}
