import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db, type Sql } from './db';
import { isAdmin } from './access';
import { assertSpace, tenantSpaces, userSpaces } from './spaces';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { decrypt } from './crypto';
import { audit, logError } from './log';
import { fmtPhone, normPhone } from './contacts';
import { tenantOf, type SessionUser } from './types';
import { metaGraph } from './metaGraph';

/**
 * 광고 2차 ① Meta 리드 광고 → 영업 리드 자동 등록(설계 AI_ADS_OPERATIONS_DESIGN 6절 B · META_APP_REVIEW_PLAN R5).
 * - 받기: 웹후크(page › leadgen, 앱 시크릿 서명 확인) → 리드 답변 읽기(leads_retrieval) → 영업 리드 '신규리드'.
 *   같은 전화번호 리드가 있으면 새로 만들지 않고 그 리드에 상담 기록으로 붙인다. 같은 리드(leadgen_id)는 한 번만.
 *   웹후크가 안 와도 점검(tick)마다 양식별 최근 리드를 읽어 놓친 것을 채운다(웹후크가 하루 넘게 없으면 30분, 있으면 2시간 간격).
 * - 담당: 영업 담당 규칙(원천 '리드', 부재면 부 담당) → 없으면 리드 광고를 켠 관리자 → 대표. 업무 '[리드 광고] 이름 — 5분 안에 첫 연락' + 알림(이름 가림).
 * - 첫 연락 = 상담 기록·단계 변경(사람)·[전화]/[문자] 누름·첫 연락 업무 완료 중 가장 이른 때. 5분이 지나도 없으면 다음 점검 때 담당·관리자에게 다시 알림.
 * - 개인정보(이름·전화·답)는 영업 리드에만 저장하고, mkt_meta_leads 에는 처리 기록(양식·광고 이름·시각·상태)만 둔다.
 * - 시험 리드([시험 리드 보내기] = Meta test_leads API)는 이름 앞에 [시험], 알림은 누른 사람에게만(#104).
 */
const T = () => process.env.ADS_TEST_BASE?.replace(/\/$/, '');
const GRAPH = metaGraph; // 버전은 metaGraph.ts 한곳
/** 리드 읽기(leads_retrieval·pages_manage_ads)·페이지에 앱 설치(pages_manage_metadata)·광고 칸(ads_management) — Meta 문서 '리드 가져오기' 기준 */
export const META_LEAD_SCOPES = ['leads_retrieval', 'pages_manage_ads', 'pages_manage_metadata', 'ads_management'];
export const hasLeadScopes = (scopes: string[] | null | undefined) => META_LEAD_SCOPES.every((s) => (scopes ?? []).includes(s));
export const LATE_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const ID_RE = /^\d{1,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = 'id,created_time,ad_id,ad_name,campaign_name,form_id,platform,is_organic,field_data';
const FIELDS_MIN = 'id,created_time,ad_id,form_id,field_data'; // 광고 이름 칸을 못 읽는 경우(권한·버전) — 문서에 있는 칸만
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);

class GraphError extends Error { constructor(message: string, readonly code: number | null) { super(message); } }
/** Graph 호출(오류 문구에는 경로만 — 토큰이 든 주소는 남기지 않음) */
async function gx(url: string, init: { method?: 'GET' | 'POST' | 'DELETE'; form?: Record<string, string> } = {}) {
  const r = await fetch(url, { method: init.method ?? 'GET', ...(init.form ? { body: new URLSearchParams(init.form), headers: { 'content-type': 'application/x-www-form-urlencoded' } } : {}), signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* JSON 아님 */ }
  if (!r.ok || j?.error) {
    const path = (() => { try { return new URL(url).pathname.replace(/^\/graph/, '').replace(/^\/v\d+\.\d+/, ''); } catch { return ''; } })();
    throw new GraphError(`Meta API 오류 ${r.status} ${path} ${String(j?.error?.message ?? '').slice(0, 200)}`.trim(), Number(j?.error?.code) || null);
  }
  return j;
}
const gurl = (path: string, q: Record<string, string>) => `${GRAPH()}/${path}?${new URLSearchParams(q)}`;
/** 다음 쪽 주소는 Graph 주소일 때만 따라감 */
const nextUrl = (r: any): string | null => { const n = r?.paging?.next; return typeof n === 'string' && n.startsWith(new URL(GRAPH()).origin) ? n : null; };
const msgOf = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

// ---------------- 웹후크 ----------------
/** 앱 대시보드에서 콜백 주소를 저장할 때 Meta 가 부르는 확인 — 확인 토큰(META_WEBHOOK_VERIFY_TOKEN)이 맞으면 hub.challenge 를 그대로 */
export function verifyChallenge(q: URLSearchParams): string | null {
  const want = process.env.META_WEBHOOK_VERIFY_TOKEN ?? '';
  const got = q.get('hub.verify_token') ?? '';
  if (!want || q.get('hub.mode') !== 'subscribe' || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return null;
  return (q.get('hub.challenge') ?? '').slice(0, 200);
}
/** X-Hub-Signature-256 = sha256=HMAC(앱 시크릿, 받은 본문 그대로) */
export function validSignature(raw: Buffer, header: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith('sha256=')) return false;
  const want = createHmac('sha256', secret).update(raw).digest('hex');
  const got = header.slice(7);
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
/** 서명 확인 → leadgen 마다 리드 광고를 켠 회사의 처리 대기 행(같은 리드는 한 번). 반환 = 새로 받은 행 id(응답 뒤 처리) */
export async function receiveWebhook(raw: Buffer, signature: string | null): Promise<string[]> {
  if (!validSignature(raw, signature)) throw new HttpError(403, 'bad_signature', '서명이 맞지 않습니다');
  // 큰 숫자 id 가 숫자로 오면 JSON 에서 자릿수가 깨지므로 문자열로 바꿔 읽음
  const text = raw.toString('utf8').replace(/"(leadgen_id|page_id|form_id|ad_id|adgroup_id|id)"\s*:\s*(\d{15,})/g, '"$1":"$2"');
  let body: any; try { body = JSON.parse(text); } catch { throw badRequest('JSON 이 아닙니다'); }
  if (body?.object !== 'page' || !Array.isArray(body.entry)) return [];
  const sql = db(); const ids: string[] = [];
  for (const e of body.entry.slice(0, 50)) {
    for (const c of Array.isArray(e?.changes) ? e.changes.slice(0, 100) : []) {
      const v = c?.value ?? {};
      const leadgen = String(v.leadgen_id ?? ''); const pageId = String(v.page_id ?? e?.id ?? '');
      if (c?.field !== 'leadgen' || !ID_RE.test(leadgen) || !ID_RE.test(pageId)) continue;
      const pages = await sql<{ account_id: string; tenant: string }[]>`update mkt_lead_pages set webhook_at = now(), updated_at = now() where page_id = ${pageId} and enabled returning account_id, tenant`;
      const form = ID_RE.test(String(v.form_id ?? '')) ? String(v.form_id) : null, ad = ID_RE.test(String(v.ad_id ?? '')) ? String(v.ad_id) : null;
      const created = Number(v.created_time) > 0 ? new Date(Number(v.created_time) * 1000) : null;
      for (const p of pages) {
        const [r] = await sql<{ id: string }[]>`insert into mkt_meta_leads (tenant, account_id, page_id, leadgen_id, form_id, ad_id, created_time, via)
          values (${p.tenant}, ${p.account_id}, ${pageId}, ${leadgen}, ${form}, ${ad}, ${created}, 'webhook') on conflict (tenant, leadgen_id) do nothing returning id`;
        if (r) ids.push(r.id);
      }
    }
  }
  return ids;
}

// ---------------- 리드 읽기·풀이 ----------------
type LeadData = { id?: string; created_time?: string; ad_id?: string; ad_name?: string; campaign_name?: string; form_id?: string; platform?: string; is_organic?: boolean; field_data?: { name?: string; values?: unknown }[] };
async function fetchLead(leadgenId: string, token: string): Promise<LeadData> {
  try { return await gx(gurl(leadgenId, { fields: FIELDS, access_token: token })); }
  catch (e) { if (e instanceof GraphError && e.code === 100) return gx(gurl(leadgenId, { fields: FIELDS_MIN, access_token: token })); throw e; }
}
const formNames = new Map<string, string>();
async function formName(formId: string | null, token: string) {
  if (!formId || !ID_RE.test(formId)) return null;
  if (formNames.has(formId)) return formNames.get(formId)!;
  const n = await gx(gurl(formId, { fields: 'name', access_token: token })).then((j) => (j?.name ? String(j.name).slice(0, 200) : null), () => null);
  if (n) { if (formNames.size > 500) formNames.clear(); formNames.set(formId, n); }
  return n;
}
const DUMMY = /^<test lead: dummy data for .+>$/i; // 시험 리드의 자리 채움 값
const STD = { person: ['full_name', 'name', '이름', '성함', '성명'], first: ['first_name'], last: ['last_name'], company: ['company_name', 'company', '회사명', '업체명', '상호', '기관명'],
  phone: ['phone_number', 'phone', 'work_phone_number', 'mobile', '전화번호', '연락처', '휴대폰', '휴대전화'], email: ['email', 'work_email', '이메일'], region: ['city', 'state', 'province', 'region', '지역', '주소', 'street_address'] };
const STD_KEYS = new Set(Object.values(STD).flat());
/** 양식 답 → 이름·회사·전화·이메일·지역 + 나머지 질문 답(질문 이름은 양식에 적힌 그대로) */
export function parseLead(l: LeadData) {
  const f = new Map<string, string>(); const answers: { q: string; a: string }[] = [];
  for (const x of Array.isArray(l.field_data) ? l.field_data.slice(0, 60) : []) {
    const q = String(x?.name ?? '').trim().slice(0, 100); if (!q) continue;
    const a = (Array.isArray(x?.values) ? x.values : [x?.values]).map((v) => String(v ?? '').trim()).filter(Boolean).join(', ').slice(0, 1000);
    if (!f.has(q.toLowerCase())) f.set(q.toLowerCase(), DUMMY.test(a) ? '' : a);
    answers.push({ q, a });
  }
  const g = (keys: string[]) => keys.map((k) => f.get(k) ?? '').find(Boolean) ?? '';
  const last = g(STD.last), first = g(STD.first);
  const person = (g(STD.person) || [last, first].filter(Boolean).join(/^[가-힣]+$/.test(last + first) ? '' : ' ')).slice(0, 100);
  const raw = g(STD.phone);
  return { person, company: g(STD.company).slice(0, 120), phone: raw ? String(fmtPhone(raw) ?? raw).slice(0, 40) : '', email: g(STD.email).slice(0, 200), region: g(STD.region).slice(0, 50),
    answers, extra: answers.filter((x) => !STD_KEYS.has(x.q.toLowerCase())) };
}
/** 알림(잠금 화면)용 이름 가리기 — 홍길동 → 홍*동 */
export function maskName(s: string) {
  const t = s.replace(/^\[시험\]\s*/, '').trim();
  if (t.length <= 1) return t || '이름 없음';
  if (t.length === 2) return `${t[0]}*`;
  return `${t[0]}${'*'.repeat(Math.min(t.length - 2, 3))}${t.at(-1)}`;
}
/** 세션 없이(웹후크·점검) 업무를 만들 때 쓰는 사람 — 계정이 막혔으면 null */
async function actorFor(sql: Sql, userId: string | null | undefined): Promise<SessionUser | null> {
  if (!userId) return null;
  const [r] = await sql<any[]>`select u.id, u.email, u.name, u.role, u.status, u.timezone, u.is_demo, u.platform_admin, u.tenant, t.kind from users u join tenants t on t.id = u.tenant
    where u.id = ${userId} and u.status = 'active'`;
  return r ? ({ id: r.id, email: r.email, name: r.name, role: r.role, status: r.status, timezone: r.timezone, sessionId: '', isDemo: r.is_demo, platformAdmin: r.platform_admin, tenant: r.tenant, personal: r.kind === 'personal' } as SessionUser) : null;
}
/** 담당: (기존 리드면 그 담당) → 영업 담당 규칙(원천 '리드') → 리드 광고를 켠 사람 → 대표 */
async function pickOwner(sql: Sql, tenant: string, existing: string | null, enabledBy: string | null) {
  const active = async (id: string | null) => !!id && (await sql`select 1 from users where id = ${id} and tenant = ${tenant} and status = 'active'`).length > 0;
  if (await active(existing)) return { userId: existing!, ruleId: null as string | null };
  const rule = await (await import('./assignees')).resolveAssignee(sql, tenant, 'sales_source', 'lead').catch(() => null);
  if (rule) return { userId: rule.userId, ruleId: rule.ruleId };
  if (await active(enabledBy)) return { userId: enabledBy!, ruleId: null };
  const admin = await (await import('./spaceNotify')).fallbackAdmin(sql, tenant);
  return admin ? { userId: admin, ruleId: null } : null;
}

type Row = { id: string; tenant: string; account_id: string | null; page_id: string; leadgen_id: string; form_id: string | null; ad_id: string | null; via: string; is_test: boolean;
  received_at: Date; created_time: Date | null; created_by: string | null };
/** 처리 대기 1건 → 영업 리드(또는 같은 전화번호 리드에 기록) + 업무 + 알림. 여러 곳(웹후크 응답 뒤·점검·버튼)에서 불러도 한 번만 처리 */
export async function processMetaLead(id: string, pre?: LeadData | null): Promise<{ status: string; leadId?: string | null; error?: string }> {
  const sql = db();
  const [m] = await sql<Row[]>`update mkt_meta_leads set status = 'working', attempts = attempts + 1, updated_at = now()
    where id = ${id} and attempts < ${MAX_ATTEMPTS} and (status in ('pending', 'failed') or (status = 'working' and updated_at < now() - interval '5 minutes'))
    returning id, tenant, account_id, page_id, leadgen_id, form_id, ad_id, via, is_test, received_at, created_time, created_by`;
  if (!m) return { status: 'busy' };
  const stop = async (status: 'failed' | 'skipped', error: string) => {
    await sql`update mkt_meta_leads set status = ${status}, error = ${error.slice(0, 500)}, updated_at = now() where id = ${m.id}`;
    return { status, error };
  };
  try {
    const [acc] = m.account_id ? await sql<{ token_enc: string | null; label: string; enabled_by: string | null; created_by: string | null }[]>`select a.token_enc, a.label, p.enabled_by, a.created_by
      from mkt_publish_accounts a join mkt_lead_pages p on p.account_id = a.id where a.id = ${m.account_id} and a.tenant = ${m.tenant} and a.status <> 'disconnected'` : [];
    if (!acc?.token_enc) return await stop('skipped', '페이지 연결이 끊겨 리드를 읽지 못했습니다 — 연결 계정에서 [리드 광고 받기]로 다시 연결한 뒤 [다시 처리]를 눌러 주세요');
    if (!(await tenantSpaces(m.tenant, sql)).includes('sales')) return await stop('skipped', '영업 공간이 꺼져 있어 영업 리드를 만들지 않았습니다 — 관리 › 공간에서 영업을 켠 뒤 [다시 처리]를 눌러 주세요');
    if (!(await (await import('./sales/cutover')).writesOpen(m.tenant))) return await stop('skipped', '영업 리드 쓰기가 아직 열리지 않았습니다(영업관리 전환 전) — 전환 뒤 [다시 처리]를 눌러 주세요');
    const token = decrypt(acc.token_enc);
    const l = pre ?? await fetchLead(m.leadgen_id, token);
    const formId = ID_RE.test(String(l.form_id ?? '')) ? String(l.form_id) : m.form_id;
    const adId = ID_RE.test(String(l.ad_id ?? '')) ? String(l.ad_id) : m.ad_id;
    const fName = await formName(formId, token);
    // 광고 이름이 리드에 없으면 광고 성과(광고 단위)에서
    let adName = l.ad_name ? String(l.ad_name).slice(0, 200) : null, campaign = l.campaign_name ? String(l.campaign_name).slice(0, 200) : null;
    if (adId && (!adName || !campaign)) {
      const [it] = await sql<{ item_name: string | null; campaign_name: string | null }[]>`select s.item_name, s.campaign_name from mkt_ad_items s join mkt_ad_accounts a on a.id = s.account_id
        where a.tenant = ${m.tenant} and a.provider = 'meta' and s.kind = 'ad' and s.item_id = ${adId} order by s.day desc limit 1`;
      adName ??= it?.item_name || null; campaign ??= it?.campaign_name || null;
    }
    const p = parseLead(l);
    const display = (p.company || p.person || '리드 광고 신청').slice(0, 120);
    const name = `${m.is_test ? '[시험] ' : ''}${display}`.slice(0, 300);
    const createdAt = l.created_time && !Number.isNaN(Date.parse(l.created_time)) ? new Date(l.created_time) : m.created_time ?? m.received_at;
    const src = { from: 'meta_lead', metaLeadId: m.id, leadgenId: m.leadgen_id, pageId: m.page_id, pageName: acc.label, formId, formName: fName, adId, adName, campaignName: campaign,
      platform: l.platform ? String(l.platform).slice(0, 20) : null, createdTime: createdAt.toISOString(), answers: p.answers, ...(m.is_test ? { test: true } : {}) };
    const where = [fName ? `양식 '${fName}'` : '양식', adName ? `광고 '${adName}'` : (adId ? null : '광고 없음(자연 유입·시험)')].filter(Boolean).join(' · ');
    const today = ymd(new Date());
    // 같은 전화번호(숫자만 비교, +82 → 0) 리드가 있으면 그 리드에
    const digits = normPhone(p.phone) ?? '';
    const [dup] = digits.length >= 9 ? await sql<{ id: string; name: string; owner_id: string | null; status: string | null }[]>`select id, name, owner_id, status from sales_leads where tenant = ${m.tenant} and deleted_at is null
      and regexp_replace(regexp_replace(coalesce(phone, ''), '^\\s*\\+82', '0'), '\\D', '', 'g') = ${digits} order by updated_at desc limit 1` : [];
    const owner = await pickOwner(sql, m.tenant, dup?.owner_id ?? null, acc.enabled_by ?? acc.created_by);
    if (!owner) return await stop('failed', '담당을 정할 사람이 없습니다(활성 관리자 없음)');
    let leadId: string;
    if (dup) {
      leadId = dup.id;
      await sql.begin(async (tx) => {
        await tx`insert into sales_lead_records (tenant, kind, lead_id, occurred_at, data) values (${m.tenant}, 'sales_activities', ${leadId}, now(),
          ${tx.json({ activity_type: '기타', content: [`리드 광고로 다시 신청 — ${where}`, ...p.extra.map((x) => `${x.q}: ${x.a}`)].join('\n').slice(0, 5000), activity_date: today, source: 'meta_lead', created_by: null, created_by_name: '리드 광고(자동)' })})`;
        await tx`update sales_leads set next_contact_date = least(coalesce(next_contact_date, ${today}::date), ${today}::date), updated_at = now() where id = ${leadId}`;
      });
    } else {
      const memo = [`리드 광고 · ${where}`, ...p.extra.map((x) => `${x.q}: ${x.a}`)].join('\n').slice(0, 5000);
      leadId = await sql.begin(async (tx) => {
        const [r] = await tx<{ id: string }[]>`insert into sales_leads (tenant, name, status, region, owner_id, next_contact_date, contact_name, phone, email, memo, src)
          values (${m.tenant}, ${name}, '신규리드', ${p.region || null}, ${owner.userId}, ${today}, ${p.person || null}, ${p.phone || null}, ${p.email || null}, ${memo}, ${tx.json(src as never)}) returning id`;
        await tx`insert into sales_status_log (tenant, lead_id, from_status, to_status, reason, changed_by) values (${m.tenant}, ${r.id}, null, '신규리드', '리드 광고(메타) 자동 등록', null)`;
        return r.id;
      });
    }
    // 담당 업무(5분 안에 첫 연락) — 요청자 = 리드 광고를 켠 사람(없으면 담당)
    let taskId: string | null = null;
    const actor = (await actorFor(sql, acc.enabled_by ?? acc.created_by)) ?? (await actorFor(sql, owner.userId));
    if (actor) {
      try {
        const { createTask } = await import('./tasks');
        const title = `[리드 광고] ${dup ? dup.name : name} — ${dup ? '다시 신청, ' : ''}${LATE_MINUTES}분 안에 첫 연락`.slice(0, 200);
        const desc = [`메타 리드 광고로 들어온 신청입니다 — ${LATE_MINUTES}분 안에 연락해 주세요.`, `이름: ${p.person || '-'}${p.company ? ` · 회사: ${p.company}` : ''} · 전화: ${p.phone || '-'}${p.email ? ` · 이메일: ${p.email}` : ''}`,
          where, `리드: /s/sales/leads?id=${leadId}`, '(리드에서 [전화]·[문자]를 누르거나 상담 기록·단계를 바꾸면 연락한 것으로 셉니다)'].join('\n');
        const t = await createTask(actor, { title, description: desc, space: 'sales', assigneeId: owner.userId, requestedById: actor.id, dueDate: today, priority: 'high', approvalRequired: false, tags: ['영업', '리드 광고'] } as never, { quiet: true, skipQuota: true });
        await sql`update tasks set sales_ref = ${sql.json({ kind: 'lead', id: leadId, name: dup ? dup.name : name })}, lead_id = ${leadId}, assigned_by_rule = ${owner.ruleId} where id = ${t.id}`;
        taskId = t.id;
      } catch (e) { await logError('meta-leads:task', e, { metaLeadId: m.id }).catch(() => {}); }
    }
    await sql`update mkt_meta_leads set status = ${dup ? 'merged' : 'created'}, error = null, lead_id = ${leadId}, owner_id = ${owner.userId}, task_id = ${taskId}, form_id = ${formId}, form_name = ${fName},
      ad_id = ${adId}, ad_name = ${adName}, campaign_name = ${campaign}, platform = ${src.platform}, created_time = ${createdAt}, updated_at = now() where id = ${m.id}`;
    // 알림: 담당(시험은 누른 사람만 — #104). 잠금 화면에 보이므로 이름은 가림
    const title = `${m.is_test ? '[시험] ' : ''}리드 광고 ${dup ? '다시 신청' : '새 신청'} · ${maskName(dup ? dup.name : display)}`;
    const body = `${LATE_MINUTES}분 안에 연락해 주세요 · ${where}`;
    await (await import('./spaceNotify')).notifySpace(sql, { tenant: m.tenant, space: 'sales', type: 'lead_ad', userIds: [owner.userId], title, body, link: `/s/sales/leads?id=${leadId}`,
      entityType: 'sales_lead', entityId: leadId, dedupeKey: `lead_ad:${m.id}`, actorId: null, test: m.is_test ? { actorId: m.created_by } : null });
    return { status: dup ? 'merged' : 'created', leadId };
  } catch (e) {
    await logError('meta-leads', e, { metaLeadId: m.id }).catch(() => {});
    return stop('failed', msgOf(e));
  }
}

// ---------------- 놓친 리드 불러오기 ----------------
/** 페이지의 리드 양식마다 최근 리드 → 처음 보는 것만 처리. sinceDays 가 없으면 지난 불러오기 30분 전부터(처음은 3일) */
export async function pollPage(accountId: string, sinceDays?: number) {
  const sql = db();
  const [p] = await sql<{ tenant: string; page_id: string; token_enc: string | null; polled_at: Date | null }[]>`select p.tenant, p.page_id, a.token_enc, p.polled_at
    from mkt_lead_pages p join mkt_publish_accounts a on a.id = p.account_id where p.account_id = ${accountId} and p.enabled and a.status <> 'disconnected'`;
  if (!p?.token_enc) return { forms: 0, seen: 0, created: 0 };
  const token = decrypt(p.token_enc);
  const since = Math.floor((sinceDays ? Date.now() - sinceDays * 864e5 : p.polled_at ? +p.polled_at - 30 * 60e3 : Date.now() - 3 * 864e5) / 1000);
  let forms = 0, seen = 0, created = 0; const fresh: [string, LeadData][] = [];
  try {
    const all: { id: string; name?: string }[] = [];
    let url: string | null = gurl(`${p.page_id}/leadgen_forms`, { fields: 'id,name,status', limit: '100', access_token: token });
    for (let i = 0; url && i < 5; i++) { const r = await gx(url); all.push(...(Array.isArray(r?.data) ? r.data : [])); url = nextUrl(r); }
    let fields = FIELDS;
    for (const f of all.slice(0, 200)) {
      if (!ID_RE.test(String(f.id))) continue;
      forms++;
      if (f.name) formNames.set(String(f.id), String(f.name).slice(0, 200));
      const first = () => gurl(`${f.id}/leads`, { fields, limit: '100', filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: since }]), access_token: token });
      let lurl: string | null = first();
      for (let i = 0; lurl && i < 10; i++) {
        let r: any;
        try { r = await gx(lurl); } catch (e) { if (e instanceof GraphError && e.code === 100 && fields === FIELDS && i === 0) { fields = FIELDS_MIN; r = await gx(first()); } else throw e; }
        for (const l of Array.isArray(r?.data) ? r.data : []) {
          if (!ID_RE.test(String(l?.id ?? ''))) continue;
          seen++;
          const [ins] = await sql<{ id: string }[]>`insert into mkt_meta_leads (tenant, account_id, page_id, leadgen_id, form_id, ad_id, created_time, via)
            values (${p.tenant}, ${accountId}, ${p.page_id}, ${String(l.id)}, ${String(f.id)}, ${ID_RE.test(String(l.ad_id ?? '')) ? String(l.ad_id) : null}, ${l.created_time && !Number.isNaN(Date.parse(l.created_time)) ? new Date(l.created_time) : null}, 'poll')
            on conflict (tenant, leadgen_id) do nothing returning id`;
          if (ins) fresh.push([ins.id, l]);
        }
        lurl = nextUrl(r);
      }
    }
    await sql`update mkt_lead_pages set polled_at = now(), last_error = null, updated_at = now() where account_id = ${accountId}`;
  } catch (e) {
    await sql`update mkt_lead_pages set polled_at = now(), last_error = ${`놓친 리드 불러오기 실패: ${msgOf(e)}`}, updated_at = now() where account_id = ${accountId}`;
    if (!fresh.length) throw e;
  }
  for (const [id, l] of fresh) { const r = await processMetaLead(id, l); if (r.status === 'created' || r.status === 'merged') created++; }
  return { forms, seen, created };
}

// ---------------- 첫 연락·5분 재알림 ----------------
type Open = { id: string; tenant: string; lead_id: string; owner_id: string | null; task_id: string | null; received_at: Date; created_time: Date | null; is_test: boolean; created_by: string | null;
  late_notified_at: Date | null; lead_name: string; owner_name: string | null };
/** 연락 근거(가장 이른 것): 사람이 남긴 상담 기록 · 사람이 바꾼 단계 · 첫 연락 업무 완료 */
async function evidence(sql: Sql, r: Open): Promise<{ at: Date; via: string } | null> {
  const [x] = await sql<{ at: Date | null; via: string | null }[]>`select at, via from (
      select min(created_at) as at, '상담 기록' as via from sales_lead_records where lead_id = ${r.lead_id} and kind = 'sales_activities' and created_at > ${r.received_at} and coalesce(data->>'source', '') <> 'meta_lead'
      union all select min(changed_at), '단계 변경' from sales_status_log where lead_id = ${r.lead_id} and changed_at > ${r.received_at} and changed_by is not null
      union all select completed_at, '업무 완료' from tasks where id = ${r.task_id} and status = 'done') x where at is not null order by at limit 1`;
  return x?.at ? { at: x.at, via: x.via ?? '' } : null;
}
/** 최근 7일 연락 전 신청: 근거가 있으면 첫 연락 시각을 채우고, 5분이 지났는데 없으면(한 번만) 담당·관리자에게 다시 알림. tenant 를 주면 그 회사만(보고서 열 때) */
export async function followUp(sql: Sql, opt: { tenant?: string; notify?: boolean } = {}) {
  const rows = await sql<Open[]>`select m.id, m.tenant, m.lead_id, m.owner_id, m.task_id, m.received_at, m.created_time, m.is_test, m.created_by, m.late_notified_at, l.name as lead_name, u.name as owner_name
    from mkt_meta_leads m join sales_leads l on l.id = m.lead_id left join users u on u.id = m.owner_id
    where m.status in ('created', 'merged') and m.contacted_at is null and m.received_at > now() - interval '7 days' and l.deleted_at is null ${opt.tenant ? sql`and m.tenant = ${opt.tenant}` : sql``}
    order by m.received_at limit 100`;
  let contacted = 0, notified = 0;
  for (const r of rows) {
    const ev = await evidence(sql, r);
    if (ev) { await sql`update mkt_meta_leads set contacted_at = ${ev.at}, contact_via = ${ev.via}, updated_at = now() where id = ${r.id} and contacted_at is null`; contacted++; continue; }
    if (opt.notify === false || r.late_notified_at || Date.now() - +r.received_at < LATE_MINUTES * 60e3) continue;
    const admins = (await sql<{ id: string }[]>`select id from users where tenant = ${r.tenant} and status = 'active' and not is_demo and role in ('owner', 'admin')`).map((x) => x.id);
    const to = r.is_test ? [r.created_by] : [...new Set([r.owner_id, ...admins])];
    const mins = Math.max(LATE_MINUTES, Math.round((Date.now() - +(r.created_time ?? r.received_at)) / 60e3));
    await (await import('./notifications')).notify(sql, { userIds: to, type: 'lead_ad', space: 'sales', title: `${r.is_test ? '[시험] ' : ''}리드 광고 신청 ${mins}분째 연락 전 · ${maskName(r.lead_name)}`,
      body: `담당 ${r.owner_name ?? '미지정'} — 지금 전화해 주세요(전화·상담 기록이 아직 없습니다)`, link: `/s/sales/leads?id=${r.lead_id}`, entityType: 'sales_lead', entityId: r.lead_id, dedupeKey: `lead_ad_late:${r.id}` });
    await sql`update mkt_meta_leads set late_notified_at = now(), updated_at = now() where id = ${r.id}`;
    notified++;
  }
  return { checked: rows.length, contacted, notified };
}
/** 리드 상세 [전화]·[문자] 누름 = 연락 시작(영업 공간 사람) */
export const touchInput = z.object({ via: z.enum(['tel', 'sms']) });
export async function touchLead(u: SessionUser, leadId: string, i: z.infer<typeof touchInput>) {
  await assertSpace(u, 'sales');
  if (!UUID.test(leadId)) throw notFound();
  const rows = await db()`update mkt_meta_leads set contacted_at = now(), contact_via = ${i.via === 'sms' ? '문자' : '전화'}, updated_at = now()
    where tenant = ${tenantOf(u)} and lead_id = ${leadId} and contacted_at is null and status in ('created', 'merged') returning id`;
  return { ok: true, marked: rows.length };
}

/** tick: ① 남은 처리(웹후크 응답 뒤 처리가 끊긴 것·실패 재시도) ② 놓친 리드 불러오기 ③ 첫 연락·5분 재알림 */
export async function metaLeadsTick() {
  const sql = db();
  const todo = await sql<{ id: string }[]>`select id from mkt_meta_leads where attempts < ${MAX_ATTEMPTS} and ((status = 'pending' and updated_at < now() - interval '2 minutes')
    or (status = 'failed' and updated_at < now() - interval '10 minutes') or (status = 'working' and updated_at < now() - interval '5 minutes')) order by received_at limit 20`;
  let processed = 0;
  for (const r of todo) { await processMetaLead(r.id).catch(() => {}); processed++; }
  const pages = await sql<{ account_id: string }[]>`select p.account_id from mkt_lead_pages p join mkt_publish_accounts a on a.id = p.account_id where p.enabled and a.status <> 'disconnected'
    and (p.polled_at is null or p.polled_at < now() - case when p.webhook_at > now() - interval '1 day' then interval '2 hours' else interval '30 minutes' end) order by p.polled_at nulls first limit 10`;
  let polled = 0, found = 0;
  for (const p of pages) { try { found += (await pollPage(p.account_id)).created; polled++; } catch { /* 페이지 last_error 에 남김 */ } }
  const follow = await followUp(sql);
  return { processed, polled, found, ...follow };
}

// ---------------- 연결(페이지에 앱 설치)·켜기/끄기 ----------------
/** 리드 광고 권한이 있는 페이지에 앱 설치(subscribed_apps leadgen) + 받기 켬. 설치가 안 돼도 '놓친 리드 불러오기'로는 받음 */
export async function enableLeadPage(sql: Sql, a: { id: string; tenant: string; external_id: string; token_enc: string | null }, by: string) {
  let err: string | null = null;
  try {
    if (!a.token_enc) throw new Error('페이지 토큰 없음 — 다시 연결');
    await gx(`${GRAPH()}/${a.external_id}/subscribed_apps`, { method: 'POST', form: { subscribed_fields: 'leadgen', access_token: decrypt(a.token_enc) } });
  } catch (e) { err = `페이지에 앱 설치(웹후크) 실패 — 놓친 리드 불러오기로만 받습니다: ${msgOf(e)}`; }
  await sql`insert into mkt_lead_pages (account_id, tenant, page_id, enabled, enabled_by, subscribed_at, last_error) values (${a.id}, ${a.tenant}, ${a.external_id}, true, ${by}, ${err ? null : new Date()}, ${err})
    on conflict (account_id) do update set enabled = true, enabled_by = excluded.enabled_by, page_id = excluded.page_id, subscribed_at = coalesce(excluded.subscribed_at, mkt_lead_pages.subscribed_at),
      last_error = excluded.last_error, updated_at = now()`;
  return err;
}
function marketingAdmin(u: SessionUser) { if (!isAdmin(u)) throw forbidden('리드 광고 설정은 관리자가 합니다'); }
async function pageAccount(u: SessionUser, accountId: string) {
  if (!UUID.test(accountId)) throw notFound();
  const [a] = await db()<{ id: string; tenant: string; external_id: string; token_enc: string | null; scopes: string[] | null; label: string }[]>`select id, tenant, external_id, token_enc, scopes, label from mkt_publish_accounts
    where id = ${accountId} and tenant = ${tenantOf(u)} and provider = 'meta_fb' and status <> 'disconnected'`;
  if (!a) throw notFound('페이스북 페이지 연결을 찾을 수 없습니다');
  return a;
}
export const leadPageInput = z.object({ enabled: z.boolean() });
export async function setLeadPage(u: SessionUser, accountId: string, i: z.infer<typeof leadPageInput>) {
  await assertSpace(u, 'marketing'); marketingAdmin(u);
  const sql = db(); const a = await pageAccount(u, accountId);
  let warning: string | null = null;
  if (i.enabled) {
    if (!hasLeadScopes(a.scopes)) throw new HttpError(409, 'lead_scopes', '리드 광고 권한이 없습니다 — 연결 계정에서 [리드 광고 받기]로 다시 연결해 주세요');
    warning = await enableLeadPage(sql, a, u.id);
  } else {
    // 같은 페이지를 받는 다른 회사가 없을 때만 앱 설치를 지움(웹후크 멈춤)
    const others = await sql`select 1 from mkt_lead_pages where page_id = ${a.external_id} and enabled and account_id <> ${a.id}`;
    if (!others.length && a.token_enc) await gx(gurl(`${a.external_id}/subscribed_apps`, { access_token: decrypt(a.token_enc) }), { method: 'DELETE' }).catch(() => {});
    await sql`update mkt_lead_pages set enabled = false, updated_at = now() where account_id = ${a.id}`;
  }
  await audit(sql, u.id, 'mkt_leads.page', 'mkt_publish_account', a.id, { enabled: i.enabled, warning }).catch(() => {});
  return { ok: true, warning };
}

// ---------------- 버튼: 지금 불러오기·시험 리드·다시 처리·양식 목록 ----------------
export const pullInput = z.object({ accountId: z.string().uuid().optional(), days: z.number().int().min(1).max(30).optional() });
export async function pullNow(u: SessionUser, i: z.infer<typeof pullInput>) {
  await assertSpace(u, 'marketing'); marketingAdmin(u);
  const sql = db();
  const pages = await sql<{ account_id: string; label: string }[]>`select p.account_id, a.label from mkt_lead_pages p join mkt_publish_accounts a on a.id = p.account_id
    where p.tenant = ${tenantOf(u)} and p.enabled and a.status <> 'disconnected' ${i.accountId ? sql`and p.account_id = ${i.accountId}` : sql``}`;
  if (!pages.length) throw new HttpError(409, 'no_lead_pages', '리드 광고를 받는 페이지가 없습니다 — 연결 계정에서 [리드 광고 받기]를 먼저 눌러 주세요');
  const out: { page: string; forms: number; seen: number; created: number; error?: string }[] = [];
  for (const p of pages) {
    try { out.push({ page: p.label, ...(await pollPage(p.account_id, i.days ?? 3)) }); }
    catch (e) { out.push({ page: p.label, forms: 0, seen: 0, created: 0, error: msgOf(e) }); }
  }
  return { results: out };
}
export async function leadForms(u: SessionUser, accountId: string) {
  await assertSpace(u, 'marketing'); marketingAdmin(u);
  const a = await pageAccount(u, accountId);
  if (!a.token_enc) throw new HttpError(409, 'no_token', '페이지 토큰이 없습니다 — 다시 연결해 주세요');
  const r = await gx(gurl(`${a.external_id}/leadgen_forms`, { fields: 'id,name,status', limit: '100', access_token: decrypt(a.token_enc) }));
  return { forms: (Array.isArray(r?.data) ? r.data : []).filter((f: any) => ID_RE.test(String(f?.id))).map((f: any) => ({ id: String(f.id), name: String(f.name ?? f.id).slice(0, 200), status: String(f.status ?? '') })) };
}
export const testLeadInput = z.object({ accountId: z.string().uuid(), formId: z.string().regex(ID_RE, '양식 번호가 올바르지 않습니다') });
/** [시험 리드 보내기]: Meta test_leads API(양식당 1개라 있던 시험 리드는 지우고 새로) → 바로 처리. 웹후크 정상 여부는 '웹후크 마지막 수신'으로 따로 확인 */
export async function sendTestLead(u: SessionUser, i: z.infer<typeof testLeadInput>) {
  await assertSpace(u, 'marketing'); marketingAdmin(u);
  const sql = db(); const a = await pageAccount(u, i.accountId);
  const [pg] = await sql`select 1 from mkt_lead_pages where account_id = ${a.id} and enabled`;
  if (!pg) throw new HttpError(409, 'lead_page_off', '이 페이지는 리드 광고 받기가 꺼져 있습니다 — 먼저 켜 주세요');
  if (!a.token_enc) throw new HttpError(409, 'no_token', '페이지 토큰이 없습니다 — 다시 연결해 주세요');
  const token = decrypt(a.token_enc);
  const old = await gx(gurl(`${i.formId}/test_leads`, { access_token: token })).catch(() => null);
  for (const l of (Array.isArray(old?.data) ? old.data : []).slice(0, 5)) if (ID_RE.test(String(l?.id))) await gx(gurl(String(l.id), { access_token: token }), { method: 'DELETE' }).catch(() => {});
  const made = await gx(`${GRAPH()}/${i.formId}/test_leads`, { method: 'POST', form: { access_token: token } });
  let leadgen = String(made?.id ?? '');
  if (!ID_RE.test(leadgen)) leadgen = String((await gx(gurl(`${i.formId}/test_leads`, { access_token: token })))?.data?.[0]?.id ?? '');
  if (!ID_RE.test(leadgen)) throw new HttpError(502, 'meta_test_lead', 'Meta 가 시험 리드 번호를 돌려주지 않았습니다');
  const [r] = await sql<{ id: string }[]>`insert into mkt_meta_leads (tenant, account_id, page_id, leadgen_id, form_id, via, is_test, created_by) values (${a.tenant}, ${a.id}, ${a.external_id}, ${leadgen}, ${i.formId}, 'test', true, ${u.id})
    on conflict (tenant, leadgen_id) do update set is_test = true, created_by = excluded.created_by, updated_at = now() returning id`;
  const res = await processMetaLead(r.id);
  await audit(sql, u.id, 'mkt_leads.test', 'mkt_publish_account', a.id, { formId: i.formId, status: res.status }).catch(() => {});
  return { id: r.id, ...res };
}
export async function retryLead(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing'); marketingAdmin(u);
  if (!UUID.test(id)) throw notFound();
  const [r] = await db()<{ id: string }[]>`update mkt_meta_leads set status = 'pending', attempts = 0, error = null, updated_at = now() where id = ${id} and tenant = ${tenantOf(u)} and status in ('failed', 'skipped') returning id`;
  if (!r) throw new HttpError(409, 'not_failed', '실패·건너뜀 상태인 것만 다시 처리합니다');
  return processMetaLead(r.id);
}

// ---------------- 광고 운영 '리드 광고' 상자 ----------------
export async function leadAdsReport(u: SessionUser, q: { days?: number }) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const days = [7, 30, 90].includes(Number(q.days)) ? Number(q.days) : 30;
  const from = ymd(new Date(Date.now() - (days - 1) * 864e5)); const fromTs = `${from}T00:00:00+09:00`;
  await followUp(sql, { tenant: t, notify: false }).catch(() => {}); // 방금 남긴 상담 기록·단계 변경도 바로 반영
  const pages = await sql<any[]>`select a.id as account_id, a.label, a.scopes, p.enabled, p.subscribed_at, p.webhook_at, p.polled_at, p.last_error
    from mkt_publish_accounts a left join mkt_lead_pages p on p.account_id = a.id where a.tenant = ${t} and a.provider = 'meta_fb' and a.status <> 'disconnected' order by a.created_at`;
  const rows = await sql<any[]>`select m.id, m.status, m.via, m.is_test, m.form_name, m.ad_id, m.ad_name, m.campaign_name, m.created_time, m.received_at, m.contacted_at, m.contact_via, m.late_notified_at, m.error,
      m.lead_id, l.name as lead_name, u.name as owner_name from mkt_meta_leads m left join sales_leads l on l.id = m.lead_id left join users u on u.id = m.owner_id
    where m.tenant = ${t} and m.received_at >= ${fromTs}::timestamptz order by m.received_at desc limit 500`;
  const real = rows.filter((r) => !r.is_test && (r.status === 'created' || r.status === 'merged'));
  const mins = (r: any) => (r.contacted_at ? Math.max(0, Math.round((+new Date(r.contacted_at) - +new Date(r.created_time ?? r.received_at)) / 60e3)) : null);
  const done = real.map(mins).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const adIds = [...new Set(real.map((r) => r.ad_id).filter(Boolean))] as string[];
  const cost = adIds.length ? await sql<{ item_id: string; cost: number; name: string | null }[]>`select s.item_id, sum(s.cost_krw)::float8 as cost, max(s.item_name) as name from mkt_ad_items s join mkt_ad_accounts a on a.id = s.account_id
    where a.tenant = ${t} and a.provider = 'meta' and s.kind = 'ad' and s.day >= ${from}::date and s.item_id = any(${adIds}) group by s.item_id` : [];
  const costOf = new Map(cost.map((c) => [c.item_id, c]));
  const byAd = new Map<string, { key: string; ad: string; campaign: string; leads: number; fast: number; cost: number | null }>();
  for (const r of real) {
    const key = r.ad_id ?? '-';
    const g = byAd.get(key) ?? { key, ad: r.ad_name ?? costOf.get(key)?.name ?? (r.ad_id ? `광고 ${r.ad_id}` : '광고 없음(자연 유입)'), campaign: r.campaign_name ?? '', leads: 0, fast: 0, cost: r.ad_id && costOf.has(key) ? Math.round(costOf.get(key)!.cost) : null };
    g.leads++; const mm = mins(r); if (mm !== null && mm <= LATE_MINUTES) g.fast++;
    byAd.set(key, g);
  }
  const sales = (await userSpaces(u)).includes('sales');
  return {
    days, from, canEdit: isAdmin(u), canSales: sales,
    setup: { app: !!(process.env.META_APP_ID && process.env.META_APP_SECRET), webhook: !!process.env.META_WEBHOOK_VERIFY_TOKEN, devMode: process.env.META_APP_LIVE_MODE !== '1' }, // 개발 모드 = 실제 광고 리드 웹후크가 안 옴(mktChannels metaDevMode 와 같은 기준)
    pages: pages.map((p) => ({ accountId: p.account_id, label: p.label, scopes: hasLeadScopes(p.scopes), enabled: !!p.enabled, subscribed: !!p.subscribed_at, webhookAt: p.webhook_at, polledAt: p.polled_at, error: p.last_error })),
    summary: { leads: real.length, created: real.filter((r) => r.status === 'created').length, merged: real.filter((r) => r.status === 'merged').length,
      problems: rows.filter((r) => r.status === 'failed' || r.status === 'skipped').length, fast: done.filter((x) => x <= LATE_MINUTES).length,
      waiting: real.filter((r) => !r.contacted_at).length, medianMin: done.length ? done[Math.floor((done.length - 1) / 2)] : null },
    byAd: [...byAd.values()].map((g) => ({ ...g, cpl: g.cost !== null && g.leads ? Math.round(g.cost / g.leads) : null })).sort((a, b) => b.leads - a.leads).slice(0, 30),
    recent: rows.slice(0, 30).map((r) => ({ id: r.id, at: r.created_time ?? r.received_at, status: r.status, via: r.via, test: r.is_test, name: r.lead_name ? maskName(r.lead_name) : null,
      form: r.form_name, ad: r.ad_name, owner: r.owner_name, contactMin: mins(r), contactVia: r.contact_via, late: !!r.late_notified_at && !r.contacted_at, error: r.error, leadId: sales ? r.lead_id : null })),
  };
}
