import { db } from '../db';
import { HttpError, notFound } from '../errors';
import { audit } from '../log';
import type { SessionUser } from '../types';
import { srcConfigured, srcCount, srcGet } from './supabaseSrc';

/**
 * V41 단계 2 영업관리(Supabase) → 워크인 이전 — 1) 미리보기: 원본은 읽기만, 저장 없음.
 * PostgREST 설명서(/rest/v1/)에서 표·뷰 목록과 칸 이름을 읽고, 표마다 정확한 건수(count=exact)를 셈.
 * V39 E 검수 숫자(거래처 21·상담 4·업무 8/하위 1·시점 2·진행기록 30·신규단지 22·협력사 164·공고 4,356·시설 4,346·관련 654)와 로컬이 대조한 뒤 적용 단계를 만든다.
 * 옮기지 않는 표(V39 E·D): 분류 정리 백업 2개, 관측 테이블, 구 실행 이력 — 목록에 '옮기지 않음'으로 표시.
 */
const SKIP = [/^procurement_reclass_backup_/, /observ/i, /^collector_runs_old/];
const EXPECT: Record<string, number> = { leads: 21, lead_business_interests: 30, sales_activities: 4, tasks: 8, task_subtasks: 1, lead_timepoints: 2, opportunity_work: 30,
  building_sales_pipeline: 22, vendor_registrations: 164, procurement_notices: 4356, operating_facility_prospects: 4346 };

export async function salesMigratePreview(u: SessionUser) {
  if (!u.platformAdmin || u.support) throw notFound();
  if (!srcConfigured()) throw new HttpError(409, 'sales_src_not_configured', 'SALES_SRC_URL·SALES_SRC_SERVICE_KEY(Secret key) 설정이 필요합니다');
  const spec: any = await srcGet('/rest/v1/');
  const defs: Record<string, any> = spec?.definitions ?? spec?.components?.schemas ?? {};
  const names = Object.keys(defs).filter((n) => !n.startsWith('rpc')).sort();
  const tables = [];
  for (const name of names) {
    const skip = SKIP.some((re) => re.test(name));
    let count: number | null = null; let error: string | null = null;
    try { count = await srcCount(name); } catch (e: any) { error = String(e?.message ?? e).slice(0, 160); }
    tables.push({ name, count, expected: EXPECT[name] ?? null, columns: Object.keys(defs[name]?.properties ?? {}), skip, error });
  }
  // 관련 공고(검수 기준 654): related = true 인 공고
  let related: number | null = null;
  if (names.includes('procurement_notices') && (defs.procurement_notices?.properties ?? {}).related) related = await srcCount('procurement_notices', 'related=is.true').catch(() => null);
  const sql = db();
  await audit(sql, u.id, 'sales_migrate.preview', 'tenant', null, { tables: tables.length }).catch(() => {});
  await sql`insert into app_settings (key, value) values ('sales_migrate_preview', ${sql.json({ at: new Date().toISOString(), tables: tables.map((t) => ({ name: t.name, count: t.count })), related } as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
  return { at: new Date().toISOString(), tables, related, relatedExpected: 654 };
}
