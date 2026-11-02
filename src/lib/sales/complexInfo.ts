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

// 342차(로컬 11/02 341차 운영 확인 ⓑ: '이촌동 현대아파트 리모델링주택조합' 발주 공고가 '지역 미정'): 글자에 시·도·시·군·구가 없는 단지 발주 공고는
// 단지 이름(+동 이름)으로 K-apt 단지 목록(kapt_complex_codes: name·sido·dong)에서 소재 시도를 찾는다. 같은 이름 단지가 여러 시도에 있으면(현대아파트) 그대로 못 찾음.
const DONG_STOP = new Set(['공동', '운동', '활동', '이동', '자동', '행동', '협동', '합동', '노동', '작동', '변동', '유동', '진동', '부동', '연동', '가동', '출동', '감동', '제동', '구동', '기동', '시동']);
export type AptHints = { apts: string[]; dongs: string[] };
/** 발주처·수요기관·단지 칸에서 '○○아파트' 이름 조각과 '○○동' 조각 — 제목에서는 아파트 이름만(동 이름은 보통 낱말과 섞여 발주처 쪽만) */
export function aptHints(o: { org?: (string | null | undefined)[]; complex?: string | null; titles?: (string | null | undefined)[] }): AptHints {
  const apts = new Set<string>(), dongs = new Set<string>();
  const grab = (s: string, withDong: boolean) => {
    for (const m of s.matchAll(/([가-힣A-Za-z0-9·]{2,20}?)(?:아파트|APT)(?![가-힣])/gi)) { const n = norm(m[1]); if (n.length >= 2) apts.add(n); }
    if (withDong) for (const m of s.matchAll(/(?<![가-힣])([가-힣]{2,5}동)(?![가-힣])/g)) if (!DONG_STOP.has(m[1])) dongs.add(m[1]);
  };
  for (const t of o.org ?? []) if (t) grab(String(t), true);
  if (o.complex) { const n = norm(String(o.complex)); if (n.length >= 2) apts.add(n); grab(String(o.complex), true); }
  for (const t of o.titles ?? []) if (t) grab(String(t), false);
  return { apts: [...apts], dongs: [...dongs] };
}
/** 공고별 단지 이름 조각으로 소재 시도(짧은 이름) — 동 이름이 있으면 그 동의 단지 가운데 이름이 맞는 것, 없으면 이름이 똑같은 단지. 후보 시도가 하나일 때만 */
export async function complexSidos(sql: Sql, items: ({ id: string } & AptHints)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const todo = items.filter((x) => x.apts.length); if (!todo.length) return out;
  const apts = [...new Set(todo.flatMap((x) => x.apts))], dongs = [...new Set(todo.flatMap((x) => x.dongs))];
  const { CODES } = await import('./collectors/kaptComplexes');
  const rows = await sql<{ name: string; sido: string | null; dong: string | null }[]>`select regexp_replace(regexp_replace(regexp_replace(coalesce(row->>'name', ''), '\\s+', '', 'g'), '\\(.*?\\)', '', 'g'), '(아파트|APT)$', '', 'i') as name, row->>'sido' as sido, row->>'dong' as dong
    from sales_src_rows where scope = 'global' and tbl = ${CODES}
    and (regexp_replace(regexp_replace(regexp_replace(coalesce(row->>'name', ''), '\\s+', '', 'g'), '\\(.*?\\)', '', 'g'), '(아파트|APT)$', '', 'i') = any(${apts}::text[]) ${dongs.length ? sql`or row->>'dong' = any(${dongs}::text[])` : sql``}) limit 3000`.catch(() => []);
  if (!rows.length) return out;
  const { sidoIn } = await import('./region');
  for (const x of todo) {
    const byDong = x.dongs.length ? rows.filter((r) => r.dong && x.dongs.includes(r.dong) && r.name.length >= 2 && x.apts.some((a) => r.name === a || r.name.includes(a) || a.includes(r.name))) : [];
    const cands = byDong.length ? byDong : rows.filter((r) => x.apts.includes(r.name));
    const sidos = new Set(cands.map((r) => sidoIn(r.sido) ?? '').filter(Boolean));
    if (sidos.size === 1) out.set(x.id, [...sidos][0]);
  }
  return out;
}

