// 414차 영업 일반화(대표 11/13 "회사별로, 사용자가 설정할 수 있도록, 다짐 세팅은 절대 건드리지 않는다" · 노트북 11/14 안 표 C·E·F 가안)
// 공용 공고 줄(sales_src_rows scope='global')에는 수집할 때 기본 회사 규칙(collectors/procurement.ts matchFit)으로 정한
// '관련·적합 사업·맞은 낱말·분류'가 저장돼 있다. 이 값은 기본 회사 전용 판정으로 그대로 두고(한 글자도 안 바꿈),
// 다른 회사는 그 판정을 쓰지 않는다 — 회사가 넣은 검색어(맞춤 검색어 + 관심 사업 낱말)·제외어·지역으로 입찰 목록과 아침 메일을 만든다.
import { db } from '../db';

/** 공용 줄에 저장된 판정(관련·적합 사업·분류)을 쓰는 회사 = 기본 회사 */
export const ownsJudge = (tenant: string) => tenant === 'default';

/** 다른 회사에 보여 줄 공고 줄 — 기본 회사 판정·영업 메모·기본 회사 리드 연결을 뗀다(공고 자체 정보는 그대로) */
export function plainNotice<T extends Record<string, any>>(r: T): T {
  return { ...r, related: false, fit_business: null, matched_keywords: [], classification: null, fit_score: null, sales_point: null, qualification_gap: null, lead_id: null, refound_at: null };
}

/** 검색어 비교용(digest.passPrefs 와 같은 규칙: 빈칸을 없애고 대문자로) */
export const normText = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/** 회사 검색어 = 맞춤 검색어(sales_bid_prefs.keywords) + 켜 둔 관심 사업의 낱말(sales_business_categories.keywords). 두 글자 미만은 뺌(한 글자는 거의 모든 공고에 걸림) */
export async function judgeWords(tenant: string): Promise<string[]> {
  const sql = db();
  const [p] = await sql<{ keywords: string[] | null }[]>`select keywords from sales_bid_prefs where tenant = ${tenant}`;
  const cats = await sql<{ keywords: string[] | null }[]>`select keywords from sales_business_categories where tenant = ${tenant} and active`;
  const seen = new Set<string>(); const out: string[] = [];
  for (const w of [...(p?.keywords ?? []), ...cats.flatMap((c) => c.keywords ?? [])]) { const k = String(w ?? '').trim(); const n = normText(k); if (n.length < 2 || seen.has(n)) continue; seen.add(n); out.push(k); }
  return out;
}

/** SQL like 조각(빈칸 없는 대문자 제목에 대고 봄) */
export const likePatterns = (words: string[]) => words.map((w) => `%${normText(w).replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

/**
 * #1181 상업화 마감 1(로컬 코드 점검 11/26: '공용 입찰 수집 검색어가 다짐 업종으로 고정 — 다른 업종 회사는 나라장터 본공고가 거의 안 모임'):
 * 공용 수집에 더할 '다른 회사 검색어' — 입찰을 켠 회사(기본 회사·둘러보기(demo)·삭제·정지 회사 빼고 — 검수용 시험 회사는 넣음)의 맞춤 검색어 + 켜 둔 관심 사업 낱말.
 * 여러 회사가 같이 쓰는 낱말 먼저, 기본 검색어(base)와 같은 낱말은 뺌. 다짐 검색어·판정은 그대로라 다짐 결과는 늘기만 한다(받는 공고 풀이 넓어질 뿐).
 * 한 번 수집에 쓰는 수는 max 로 자르고, 낱말이 더 많으면 수집 회차(slot)마다 다음 묶음으로 돌아가며 씀
 */
export async function tenantSearchWords(base: string[], opt: { max?: number; slot?: number } = {}): Promise<{ words: string[]; total: number; tenants: number }> {
  const sql = db();
  const rows = await sql<{ tenant: string; words: string[] | null }[]>`
    select t.id as tenant, (coalesce(p.keywords, '{}'::text[]) || coalesce((select array_agg(k) from sales_business_categories c, unnest(c.keywords) k where c.tenant = t.id and c.active), '{}'::text[])) as words
    from tenants t left join sales_bid_prefs p on p.tenant = t.id
    where t.id not in ('default', 'demo') and t.deleted_at is null and coalesce(t.status, 'active') = 'active'`;
  const { salesBidsOn } = await import('./options');
  const seenBase = new Set(base.map(normText)); const count = new Map<string, { w: string; n: number }>(); let tenants = 0;
  for (const r of rows) {
    const mine = new Set<string>(); for (const w of r.words ?? []) { const k = String(w ?? '').trim(); const n = normText(k); if (n.length >= 2 && !seenBase.has(n)) mine.add(k); }
    if (!mine.size || !(await salesBidsOn(r.tenant).catch(() => false))) continue;
    tenants++;
    const once = new Set<string>(); for (const k of mine) { const n = normText(k); if (once.has(n)) continue; once.add(n); const c = count.get(n); if (c) c.n++; else count.set(n, { w: k, n: 1 }); }
  }
  const all = [...count.values()].sort((a, b) => b.n - a.n || a.w.localeCompare(b.w, 'ko')).map((x) => x.w);
  const max = Math.max(0, opt.max ?? Number(process.env.G2B_TENANT_WORDS_MAX ?? 8));
  if (all.length <= max) return { words: all, total: all.length, tenants };
  const start = ((opt.slot ?? 0) * max) % all.length;
  return { words: [...all.slice(start), ...all.slice(0, start)].slice(0, max), total: all.length, tenants };
}
