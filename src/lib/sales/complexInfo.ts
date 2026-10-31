// 281차 #822(대표 10/31 "업무 넘어올 때 현설 및 세대수 준공년월 내용 같이 올 수 있도록"): 단지 이름으로 세대수·준공(사용승인)년월 찾기.
// · K-apt 단지 목록(kapt_complex_codes — 신규 단지 수집기가 전국 단지 이름·코드를 모아 둠)에서 이름이 같은 단지(여럿이면 지역이 맞는 것 하나)
// · 그 단지 줄에 사용승인일이 이미 있으면 그대로, 없으면 K-apt 기본정보(15058453)를 한 번 읽어 그 줄에 남김(다음부터는 다시 안 부름)
// · 그래도 없으면 준공·입주 시설 줄(같은 단지 코드)의 준공일. 못 찾으면 빈 값 — 업무 넘기기는 그대로 진행
import type { Sql } from '../db';

export type ComplexFacts = { code: string | null; households: number | null; usedate: string | null };
const norm = (s: string) => s.replace(/\s+/g, '').replace(/\(.*?\)/g, '').replace(/(아파트|APT)$/i, '');
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
const ymd = (v: unknown) => { const t = String(v ?? '').replace(/\D/g, ''); return t.length >= 8 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : t.length === 6 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-01` : null; };
/** '2019년 3월' */
export const yearMonth = (d: string | null) => (d ? `${d.slice(0, 4)}년 ${Number(d.slice(5, 7))}월` : null);

export async function complexFacts(sql: Sql, name: string | null | undefined, region?: string | null, o: { timeoutMs?: number } = {}): Promise<ComplexFacts> {
  const none: ComplexFacts = { code: null, households: null, usedate: null };
  const n = name ? norm(name) : ''; if (n.length < 2) return none;
  const { CODES, BASIS_API } = await import('./collectors/kaptComplexes');
  const rows = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = ${CODES}
    and regexp_replace(regexp_replace(regexp_replace(coalesce(row->>'name', ''), '\\s+', '', 'g'), '\\(.*?\\)', '', 'g'), '(아파트|APT)$', '', 'i') = ${n} limit 20`.catch(() => []);
  const sido = (region ?? '').replace(/\s+/g, '').slice(0, 2);
  const hit = rows.length === 1 ? rows[0] : rows.filter((r) => sido && String(r.row?.sido ?? '').startsWith(sido)).length === 1 ? rows.find((r) => sido && String(r.row?.sido ?? '').startsWith(sido)) : null;
  if (!hit) return none;
  const code = hit.src_id; let households = num(hit.row?.households); let usedate: string | null = hit.row?.usedate ?? null;
  if (!usedate) {
    try {
      const { kaptKey } = await import('./collectors/kapt'); const key = await kaptKey();
      if (key) {
        const { callDataGo } = await import('./collectors/g2b');
        const u = new URL(`${BASIS_API()}/getAphusBassInfoV5`); u.searchParams.set('serviceKey', key); u.searchParams.set('kaptCode', code);
        const b = ((await callDataGo(u, fetch, key, o.timeoutMs ?? 5000))[0] ?? null) as Record<string, unknown> | null;
        if (b) {
          usedate = ymd(b.kaptUsedate); households = households ?? num(b.kaptdaCnt);
          await sql`update sales_src_rows set row = row || ${sql.json({ usedate, households } as never)}::jsonb, synced_at = now() where scope = 'global' and tbl = ${CODES} and src_id = ${code}`;
        }
      }
    } catch { /* 키 없음·활용신청 전·시간 초과 — 아래 준공·입주 시설 줄로 */ }
  }
  if (!usedate || !households) {
    const [p] = await sql<{ row: any }[]>`select row from sales_src_rows where scope = 'global' and tbl = 'operating_facility_prospects' and not gone and row->>'facility_code' = ${code} limit 1`.catch(() => []);
    usedate = usedate ?? ymd(p?.row?.completion_date); households = households ?? num(p?.row?.household_count);
  }
  return { code, households, usedate };
}
