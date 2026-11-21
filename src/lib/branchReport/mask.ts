/**
 * #1096 지점 주간보고(다짐 전용) — AI 로 보내기 전에 개인정보 가림(docs/branch-report-design.md 3절).
 * 단톡방에는 직원·입주민 정보가 섞인다 → 전화번호·주민번호·카드·계좌·차량번호·동호수·이메일을 바꿔 쓴 글만 저장·전송.
 * 보낸 사람 이름은 '담당' 칸에 필요해 그대로(본문 속 입주민 이름은 가리기 어려움 — 대표 확인 사항). 이 파일은 Node 로 바로 불러 시험한다.
 */
export type MaskCounts = Record<'email' | 'rrn' | 'card' | 'phone' | 'car' | 'unit' | 'account', number>;
const RULES: [keyof MaskCounts, RegExp, string][] = [
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[이메일]'],
  ['rrn', /(?<!\d)\d{6}\s?-\s?[1-8]\d{6}(?!\d)/g, '[주민번호]'],
  ['card', /(?<!\d)\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}(?!\d)/g, '[카드]'],
  ['phone', /(?<![\d-])(?:\+?82[- ]?)?0\d{1,2}[- .)]?\d{3,4}[- .]?\d{4}(?![\d-])/g, '[전화]'],
  ['phone', /(?<![\d-])1[5-9]\d{2}-\d{4}(?![\d-])/g, '[전화]'],
  // 번호판 가운데 글자만(가~호·배·육해공국합) — '12월 2026'·'30분 1000원' 같은 글은 건드리지 않게
  ['car', /(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s?)?(?<!\d)\d{2,3}\s?[가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호육해공국합]\s?\d{4}(?!\d)/g, '[차량]'],
  ['unit', /(?<!\d)\d{1,4}\s?동\s?\d{1,4}\s?호(?!기|선|차)/g, '[호수]'],
  ['unit', /(?<![\d동])\d{3,4}\s?호(?!기|선|차|실)/g, '[호수]'],
  ['account', /(?<![\d-])\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,3})?(?![\d-])/g, '[계좌]'],
  ['account', /(?<!\d)\d{10,16}(?!\d)/g, '[계좌]'],
];
export function maskPII(text: string): { text: string; counts: MaskCounts } {
  const counts: MaskCounts = { email: 0, rrn: 0, card: 0, phone: 0, car: 0, unit: 0, account: 0 };
  let t = text;
  for (const [k, re, rep] of RULES) t = t.replace(re, () => { counts[k]++; return rep; });
  return { text: t, counts };
}
