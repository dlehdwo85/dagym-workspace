import { db } from '../db';
import { HttpError, notFound } from '../errors';
import { audit } from '../log';
import type { SessionUser } from '../types';
import { createHash } from 'node:crypto';
import { srcAll, srcConfigured, srcCount, srcGet } from './supabaseSrc';

/**
 * V41 단계 2 영업관리(Supabase) → 워크인 이전 — 1) 미리보기: 원본은 읽기만, 저장 없음.
 * PostgREST 설명서(/rest/v1/)에서 표·뷰 목록과 칸 이름을 읽고, 표마다 정확한 건수(count=exact)를 셈.
 * V39 E 검수 숫자(거래처 21·상담 4·업무 8/하위 1·시점 2·진행기록 30·신규단지 22·협력사 164·공고 4,356·시설 4,346·관련 654)와 로컬이 대조한 뒤 적용 단계를 만든다.
 * 옮기지 않는 표(V39 E·D): 분류 정리 백업 2개, 관측 테이블, 구 실행 이력 — 목록에 '옮기지 않음'으로 표시.
 */
/** 원본 표 27개(V39, 로컬 확인) — 설명서(OpenAPI)를 못 읽으면 이 목록으로 표마다 건수만 */
const KNOWN = ['profiles', 'business_categories', 'leads', 'lead_business_interests', 'sales_activities', 'proposals', 'contracts', 'regions', 'schedules', 'tasks', 'task_subtasks',
  'lead_opportunity_timing', 'procurement_monitoring_runs', 'procurement_notices', 'procurement_notice_observations', 'building_sales_pipeline', 'data_source_master', 'data_source_run',
  'data_source_observation', 'kapt_vendor_selection', 'user_saved_filters', 'operating_facility_prospects', 'sales_costs', 'opportunity_work', 'vendor_registrations', 'ai_usage', 'ai_proposals'];
const SKIP = [/^procurement_reclass_backup_/, /observ/i, /^collector_runs_old/];
const EXPECT: Record<string, number> = { leads: 21, lead_business_interests: 30, sales_activities: 4, tasks: 8, task_subtasks: 1, lead_opportunity_timing: 2, opportunity_work: 30,
  building_sales_pipeline: 22, vendor_registrations: 164, procurement_notices: 4356, operating_facility_prospects: 4346 };

export async function salesMigratePreview(u: SessionUser) {
  if (!u.platformAdmin || u.support) throw notFound();
  if (!srcConfigured()) throw new HttpError(409, 'sales_src_not_configured', 'SALES_SRC_URL·SALES_SRC_SERVICE_KEY(Secret key) 설정이 필요합니다');
  let defs: Record<string, any> = {}; let specError: string | null = null;
  try { const spec: any = await srcGet('/rest/v1/'); defs = spec?.definitions ?? spec?.components?.schemas ?? {}; }
  catch (e: any) { specError = String(e?.message ?? e).slice(0, 300); } // 설명서가 막혀도 알려진 표 목록으로 계속
  const names = [...new Set([...Object.keys(defs).filter((n) => !n.startsWith('rpc')), ...(Object.keys(defs).length ? [] : KNOWN)])].sort();
  const tables = [];
  for (const name of names) {
    const skip = SKIP.some((re) => re.test(name));
    let count: number | null = null; let error: string | null = null;
    try { count = await srcCount(name); } catch (e: any) { error = String(e?.message ?? e).slice(0, 160); }
    tables.push({ name, count, expected: EXPECT[name] ?? null, columns: Object.keys(defs[name]?.properties ?? {}), skip, error });
  }
  // 관련 공고(검수 기준 654): related = true 인 공고
  let related: number | null = null;
  if (names.includes('procurement_notices') && (!Object.keys(defs).length || (defs.procurement_notices?.properties ?? {}).related)) related = await srcCount('procurement_notices', 'related=is.true').catch(() => null);
  const sql = db();
  await audit(sql, u.id, 'sales_migrate.preview', 'tenant', null, { tables: tables.length }).catch(() => {});
  await sql`insert into app_settings (key, value) values ('sales_migrate_preview', ${sql.json({ at: new Date().toISOString(), tables: tables.map((t) => ({ name: t.name, count: t.count })), related } as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
  if (tables.every((t) => t.error)) throw new HttpError(502, 'sales_src_unreachable', `원본을 읽지 못했습니다 — ${specError ?? tables[0]?.error ?? '알 수 없음'}`);
  return { at: new Date().toISOString(), base: (await import('./supabaseSrc')).srcBase().replace(/^(https?:\/\/[^.]{4})[^.]*/, '$1…'), specError, tables, related, relatedExpected: 654 };
}

// ---------------- 2) 적용 ----------------
/** V39 C: 공용 표(수집 데이터) — 회사별 진행 칸은 떼어 회사 쪽 '<표>__progress' 로 */
export const GLOBAL: Record<string, string[]> = {
  procurement_notices: ['classification', 'representative_judgment', 'qualification_gap', 'sales_point', 'lead_id'],
  operating_facility_prospects: ['contact_status', 'contact_updated_at', 'next_action', 'next_action_date', 'lead_id', 'notes'],
  vendor_registrations: ['status', 'memo', 'next_date'],
  building_sales_pipeline: [], data_source_master: [], data_source_run: [], kapt_vendor_selection: [],
};
/** 회사별 표(진행 기록) */
export const TENANT = ['leads', 'lead_business_interests', 'sales_activities', 'proposals', 'contracts', 'schedules', 'tasks', 'task_subtasks', 'lead_opportunity_timing', 'opportunity_work',
  'sales_costs', 'regions', 'business_categories', 'user_saved_filters'];
/** 옮기지 않음(V39 D·E): 관측·실행 이력·백업·AI 사용 기록 */
export const NOT_MOVED = ['procurement_notice_observations', 'data_source_observation', 'procurement_monitoring_runs', 'ai_usage', 'ai_proposals'];
const idOf = (r: any) => (r?.id != null ? String(r.id) : createHash('sha256').update(JSON.stringify(r)).digest('hex').slice(0, 32));

async function upsertRows(scope: string, tbl: string, rows: any[]) {
  const sql = db(); const now = new Date();
  for (let n = 0; n < rows.length; n += 500) {
    const chunk = rows.slice(n, n + 500).map((r) => ({ scope, tbl, src_id: idOf(r), row: sql.json(r), gone: false, synced_at: now }));
    await sql`insert into sales_src_rows ${sql(chunk as never)} on conflict (scope, tbl, src_id) do update set row = excluded.row, gone = false, synced_at = excluded.synced_at`;
  }
  // 이번에 안 보인 행 = 원본에서 사라짐(지우지 않고 표시)
  // 10/21 수집기 이식: 워크인이 직접 모은 행(origin='workin')은 원본에 없어도 '사라짐'으로 표시하지 않음
  await sql`update sales_src_rows set gone = true where scope = ${scope} and tbl = ${tbl} and synced_at < ${now} and origin <> 'workin'`;
}

/** 원본 → 워크인(멱등). 끝나면 표별 '원본 건수 = 워크인 건수' 대조 */
export async function salesMigrateApply(u: SessionUser | null, tenant: string) {
  if (u && (!u.platformAdmin || u.support)) throw notFound();
  if (!srcConfigured()) throw new HttpError(409, 'sales_src_not_configured', 'SALES_SRC_URL·SALES_SRC_SERVICE_KEY(Secret key) 설정이 필요합니다');
  const sql = db();
  const [t] = await sql`select id from tenants where id = ${tenant}`;
  if (!t) throw new HttpError(400, 'bad_request', '그런 회사가 없습니다');
  const started = Date.now();
  const results: { tbl: string; scope: 'global' | 'tenant'; src: number | null; dst: number; ok: boolean; error?: string; progress?: number }[] = [];
  const doTable = async (tbl: string, scope: 'global' | 'tenant') => {
    try {
      const rows = await srcAll(tbl);
      if (scope === 'global') {
        const own = GLOBAL[tbl];
        await upsertRows('global', tbl, rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !own.includes(k)))));
        const prog = own.length ? rows.map((r) => ({ id: r.id, ...Object.fromEntries(own.filter((k) => r[k] !== null && r[k] !== undefined).map((k) => [k, r[k]])) })).filter((p) => Object.keys(p).length > 1) : [];
        if (own.length) await upsertRows(tenant, `${tbl}__progress`, prog);
        results.push({ tbl, scope, src: rows.length, dst: 0, ok: false, progress: prog.length });
      } else {
        await upsertRows(tenant, tbl, rows);
        results.push({ tbl, scope, src: rows.length, dst: 0, ok: false });
      }
    } catch (e: any) { results.push({ tbl, scope, src: null, dst: 0, ok: false, error: String(e?.message ?? e).slice(0, 200) }); }
  };
  for (const tbl of Object.keys(GLOBAL)) await doTable(tbl, 'global');
  // #507 후속: 원본 수집기가 넣은 공고가 워크인 수집 줄과 같은 공고면(복사가 숨긴 줄을 되살려도) 바로 한 줄로 — 진행 기록·업무가 걸린 줄을 살림
  const merged = await (await import('./collectors/store')).mergeNoticeDuplicates().catch(() => null);
  // 전환(쓰기 열림) 뒤에는 회사별 표를 다시 가져오지 않음 — 워크인이 정본. 공용 수집 표는 계속(원본 수집기가 계속 돎)
  const open = !!(await sql<{ o: boolean }[]>`select writes_open as o from sales_cutover where tenant = ${tenant}`)[0]?.o;
  if (!open) for (const tbl of TENANT) await doTable(tbl, 'tenant');
  // 사용자 연결: profiles → 워크인(이메일 일치, 없으면 대표)
  let users = { total: 0, matched: 0 };
  try {
    const profiles = await srcAll('profiles');
    const [owner] = await sql<{ id: string }[]>`select id from users where tenant = ${tenant} and role = 'owner' and status = 'active' order by created_at limit 1`;
    for (const p of profiles) {
      const email = String(p.email ?? '').trim().toLowerCase() || null;
      const [m] = email ? await sql<{ id: string }[]>`select id from users where tenant = ${tenant} and lower(email) = ${email} and status = 'active' limit 1` : [];
      await sql`insert into sales_user_map (tenant, src_user_id, user_id, email, name, matched) values (${tenant}, ${String(p.id)}, ${m?.id ?? owner?.id ?? null}, ${email}, ${p.full_name ?? p.name ?? null}, ${!!m})
        on conflict (tenant, src_user_id) do update set user_id = case when sales_user_map.manual then sales_user_map.user_id else excluded.user_id end, email = excluded.email, name = excluded.name,
          matched = sales_user_map.manual or excluded.matched`; // 직접 연결한 사람은 다시 가져와도 그대로
      users.total++; if (m || (await sql`select 1 from sales_user_map where tenant = ${tenant} and src_user_id = ${String(p.id)} and manual`).length) users.matched++;
    }
  } catch (e: any) { results.push({ tbl: 'profiles', scope: 'tenant', src: null, dst: 0, ok: false, error: String(e?.message ?? e).slice(0, 200) }); }
  // 대조: 워크인 쪽 건수(사라짐 제외)
  for (const r of results) {
    if (r.src === null) continue;
    const [c] = await sql<{ n: number }[]>`select count(*)::int as n from sales_src_rows where scope = ${r.scope === 'global' ? 'global' : tenant} and tbl = ${r.tbl} and not gone`;
    r.dst = c.n; r.ok = r.dst === r.src;
    await sql`insert into sales_src_sync (tenant, tbl, src_count, dst_count, error) values (${tenant}, ${r.tbl}, ${r.src}, ${r.dst}, null)
      on conflict (tenant, tbl) do update set src_count = excluded.src_count, dst_count = excluded.dst_count, error = null, synced_at = now()`;
  }
  for (const r of results.filter((x) => x.error)) await sql`insert into sales_src_sync (tenant, tbl, error) values (${tenant}, ${r.tbl}, ${r.error!}) on conflict (tenant, tbl) do update set error = excluded.error, synced_at = now()`;
  const [rel] = await sql<{ n: number }[]>`select count(*)::int as n from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone and (row->>'related')::boolean is true`;
  const out = { tenant, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), results, users, related: rel?.n ?? 0, notMoved: NOT_MOVED, merged };
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant, at: out.at, daily: true } as never)})
    on conflict (key) do update set value = jsonb_set(excluded.value, '{daily}', coalesce(app_settings.value->'daily', 'true'::jsonb)), updated_at = now()`;
  if (u) await audit(sql, u.id, 'sales_migrate.apply', 'tenant', null, { tenant, tables: results.length, ok: results.filter((r) => r.ok).length }).catch(() => {});
  return out;
}

/** 전환일까지 매일 차이분 다시 가져오기(멱등) — 플랫폼 화면에서 끌 수 있음 */
export async function salesSyncDaily() {
  const sql = db();
  const [s] = await sql<{ value: any; updated_at: Date }[]>`select value, updated_at from app_settings where key = 'sales_migrate_applied'`;
  if (!s?.value?.daily || !srcConfigured()) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  if (new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(s.updated_at)) === today) return null; // 오늘 이미 함
  const r = await salesMigrateApply(null, s.value.tenant);
  return { tables: r.results.length, ok: r.results.filter((x) => x.ok).length };
}
export async function salesSyncToggle(u: SessionUser, daily: boolean) {
  if (!u.platformAdmin || u.support) throw notFound();
  await db()`update app_settings set value = jsonb_set(value, '{daily}', to_jsonb(${daily}::boolean)), updated_at = updated_at where key = 'sales_migrate_applied'`;
  return { daily };
}
export async function salesMigrateStatus(u: SessionUser) {
  if (!u.platformAdmin || u.support) throw notFound();
  const sql = db();
  const [s] = await sql<{ value: any }[]>`select value from app_settings where key = 'sales_migrate_applied'`;
  return { applied: s?.value ?? null, sync: await sql`select tenant, tbl, src_count, dst_count, error, synced_at from sales_src_sync order by tenant, tbl`,
    users: await sql`select m.tenant, m.src_user_id, m.email, m.name, m.matched, m.manual, m.user_id, u.name as user_name from sales_user_map m left join users u on u.id = m.user_id order by m.matched desc, m.name`,
    people: await sql`select id, name, tenant from users where status = 'active' and not is_demo order by name` };
}

/** 원본 사용자 → 워크인 사용자 직접 연결(그 회사 사용자만). null = 직접 연결 풀기(다음 적용 때 이메일 짝·없으면 대표) */
export async function salesMapUser(u: SessionUser, tenant: string, srcUserId: string, userId: string | null) {
  if (!u.platformAdmin || u.support) throw notFound();
  const sql = db();
  if (userId && !(await sql`select 1 from users where id = ${userId} and tenant = ${tenant} and status = 'active'`).length) throw new HttpError(400, 'bad_request', '그 회사의 활성 사용자가 아닙니다');
  const [r] = await sql`update sales_user_map set user_id = coalesce(${userId}, user_id), manual = ${!!userId}, matched = ${!!userId} or matched where tenant = ${tenant} and src_user_id = ${srcUserId} returning src_user_id`;
  if (!r) throw notFound('원본 사용자를 찾을 수 없습니다 — 먼저 [적용]');
  // 정식 표(전환 준비)에 이미 옮긴 리드 담당도 바로 바꿈
  if (userId) await sql`update sales_leads set owner_id = ${userId}, updated_at = now() where tenant = ${tenant} and coalesce(src->>'owner_id', src->>'assigned_to', src->>'sales_owner_id', src->>'user_id') = ${srcUserId}`;
  await audit(sql, u.id, 'sales_migrate.map_user', 'tenant', null, { tenant, srcUserId, userId }).catch(() => {});
  return { ok: true };
}
