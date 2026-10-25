// #602(docs/handoff/SUPER_ADMIN_SCOPE_2026-10-25.md §4): 고객사 화면·API 응답에 있으면 안 되는 낱말 — E2E(customerSim)·API(customer-scope) 시험이 같이 쓴다.
/** 우리 회사(내부 테넌트) 이름·브랜드 — 고객 화면·응답에 없어야. '워크인'은 제품 이름이라 허용 */
export const INTERNAL_NAMES = /다짐|DAGYM|하이\s*-?\s*링크|HILINK|hi-?link|바디\s*랩|BODY ?LAB/i;
/** 모델·외부 서비스·원가·달러·HTTP 코드. 상태 코드는 'HTTP 403'·'403 오류'처럼 맥락이 있을 때만(예산 500원 같은 숫자와 구분), JSON 칸 이름 "usd" 는 값이 아니라 빼준다 */
export const FORBIDDEN_WORDS = /오퍼스|하이쿠|소네트|\bOpus\b|\bHaiku\b|\bSonnet\b|Anthropic|OpenAI|Higgsfield|NICE ?PAY|나이스페이|HTTP\s?\d{3}|\b(?:40[1-4]|50[0-4])\s?(?:오류|에러|error)|원가|\$\s?\d|(?<!")\bUSD\b|cost_usd|costUsd/i;

/** 본문에서 정규식이 맞은 자리 앞뒤 24자씩 — 실패 메시지용 */
export function snip(text, re, n = 3) {
  const out = []; const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); let m;
  while ((m = g.exec(text)) && out.length < n) out.push(text.slice(Math.max(0, m.index - 24), m.index + m[0].length + 24).replace(/\s+/g, ' '));
  return out;
}
export const forbidden = (text, n = 4) => snip(text, FORBIDDEN_WORDS, n);
export const internal = (text, n = 3) => snip(text, INTERNAL_NAMES, n);
