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
