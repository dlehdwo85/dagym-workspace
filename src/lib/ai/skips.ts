// 371차 #994: AI 를 쓰는 수집·판단 단계가 한도·크레딧·속도 제한으로 '못 함' — 항목·사유·날짜를 남기고, 나중에 처리되면 '다시 채움'
import { db, type Sql } from '../db';

export type SkipStage = 'support' | 'eligibility_vision' | 'eligibility_ai' | 'mkt_audit' | 'mkt_produce';
export const STAGE_LABEL: Record<SkipStage, string> = {
  support: '지원사업 AI 판단', eligibility_vision: '사진 공고문 참가자격 읽기', eligibility_ai: '참가자격 AI 항목 정리',
  mkt_audit: '마케팅 사진·글 대조', mkt_produce: '마케팅 자동 원고',
};
const reasonOf = (e: unknown) => { const x = e as { code?: string; status?: number } | null; return String(x?.code || (x?.status ? `http_${x.status}` : 'ai_stop')).slice(0, 40); };

/** 못 함 기록(같은 항목이면 마지막 시각·횟수만 올림, 다시 막히면 다시 '남음') — 실패해도 본 작업은 그대로 */
export async function noteSkips(sql: Sql = db(), tenant: string, stage: SkipStage, items: { key: string; title?: string | null }[], err: unknown) {
  if (!items.length) return;
  const reason = reasonOf(err); const message = String((err as Error)?.message ?? err ?? '').slice(0, 200) || null;
  const rows = items.slice(0, 500).map((x) => ({ tenant, stage, item_key: String(x.key).slice(0, 200), title: x.title ? String(x.title).slice(0, 200) : null, reason, message }));
  await sql`insert into ai_skips ${sql(rows, 'tenant', 'stage', 'item_key', 'title', 'reason', 'message')}
    on conflict (tenant, stage, item_key) do update set last_at = now(), skips = ai_skips.skips + 1, reason = excluded.reason, message = excluded.message,
      title = coalesce(excluded.title, ai_skips.title), done_at = null`.catch(() => {});
}
export const noteSkip = (sql: Sql, tenant: string, stage: SkipStage, key: string, title: string | null | undefined, err: unknown) => noteSkips(sql, tenant, stage, [{ key, title }], err);

/** 다시 처리됨 — 못 함으로 남아 있던 항목만 */
export async function noteDone(sql: Sql = db(), tenant: string, stage: SkipStage, keys: string[]) {
  if (!keys.length) return;
  await sql`update ai_skips set done_at = now() where tenant = ${tenant} and stage = ${stage} and item_key = any(${keys.map(String)}::text[]) and done_at is null`.catch(() => {});
}

/** 남은(아직 못 함) 항목이 처음 막힌 순서 — 다시 할 때 오래된 것부터 */
export async function openSkipOrder(sql: Sql, tenant: string, stage: SkipStage) {
  const rows = await sql<{ item_key: string; first_at: Date }[]>`select item_key, first_at from ai_skips where tenant = ${tenant} and stage = ${stage} and done_at is null order by first_at limit 2000`.catch(() => []);
  return new Map(rows.map((r, i) => [r.item_key, i]));
}

/** 운영 상태: 최근 14일 막힌 날(서울 날짜)·단계별 못 함·다시 채움 */
export async function skipSummary(sql: Sql, tenants: string[]) {
  const rows = await sql<{ day: string; stage: string; reason: string; total: number; done: number; last_at: Date }[]>`
    select to_char(first_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as day, stage, max(reason) as reason, count(*)::int as total,
      count(*) filter (where done_at is not null)::int as done, max(last_at) as last_at
    from ai_skips where tenant = any(${tenants}::text[]) and first_at > now() - interval '14 days' group by 1, 2 order by 1 desc, 2`;
  return rows.map((r) => ({ ...r, label: STAGE_LABEL[r.stage as SkipStage] ?? r.stage, left: r.total - r.done }));
}
