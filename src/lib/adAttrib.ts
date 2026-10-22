/**
 * 광고 최적화 1차 ③ 통화 기반 최적화 — 광고 유입 주소(랜딩 URL)·utm 에서 매체·키워드를 읽는다(서버·시험 공용, DB 없음).
 * 네이버 '자동 추적 URL'(n_keyword_id·n_keyword·n_media·n_query…) · utm_source/medium/term · 구글 gclid(+ utm_term 의 {keyword}) · 메타(유료 utm).
 * 광고가 아닌 유입(검색·SNS 일반 링크)은 null — 광고 성과로 세지 않는다.
 */
export type AdProvider = 'naver' | 'google' | 'meta' | 'other';
export type AdAttrib = { provider: AdProvider; keyword: string; keywordId: string };
export const kwKey = (k: string) => k.replace(/\s+/g, '').toLowerCase();
const clip = (v: unknown, n = 60) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').trim().slice(0, n);
/** 랜딩 주소(전체 URL 또는 ?쿼리)와 utm 칸들 → 광고 유입이면 {매체, 키워드, 네이버 키워드 id} */
export function adAttrib(i: { landing?: unknown; utm?: unknown; utm_source?: unknown; utm_medium?: unknown; utm_term?: unknown }): AdAttrib | null {
  const q = new URLSearchParams();
  const add = (raw: string) => { const s = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw; for (const [k, v] of new URLSearchParams(s.split('#')[0])) if (!q.has(k)) q.set(k, v); };
  const landing = clip(i.landing, 2000); if (landing) add(landing);
  // 문의 폼이 utm 을 문자열('utm_source=naver&utm_medium=cpc' 또는 'source=naver · medium=cpc')이나 객체로 보내는 경우
  if (typeof i.utm === 'string') add(i.utm.replace(/\s*·\s*/g, '&'));
  else if (i.utm && typeof i.utm === 'object') for (const [k, v] of Object.entries(i.utm as Record<string, unknown>)) if (!q.has(k)) q.set(k, clip(v, 200));
  const get = (k: string) => clip(q.get(k) ?? q.get(k.replace(/^utm_/, '')) ?? '', 200);
  const src = (clip(i.utm_source) || get('utm_source')).toLowerCase();
  const med = (clip(i.utm_medium) || get('utm_medium')).toLowerCase();
  const term = clip(i.utm_term, 200) || get('utm_term');
  const paid = /cpc|ppc|paid|search_?ad|powerlink|sa$/.test(med);
  let provider: AdProvider | null = null;
  if (q.get('n_keyword_id') || q.get('n_keyword') || q.get('n_media') || (src.includes('naver') && paid)) provider = 'naver';
  else if (q.get('gclid') || q.get('gbraid') || q.get('wbraid') || (src.includes('google') && paid)) provider = 'google';
  else if (/facebook|instagram|meta|fb|ig/.test(src) && paid) provider = 'meta';
  else if (paid) provider = 'other';
  if (!provider) return null;
  const keyword = (provider === 'naver' ? clip(q.get('n_keyword'), 200) || term : term).slice(0, 60);
  return { provider, keyword, keywordId: provider === 'naver' ? clip(q.get('n_keyword_id'), 60) : '' };
}
/** 비콘 CTA 라벨 → 전화 클릭인지 */
export const isTelLabel = (label: string) => /tel|phone|call|전화/i.test(label);
