import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { HttpError, forbidden } from './errors';
import { decrypt, encrypt } from './crypto';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';
import { metaGraph } from './metaGraph';
import { STAGES } from './sales/srcViews';

/**
 * #499-3 리드 단계 → Meta 전환 API(CAPI for CRM). 메타 공식 문서 'Conversions API for CRM integration' 기준(확인 10/23):
 * POST {graph}/{데이터 세트 id}/events · data[] = { event_name(단계 — 자유 이름), event_time(초 — 보내는 때로부터 7일 안·리드 생성 뒤),
 *   action_source 'system_generated', user_data.lead_id(15~17자리 숫자 — JSON 숫자 그대로, 자바스크립트 숫자로 바꾸지 않음),
 *   custom_data { event_source 'crm', lead_event_source(CRM 이름) } }.
 * - 처음 리드 단계도 보냄(리드 광고 1건 = 첫 단계 1건) · 단계가 바뀔 때마다 1건(영업 단계 기록 sales_status_log — 쓰는 곳이 여러 군데라 기록에서 읽음)
 *   · 같은 이벤트 이름은 메타 리드마다 한 번 · 앞 단계를 건너뛰면 건너뛴 앞 단계도 같은 시각으로(메타: 마지막 단계 전에 앞 단계가 먼저 와야 함)
 * - 보내는 것 = 메타 리드 ID·단계 이름·시각뿐(이름·전화·이메일은 안 보냄). 기본 꺼짐 — 켜기는 관리자, 개인정보 처리방침 문구는 대표 결정
 * - 한 요청 최대 1,000건이지만 하나라도 틀리면 묶음 전체가 버려짐 → 50건씩, 묶음이 실패하면 한 건씩 · 3번 실패하면 멈춤 · 7일 지난 것은 보내지 않음
 */
export const CAPI_DEFAULT_MAP: Record<string, string> = {
  신규리드: 'Lead', '1차연락완료': 'Contacted', 미팅예정: 'QualifiedLead', 현장방문완료: 'QualifiedLead', 제안서작성중: 'QualifiedLead', 제안서발송완료: 'QualifiedLead',
  견적협의: 'QualifiedLead', 계약검토: 'QualifiedLead', 계약완료: 'ConvertedLead', 보류: '', 실패: 'DisqualifiedLead', 되돌림: '',
};
const FORWARD = STAGES.slice(0, STAGES.indexOf('계약완료') + 1); // 앞으로 나아가는 단계(보류·실패·되돌림은 앞 단계를 채우지 않음)
const LEAD_RE = /^\d{15,17}$/;
const BATCH = 50;
const MAX_TRIES = 3;
const WINDOW_DAYS = 7;   // 메타가 받는 event_time
const LOOKBACK_DAYS = 35; // 최적화 기준 28일 + 여유 — 이보다 오래된 리드 광고 신청은 단계가 바뀌어도 보내지 않음
const TIME_BUDGET_MS = 35_000; // 한 번에 보내는 시간(점검·[지금 보내기] 60초 안) — 남은 것은 다음에

type Cfg = { on?: boolean; datasetId?: string; source?: string; map?: Record<string, string>; since?: string };
const eventName = z.string().trim().max(40).regex(/^[A-Za-z0-9가-힣 _\-]*$/, '이벤트 이름은 글자·숫자·공백·_·- 만');
export const capiInput = z.object({
  on: z.boolean(),
  datasetId: z.string().trim().regex(/^(\d{5,20})?$/, '데이터 세트(픽셀) ID 는 숫자입니다'),
  token: z.string().trim().min(20).max(1000).optional(), // 비우면 저장된 토큰 그대로
  source: z.string().trim().min(1).max(40).default('Workin'),
  map: z.record(z.string(), eventName).optional(),
});
export const capiTestInput = z.object({ testEventCode: z.string().trim().regex(/^[A-Za-z0-9]{3,40}$/, '시험 이벤트 코드(이벤트 관리자 › 이벤트 테스트)를 넣어 주세요') });
const mapOf = (c: Cfg) => Object.fromEntries(STAGES.map((s) => [s, c.map?.[s] ?? CAPI_DEFAULT_MAP[s] ?? ''])) as Record<string, string>;

async function cfgOf(tenant: string) {
  const [s] = await db()<{ capi: Cfg | null; capi_token_enc: string | null }[]>`select capi, capi_token_enc from mkt_settings where tenant = ${tenant}`;
  return { cfg: (s?.capi ?? {}) as Cfg, tokenEnc: s?.capi_token_enc ?? null };
}
function adminOnly(u: SessionUser) { if (!isAdmin(u)) throw forbidden('전환 API 설정은 관리자가 합니다'); }

/** 화면: 설정(토큰은 '저장됨'만) · 지난 7일 보낸 수·대기·실패 · 최근 이벤트 */
export async function capiView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const sql = db();
  const { cfg, tokenEnc } = await cfgOf(t);
  const [st] = await sql<{ sent7: number; pending: number; failed: number; skipped7: number; last_sent: string | null }[]>`select
      count(*) filter (where status = 'sent' and sent_at > now() - interval '7 days')::int sent7, count(*) filter (where status = 'pending')::int pending,
      count(*) filter (where status = 'failed')::int failed, count(*) filter (where status = 'skipped' and created_at > now() - interval '7 days')::int skipped7, max(sent_at) last_sent
    from mkt_capi_events where tenant = ${t}`;
  const recent = await sql<any[]>`select e.id, e.event_name, e.stage, e.event_time, e.status, e.attempts, e.error, e.sent_at, right(e.leadgen_id, 4) as lead_tail
    from mkt_capi_events e where e.tenant = ${t} order by e.created_at desc, e.event_time desc limit 20`;
  const [lastErr] = await sql<{ error: string; at: string }[]>`select error, created_at as at from mkt_capi_events where tenant = ${t} and status in ('pending', 'failed') and error is not null order by created_at desc limit 1`;
  return { canEdit: isAdmin(u), on: !!cfg.on, datasetId: cfg.datasetId ?? '', source: cfg.source ?? 'Workin', map: mapOf(cfg), defaults: CAPI_DEFAULT_MAP, stages: STAGES, hasToken: !!tokenEnc, since: cfg.since ?? null,
    stats: { sent7: st?.sent7 ?? 0, pending: st?.pending ?? 0, failed: st?.failed ?? 0, skipped7: st?.skipped7 ?? 0, lastSent: st?.last_sent ?? null, lastError: lastErr?.error ?? null }, recent };
}

/** 설정 저장 — 켜려면 데이터 세트 ID·토큰이 있어야 함. 처음 켠 시각(since) 기준 7일 전 신청부터 보냄(메타 백필 한도) — 껐다 켜도 처음 켠 시각 그대로(그 사이 신청의 뒤 단계도 보냄) */
export async function setCapi(u: SessionUser, i: z.infer<typeof capiInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const { cfg, tokenEnc } = await cfgOf(t);
  if (i.on && (!i.datasetId || !(i.token || tokenEnc))) throw new HttpError(409, 'capi_incomplete', '켜려면 데이터 세트(픽셀) ID 와 전환 API 토큰을 넣어 주세요');
  const map = Object.fromEntries(STAGES.map((s) => [s, i.map?.[s] ?? cfg.map?.[s] ?? CAPI_DEFAULT_MAP[s] ?? '']));
  const next: Cfg = { on: i.on, datasetId: i.datasetId, source: i.source, map, since: cfg.since ?? (i.on ? new Date().toISOString() : undefined) };
  const enc = i.token ? encrypt(i.token) : tokenEnc;
  await sql`insert into mkt_settings (tenant, capi, capi_token_enc) values (${t}, ${sql.json(next as never)}, ${enc})
    on conflict (tenant) do update set capi = excluded.capi, capi_token_enc = excluded.capi_token_enc`;
  await audit(sql, u.id, 'mkt.capi', 'tenant', null, { on: i.on, datasetId: i.datasetId, source: i.source, map, token: i.token ? '바꿈' : tokenEnc ? '그대로' : '없음' }).catch(() => {});
  return capiView(u);
}

type Step = { stage: string; at: Date };
/**
 * 보낼 이벤트 만들기: 최근 리드 광고 신청마다 [첫 단계(받은 시각)] + [그 뒤 단계 변경 기록] → 이벤트 이름(이름표) — 건너뛴 앞 단계 채움, 같은 이름은 한 번.
 * 7일보다 오래된 단계는 만들지 않음(그 뒤 단계가 앞 단계를 채우면 그 시각으로). 시험 리드는 보내지 않음
 */
export async function queueCapi(tenant: string, cfg: Cfg) {
  const sql = db(); const map = mapOf(cfg);
  const since = cfg.since ? new Date(cfg.since) : new Date();
  const from = new Date(Math.max(Date.now() - LOOKBACK_DAYS * 864e5, +since - WINDOW_DAYS * 864e5));
  const metas = await sql<{ id: string; leadgen_id: string; lead_id: string; received_at: Date; created_time: Date | null }[]>`select id, leadgen_id, lead_id, received_at, created_time
    from mkt_meta_leads where tenant = ${tenant} and lead_id is not null and not is_test and status in ('created', 'merged') and received_at >= ${from}`;
  if (!metas.length) return 0;
  const recentFrom = new Date(Date.now() - WINDOW_DAYS * 864e5);
  const logs = await sql<{ lead_id: string; to_status: string; changed_at: Date }[]>`select lead_id, to_status, changed_at from sales_status_log
    where tenant = ${tenant} and lead_id = any(${[...new Set(metas.map((m) => m.lead_id))]}::uuid[]) and from_status is not null and changed_at >= ${recentFrom} order by changed_at, id`;
  const have = await sql<{ meta_lead_id: string; event_name: string }[]>`select meta_lead_id, event_name from mkt_capi_events where meta_lead_id = any(${metas.map((m) => m.id)}::uuid[])`;
  const done = new Map<string, Set<string>>();
  for (const h of have) (done.get(h.meta_lead_id) ?? done.set(h.meta_lead_id, new Set()).get(h.meta_lead_id)!).add(h.event_name);
  const rows: { tenant: string; meta_lead_id: string; leadgen_id: string; lead_id: string; event_name: string; stage: string; event_time: Date }[] = [];
  for (const m of metas) {
    const seen = done.get(m.id) ?? new Set<string>();
    const born = Math.max(+m.received_at, m.created_time ? +m.created_time + 1000 : 0); // 메타: 리드 생성 시각 뒤여야 함
    const steps: Step[] = [...(m.received_at >= recentFrom ? [{ stage: STAGES[0], at: new Date(born) }] : []),
      ...logs.filter((l) => l.lead_id === m.lead_id && +l.changed_at > born).map((l) => ({ stage: l.to_status, at: l.changed_at }))];
    for (const s of steps) {
      const k = FORWARD.indexOf(s.stage);
      const chain = k >= 0 ? FORWARD.slice(0, k + 1) : [s.stage]; // 앞 단계 채움(보류·실패·되돌림·모르는 단계는 그 단계만)
      for (const stage of chain) {
        const name = map[stage];
        if (!name || seen.has(name)) continue;
        seen.add(name);
        rows.push({ tenant, meta_lead_id: m.id, leadgen_id: m.leadgen_id, lead_id: m.lead_id, event_name: name, stage, event_time: s.at });
      }
    }
  }
  if (!rows.length) return 0;
  const r = await sql`insert into mkt_capi_events ${sql(rows as never, 'tenant', 'meta_lead_id', 'leadgen_id', 'lead_id', 'event_name', 'stage', 'event_time')} on conflict (meta_lead_id, event_name) do nothing`;
  return r.count;
}

class CapiError extends Error { constructor(message: string, readonly code: number | null) { super(message); } }
type Ev = { id: string; leadgen_id: string; event_name: string; event_time: Date; attempts: number };
/** 이벤트 1건 JSON — lead_id 는 숫자 그대로 넣음(16자리 넘는 숫자는 자바스크립트 숫자로 바꾸면 끝자리가 바뀜) */
const evJson = (e: Ev, source: string) => JSON.stringify({ event_name: e.event_name, event_time: Math.floor(+new Date(e.event_time) / 1000), action_source: 'system_generated',
  user_data: { lead_id: '__LEAD_ID__' }, custom_data: { event_source: 'crm', lead_event_source: source } }).replace('"__LEAD_ID__"', LEAD_RE.test(e.leadgen_id) ? e.leadgen_id : '0');
async function post(datasetId: string, token: string, source: string, evs: Ev[], testCode?: string) {
  const body = `{"data":[${evs.map((e) => evJson(e, source)).join(',')}]${testCode ? `,"test_event_code":${JSON.stringify(testCode)}` : ''}}`;
  let r: Response;
  try { r = await fetch(`${metaGraph()}/${datasetId}/events?access_token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw new CapiError(`메타 전환 API 연결 실패: ${String((e as Error)?.message ?? e).slice(0, 200)}`, null); } // 주소(토큰 포함)는 오류 문구에 넣지 않음
  const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch { /* JSON 아님 */ }
  if (!r.ok || j?.error) {
    const er = j?.error ?? {};
    throw new CapiError(`메타 전환 API 오류 ${r.status}${er.code ? ` [code ${er.code}${er.error_subcode ? `/${er.error_subcode}` : ''}]` : ''} ${String(er.error_user_msg ?? er.message ?? text).slice(0, 400)}`.trim(), Number(er.code) || null);
  }
  return { received: Number(j?.events_received ?? 0), fbtrace: j?.fbtrace_id ? String(j.fbtrace_id) : null };
}

/**
 * 대기 중 이벤트 보내기: 7일 지난 것·리드 ID 형식 아닌 것은 건너뜀 → 50건씩 → 묶음이 실패하면 한 건씩(틀린 건만 실패로) — 처음부터 3건 연속 같은 오류면 토큰·데이터 세트 문제로 보고 이번엔 멈춤
 * · 한 번에 35초까지(남은 것은 다음 점검에서)
 */
async function sendCapi(tenant: string, cfg: Cfg, token: string) {
  const sql = db(); const until = Date.now() + TIME_BUDGET_MS;
  await sql`update mkt_capi_events set status = 'skipped', error = '7일 지남 — 메타는 7일 안의 단계만 받습니다' where tenant = ${tenant} and status = 'pending' and event_time < now() - interval '7 days' + interval '10 minutes'`;
  await sql`update mkt_capi_events set status = 'skipped', error = '메타 리드 ID 형식이 아님(15~17자리 숫자)' where tenant = ${tenant} and status = 'pending' and leadgen_id !~ '^[0-9]{15,17}$'`;
  const due = await sql<Ev[]>`select id, leadgen_id, event_name, event_time, attempts from mkt_capi_events where tenant = ${tenant} and status = 'pending'
    order by event_time, created_at, array_position(${STAGES}::text[], stage) limit 500`; // 같은 시각(건너뛴 앞 단계)은 단계 순서대로
  const source = cfg.source || 'Workin';
  const ok = async (evs: Ev[], fbtrace: string | null) => { await sql`update mkt_capi_events set status = 'sent', sent_at = now(), error = null, fbtrace_id = ${fbtrace}, attempts = attempts + 1 where id = any(${evs.map((e) => e.id)}::uuid[])`; };
  const bad = async (evs: Ev[], e: unknown) => { const msg = String((e as Error)?.message ?? e).slice(0, 1000);
    await sql`update mkt_capi_events set attempts = attempts + 1, error = ${msg}, status = case when attempts + 1 >= ${MAX_TRIES} then 'failed' else 'pending' end where id = any(${evs.map((x) => x.id)}::uuid[])`; };
  let sent = 0, failed = 0, stop = false;
  for (let i = 0; i < due.length && !stop && Date.now() < until; i += BATCH) {
    const chunk = due.slice(i, i + BATCH);
    try { const r = await post(cfg.datasetId!, token, source, chunk); await ok(chunk, r.fbtrace); sent += chunk.length; continue; }
    catch (e) { if (chunk.length === 1) { await bad(chunk, e); failed++; continue; } }
    let streak = 0, code: number | null | undefined, anyOk = false;
    for (const one of chunk) {
      if (Date.now() >= until) { stop = true; break; }
      try { const r = await post(cfg.datasetId!, token, source, [one]); await ok([one], r.fbtrace); sent++; anyOk = true; }
      catch (e1) {
        await bad([one], e1); failed++;
        const c = e1 instanceof CapiError ? e1.code : null;
        streak = code === undefined || c === code ? streak + 1 : 1; code = c;
        if (!anyOk && streak >= 3) { stop = true; break; } // 나머지는 다음에(시도 수를 늘리지 않음)
      }
    }
  }
  return { sent, failed };
}

/** 만들기 → 보내기. 회사마다 한 번에 하나만(점검과 [지금 보내기]가 겹쳐 같은 이벤트를 두 번 보내지 않게 — 2분 지나면 잠금 풀림). 잠겨 있으면 null */
async function runCapi(tenant: string, cfg: Cfg, token: string) {
  const sql = db(); const name = `capi:${tenant}`; const holder = randomUUID();
  const got = await sql`insert into job_locks (name, locked_until, holder) values (${name}, now() + interval '2 minutes', ${holder})
    on conflict (name) do update set locked_until = excluded.locked_until, holder = excluded.holder where job_locks.locked_until < now() returning holder`;
  if (!got.length) return null;
  try { const queued = await queueCapi(tenant, cfg); return { queued, ...(await sendCapi(tenant, cfg, token)) }; }
  finally { await sql`delete from job_locks where name = ${name} and holder = ${holder}`; }
}

/** tick: 켠 회사마다 만들기 → 보내기(메타: 하루 한 번 이상) */
export async function capiTick() {
  const sql = db();
  const rows = await sql<{ tenant: string; capi: Cfg; capi_token_enc: string | null }[]>`select tenant, capi, capi_token_enc from mkt_settings where (capi->>'on')::boolean is true and capi_token_enc is not null`;
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if (!r.capi.datasetId) continue;
    try { out[r.tenant] = (await runCapi(r.tenant, r.capi, decrypt(r.capi_token_enc!))) ?? { busy: true }; }
    catch (e) { out[r.tenant] = { error: String((e as Error)?.message ?? e).slice(0, 300) }; }
  }
  return out;
}

/** [지금 보내기](관리자): 이 회사만 바로 만들고 보냄 */
export async function capiSendNow(u: SessionUser) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u);
  const { cfg, tokenEnc } = await cfgOf(t);
  if (!cfg.on || !cfg.datasetId || !tokenEnc) throw new HttpError(409, 'capi_off', '전환 API 가 꺼져 있습니다 — 데이터 세트 ID·토큰을 넣고 켜 주세요');
  const r = await runCapi(t, cfg, decrypt(tokenEnc));
  if (!r) throw new HttpError(409, 'capi_busy', '지금 보내는 중입니다 — 잠시 뒤 다시 눌러 주세요');
  return r;
}

/**
 * [시험 보내기](관리자): 가장 최근 리드 광고 신청의 리드 ID 로 첫 단계 이벤트 1건을 시험 코드와 함께 보냄 — 이벤트 관리자 '이벤트 테스트' 탭에서 확인.
 * 시험 이벤트는 최적화에 쓰이지 않음. 켜기 전에도 됨(데이터 세트 ID·토큰만 있으면)
 */
export async function capiTest(u: SessionUser, i: z.infer<typeof capiTestInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const { cfg, tokenEnc } = await cfgOf(t);
  if (!cfg.datasetId || !tokenEnc) throw new HttpError(409, 'capi_incomplete', '먼저 데이터 세트(픽셀) ID 와 전환 API 토큰을 저장해 주세요');
  const [m] = await sql<{ leadgen_id: string; received_at: Date; created_time: Date | null }[]>`select leadgen_id, received_at, created_time from mkt_meta_leads
    where tenant = ${t} and leadgen_id ~ '^[0-9]{15,17}$' order by received_at desc limit 1`;
  if (!m) throw new HttpError(409, 'capi_no_lead', '아직 리드 광고로 들어온 신청이 없습니다 — 위 [시험 리드 보내기]로 시험 신청을 먼저 받아 주세요(메타는 실제 리드 ID 만 받습니다)');
  const name = mapOf(cfg)[STAGES[0]] || 'Lead';
  const at = new Date(Math.max(Date.now() - 60e3, m.created_time ? +m.created_time + 1000 : 0));
  try {
    const r = await post(cfg.datasetId, decrypt(tokenEnc), cfg.source || 'Workin', [{ id: 'test', leadgen_id: m.leadgen_id, event_name: name, event_time: at, attempts: 0 }], i.testEventCode);
    await audit(sql, u.id, 'mkt.capi_test', 'tenant', null, { received: r.received, fbtrace: r.fbtrace }).catch(() => {});
    return { ok: true, received: r.received, fbtrace: r.fbtrace, eventName: name, leadTail: m.leadgen_id.slice(-4) };
  } catch (e) { throw new HttpError(502, 'capi_upstream', String((e as Error)?.message ?? e)); }
}
