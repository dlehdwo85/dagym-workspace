/**
 * 상용화 B4(대표 위임 11/24, docs/research/TENANT_DELETE_EXPORT_2026-11-24.md): 회사 영구 삭제 = 실제 파기.
 * 개인정보처리방침 "공간 삭제는 복구 기간 30일 후 파기"와 맞춤 — 예전 [영구 삭제 실행]은 사람 익명화·메모만 지우고 회사 자료·파일이 남았다.
 *
 * 순서(정기 실행이 이어서 처리 — 한 번에 다 못 하면 다음 실행이 계속): queued → rows → files → done
 *  1) queued: 회사 경로 밖에 있는 파일 열쇠(업무·일정 첨부 att/…)와 회사 자료 표의 storage_key 를 tenant_purge_files 에 모아 둠
 *  2) rows: tenant 칸이 있는 표(남길 표 빼고)를 지움 — 외래 키를 따라가 딸린 표(업무·일정·대화·댓글 등 tenant 칸이 없는 표)를 먼저 지움.
 *     그 회사 사람(users)에 딸린 줄(알림·세션·활동 기록 등)도 지움. 사람 계정 줄 자체는 익명화한 채 남김(결제·감사 기록이 가리킴)
 *  3) files: 모아 둔 열쇠 + 회사 경로(lib/·chat/·chk/·render/·contract/·ai-doc/·agr/·회사 id/)의 파일을 묶음으로 지움
 *  4) done: 지운 줄·파일 수를 남기고 플랫폼 운영자 알림 + 감사 기록
 * 남기는 표: 결제·환불·정기결제 동의·세금계산서(전자상거래법 5년) · 감사 기록 · 구독 · 운영자 상담 기록 · 지원(대신 보기) 기록 · 회사·사람 줄(익명화)
 */
import { db, type Sql } from './db';

const KEEP = new Set(['tenants', 'users', 'payments', 'payment_settlements', 'payment_notifications', 'billing_consents', 'tax_invoice_requests', 'settlement_uploads',
  'audit_logs', 'tenant_subscriptions', 'tenant_contact_logs', 'support_sessions', 'tenant_purge_files', 'schema_migrations',
  'location_logs' /* D-18: 위치정보 이용·제공 확인자료(좌표 없음) — 법정 6개월 이상 보관, 1년 뒤 정기 실행이 지움 */]);
/** 회사와 무관한 공용 표 — 사람 연결로 지우지 않음 */
const GLOBAL = new Set(['app_settings', 'mkt_plan_limits', 'plans', 'plan_addons', 'menu_role_perms', 'data_sources', 'brands', 'prospects', 'sales_src_rows', 'sales_collector_runs',
  'sales_collector_state', 'bid_alert_subscribers', 'bid_alert_sends', 'job_locks', 'job_runs', 'perf_probes', 'perf_screens', 'perf_weekly', 'landing_views', 'signup_attempts', 'error_logs', 'oauth_pending']);
/** 회사 id 로 시작하는 파일 경로 */
const PREFIXES = ['lib', 'chat', 'chk', 'render', 'contract', 'ai-doc', 'agr'];
const SAFE_TENANT = /^[a-z0-9][a-z0-9_-]{3,40}$/;

type Fk = { child: string; parent: string; del: string; ccols: string[]; pcols: string[] };
type State = { state: 'queued' | 'rows' | 'files' | 'done'; at?: string; rows?: Record<string, number>; files?: number; errors?: string[]; doneAt?: string };
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

let catalog: { fks: Fk[]; tenantTables: string[]; userFks: Fk[] } | null = null;
async function loadCatalog(sql: Sql) {
  if (catalog) return catalog;
  const fks = await sql<Fk[]>`
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent, c.confdeltype::text as del,
      array(select a.attname::text from unnest(c.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o) as ccols,
      array(select a.attname::text from unnest(c.confkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.o) as pcols
    from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace`;
  const tenantTables = (await sql<{ t: string }[]>`
    select c.table_name::text as t from information_schema.columns c join information_schema.tables b on b.table_name = c.table_name and b.table_schema = c.table_schema
    where c.table_schema = 'public' and c.column_name = 'tenant' and b.table_type = 'BASE TABLE' order by 1`).map((r) => r.t);
  const ts = new Set(tenantTables);
  const userFks = fks.filter((f) => f.parent === 'users' && f.ccols.length === 1 && !ts.has(f.child) && !KEEP.has(f.child) && !GLOBAL.has(f.child));
  catalog = { fks, tenantTables, userFks };
  return catalog;
}

async function purgeTable(sql: Sql, tenant: string, c: NonNullable<typeof catalog>, table: string, pred: string, path: string[], st: { rows: Record<string, number>; errors: string[] }) {
  if (KEEP.has(table) || path.length > 8) return;
  // 지우면 막히는(no action·restrict) 딸린 표를 먼저 — 같은 표(하위 업무 등)는 한 번에 지워지므로 건너뜀
  for (const e of c.fks) {
    if (e.parent !== table || (e.del !== 'a' && e.del !== 'r') || e.child === table || path.includes(e.child) || KEEP.has(e.child)) continue;
    const cp = `(${e.ccols.map(q).join(', ')}) in (select ${e.pcols.map(q).join(', ')} from ${q(table)} where ${pred})`;
    await purgeTable(sql, tenant, c, e.child, cp, [...path, table], st);
  }
  try {
    const r = await sql.unsafe(`delete from ${q(table)} where ${pred}`, [tenant]);
    if (r.count) st.rows[table] = (st.rows[table] ?? 0) + r.count;
  } catch (err) {
    const m = `${table}: ${String((err as Error)?.message ?? err).slice(0, 160)}`;
    if (!st.errors.includes(m)) st.errors.push(m);
  }
}

/** 회사 자료 줄 지우기 — 두 번 돌려 순서 때문에 막힌 것도 지움. 남은 오류만 돌려줌 */
export async function purgeRows(tenant: string, sql: Sql = db()) {
  const c = await loadCatalog(sql);
  const st = { rows: {} as Record<string, number>, errors: [] as string[] };
  for (let pass = 0; pass < 2; pass++) {
    st.errors = [];
    for (const t of c.tenantTables) await purgeTable(sql, tenant, c, t, `${q(t)}.tenant = $1`, [], st);
    for (const f of c.userFks) await purgeTable(sql, tenant, c, f.child, `${q(f.child)}.${q(f.ccols[0])} in (select id from users where tenant = $1)`, [], st);
  }
  return st;
}

/** 회사 경로 밖 파일 열쇠 모으기(지우기 전에) */
async function collectKeys(sql: Sql, tenant: string) {
  await sql`insert into tenant_purge_files (tenant, key)
    select ${tenant}, a.storage_key from attachments a
    where a.storage_key is not null and (a.created_by in (select id from users where tenant = ${tenant})
      or a.task_id in (select t.id from tasks t join org_units o on o.id = t.org_unit_id where o.tenant = ${tenant})
      or a.event_id in (select e.id from events e join calendars c on c.id = e.calendar_id where c.tenant = ${tenant}))
    on conflict do nothing`;
  await sql`insert into tenant_purge_files (tenant, key)
    select ${tenant}, v.storage_key from attachment_versions v join attachments a on a.id = v.attachment_id
    where v.storage_key is not null and (a.created_by in (select id from users where tenant = ${tenant})
      or a.task_id in (select t.id from tasks t join org_units o on o.id = t.org_unit_id where o.tenant = ${tenant})
      or a.event_id in (select e.id from events e join calendars c on c.id = e.calendar_id where c.tenant = ${tenant}))
    on conflict do nothing`;
  // 회사 표의 저장소 열쇠 칸(storage_key·preview_key) — 회사 경로 밖에 둔 것까지
  const cols = await sql<{ t: string; col: string }[]>`
    select c.table_name::text as t, c.column_name::text as col from information_schema.columns c
    where c.table_schema = 'public' and c.column_name in ('storage_key', 'preview_key')
      and exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = c.table_name and x.column_name = 'tenant')`;
  for (const { t, col } of cols) {
    await sql.unsafe(`insert into tenant_purge_files (tenant, key) select $1, ${q(col)} from ${q(t)} where tenant = $1 and ${q(col)} is not null on conflict do nothing`, [tenant]).catch(() => null);
  }
}

const prefixesOf = (tenant: string) => [...PREFIXES.map((p) => `${p}/${tenant}/`), ...(SAFE_TENANT.test(tenant) && !PREFIXES.includes(tenant) ? [`${tenant}/`] : [])];

/** 파일 지우기 한 묶음 — 남은 게 없으면 true */
async function purgeFilesStep(sql: Sql, tenant: string, st: State, deadline: number) {
  const S = await import('./storage');
  while (Date.now() < deadline) {
    const batch = await sql<{ key: string }[]>`select key from tenant_purge_files where tenant = ${tenant} limit 500`;
    if (!batch.length) break;
    st.files = (st.files ?? 0) + (await S.deleteKeys(batch.map((b) => b.key)));
    await sql`delete from tenant_purge_files where tenant = ${tenant} and key = any(${batch.map((b) => b.key)})`;
  }
  for (const p of prefixesOf(tenant)) {
    while (Date.now() < deadline) {
      const ks = await S.listKeys(p, 1000);
      if (!ks.length) { await S.removeLocalDir(p); break; }
      st.files = (st.files ?? 0) + (await S.deleteKeys(ks));
    }
  }
  if (Date.now() >= deadline) return false;
  return !(await sql`select 1 from tenant_purge_files where tenant = ${tenant} limit 1`).length;
}

/** 한 회사 파기를 budgetMs 안에서 이어서 진행 — 끝나면 'done' */
export async function runTenantPurge(tenant: string, budgetMs = 25_000, sql: Sql = db()): Promise<State | null> {
  if (['default', 'demo'].includes(tenant)) return null;
  const [t] = await sql<{ status: string; purge: State | null; name: string }[]>`select status, purge, name from tenants where id = ${tenant}`;
  if (!t || t.status !== 'deleted' || !t.purge || t.purge.state === 'done') return t?.purge ?? null;
  const deadline = Date.now() + budgetMs;
  const st: State = { ...t.purge };
  const save = () => sql`update tenants set purge = ${sql.json(st as never)} where id = ${tenant}`;
  if (st.state === 'queued') { await collectKeys(sql, tenant); st.state = 'rows'; await save(); }
  if (st.state === 'rows' && Date.now() < deadline) {
    const r = await purgeRows(tenant, sql);
    st.rows = Object.fromEntries(Object.entries({ ...(st.rows ?? {}) }).concat(Object.entries(r.rows)).reduce((m, [k, v]) => m.set(k, (m.get(k) ?? 0) + v), new Map<string, number>()));
    st.errors = r.errors.slice(0, 20); st.state = 'files'; await save();
  }
  if (st.state === 'files' && Date.now() < deadline) {
    try {
      if (await purgeFilesStep(sql, tenant, st, deadline)) {
        st.state = 'done'; st.doneAt = new Date().toISOString(); await save();
        const rows = Object.values(st.rows ?? {}).reduce((a, b) => a + b, 0);
        await (await import('./log')).audit(sql, null, 'platform.tenant_purged', 'tenant', tenant, { tenant, rows, files: st.files ?? 0, errors: st.errors?.length ?? 0 }).catch(() => {});
        const ids = await (await import('./superAdmin')).platformAdminIds(sql).catch(() => [] as string[]);
        if (ids.length) await (await import('./notifications')).notify(sql, { userIds: ids, type: 'usage_alert', title: `회사 자료 파기 완료 — ${t.name}`,
          body: `자료 ${rows.toLocaleString('ko-KR')}줄 · 파일 ${(st.files ?? 0).toLocaleString('ko-KR')}개를 지웠습니다${st.errors?.length ? ` · 지우지 못한 표 ${st.errors.length}곳(감사 기록 참고)` : ''}. 결제·세금계산서 기록은 법정 기간 보관합니다.`,
          link: '/platform?tab=company', dedupeKey: `tenant-purged:${tenant}` }).catch(() => {});
      } else await save();
    } catch (e) { st.errors = [...(st.errors ?? []), `files: ${String((e as Error)?.message ?? e).slice(0, 160)}`].slice(-20); await save(); }
  }
  return st;
}

/** 정기 실행: 파기 중인 회사를 이어서 */
export async function tenantPurgeTick(sql: Sql = db()) {
  const ts = await sql<{ id: string }[]>`select id from tenants where status = 'deleted' and purge is not null and purge->>'state' in ('queued', 'rows', 'files') order by deleted_at limit 3`;
  const out: Record<string, string> = {};
  for (const t of ts) out[t.id] = (await runTenantPurge(t.id, 40_000, sql))?.state ?? 'skip';
  return { purging: ts.length, out };
}
