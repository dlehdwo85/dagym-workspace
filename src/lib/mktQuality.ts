import { z } from 'zod';
import { db } from './db';
import { notFound } from './errors';
import { assertSpace } from './spaces';
import { tenantOf, type SessionUser } from './types';

/**
 * #426 P1 글 품질 엔진(docs/handoff/MKT_AGENT_SKILLS_2026-10-22.md 2장) — 자동 제작·제작의뢰실·광고 문구가 같이 쓰는 순수 검사기.
 * ① 훅 라이브러리·훅 점수(나쁜 훅 거르기용 — 승자는 실제 성과로) ② 대본 → 초 단위 구성표 ③ 채널별 글 검사기(숫자는 플랫폼 설정표)
 * ④ AI 티 제거(상투어·보이지 않는 문자·특수 대시 → '사람다움 점수', 70점 미만 = 다듬기 필요) ⑤ 브랜드 말투 프로필(voice).
 * 훅 공식 분류·상투어 목록은 github.com/Jakeschincariol/instagram-agent-skill(MIT) 의 구성을 참고해 한국어로 새로 씀.
 */

// ---------------- 규칙 숫자(플랫폼 운영 › 글 품질 규칙, app_settings 'mkt_quality_rules') ----------------
export type QualityRules = {
  hook: { min: number; maxSec: number }; human: { min: number }; script: { syllPerMin: number; sceneMaxSec: number; maxTotalSec: number };
  instagram: { preview: number; hashtags: number; cta: number }; threads: { max: number; links: number }; facebook: { previewLines: number; lineChars: number };
  youtube: { title: number; titleFront: number; descLines: number }; blog: { titleFront: number; minHeadings: number; keywordPer1000: number };
  ads: { googleHeadline: number; googleDesc: number; naverHeadline: number; naverDesc: number; metaPrimary: number };
};
export const DEFAULT_RULES: QualityRules = {
  hook: { min: 40, maxSec: 3 }, human: { min: 70 }, script: { syllPerMin: 300, sceneMaxSec: 4, maxTotalSec: 60 },
  instagram: { preview: 125, hashtags: 5, cta: 1 }, threads: { max: 500, links: 1 }, facebook: { previewLines: 2, lineChars: 60 },
  youtube: { title: 100, titleFront: 40, descLines: 2 }, blog: { titleFront: 15, minHeadings: 2, keywordPer1000: 6 },
  ads: { googleHeadline: 30, googleDesc: 90, naverHeadline: 15, naverDesc: 45, metaPrimary: 125 },
};
type Sec = keyof QualityRules;
/** 설정표 구역 이름 */
export const RULE_SECTIONS: Record<Sec, string> = { hook: '훅', human: '사람다움', script: '영상 대본', instagram: '인스타그램', threads: '스레드', facebook: '페이스북', youtube: '유튜브', blog: '네이버 블로그', ads: '광고 문구' };
/** 설정표 칸(화면·입력 검사 공용): [구역, 키, 이름, 최소, 최대, 단위] */
export const RULE_FIELDS: [Sec, string, string, number, number, string][] = [
  ['hook', 'min', '통과 점수', 0, 100, '점'], ['hook', 'maxSec', '첫 장면 최대', 1, 10, '초'], ['human', 'min', '통과 점수(아래면 다듬기 필요)', 0, 100, '점'],
  ['script', 'syllPerMin', '낭독 속도', 150, 500, '음절/분'], ['script', 'sceneMaxSec', '한 장면 최대', 1, 15, '초'], ['script', 'maxTotalSec', '전체 최대', 5, 600, '초'],
  ['instagram', 'preview', "'더 보기' 전 글자", 30, 2200, '자'], ['instagram', 'hashtags', '해시태그 최대', 0, 30, '개'], ['instagram', 'cta', '요청(CTA) 최대', 1, 5, '개'],
  ['threads', 'max', '글자 수 최대', 50, 500, '자'], ['threads', 'links', '링크 최대', 0, 5, '개'],
  ['facebook', 'previewLines', '미리보기 줄', 1, 10, '줄'], ['facebook', 'lineChars', '한 줄 글자', 20, 200, '자'],
  ['youtube', 'title', '제목 글자', 20, 100, '자'], ['youtube', 'titleFront', '핵심 키워드는 제목 앞', 10, 100, '자'], ['youtube', 'descLines', '설명 첫 줄 수', 1, 10, '줄'],
  ['blog', 'titleFront', '키워드는 제목 앞', 5, 60, '자'], ['blog', 'minHeadings', '소제목 최소', 0, 10, '개'], ['blog', 'keywordPer1000', '키워드 반복 최대(1000자당)', 1, 50, '회'],
  ['ads', 'googleHeadline', '구글 제목(한글 2배폭)', 10, 90, '폭'], ['ads', 'googleDesc', '구글 설명(한글 2배폭)', 30, 180, '폭'],
  ['ads', 'naverHeadline', '네이버 제목', 5, 50, '자'], ['ads', 'naverDesc', '네이버 설명', 10, 100, '자'], ['ads', 'metaPrimary', "Meta 기본 문구 '더 보기' 전", 40, 500, '자'],
];
export const rulesInput = z.object(Object.fromEntries((Object.keys(DEFAULT_RULES) as Sec[]).map((s) => [s,
  z.object(Object.fromEntries(RULE_FIELDS.filter((f) => f[0] === s).map(([, k, label, min, max]) => { const name = `${RULE_SECTIONS[s]} ${label}`;
    return [k, z.number({ invalid_type_error: `${name}: 숫자` }).min(min, `${name}: ${min} 이상`).max(max, `${name}: ${max} 이하`)]; }))).partial().optional()])));
export function mergeRules(v: unknown): QualityRules {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, Record<string, unknown>>;
  return Object.fromEntries((Object.keys(DEFAULT_RULES) as Sec[]).map((s) => [s, Object.fromEntries(Object.entries(DEFAULT_RULES[s]).map(([k, d]) => {
    const x = Number(src[s]?.[k]); return [k, Number.isFinite(x) && src[s]?.[k] !== null && src[s]?.[k] !== '' ? x : d];
  }))])) as QualityRules;
}
async function savedRules(): Promise<{ value: Record<string, unknown>; updatedAt: string | null }> {
  const [r] = await db()<{ value: Record<string, unknown>; updated_at: string }[]>`select value, updated_at from app_settings where key = 'mkt_quality_rules'`;
  return { value: r?.value ?? {}, updatedAt: r?.updated_at ?? null };
}
export async function qualityRules(): Promise<QualityRules> { return mergeRules((await savedRules().catch(() => ({ value: {} }))).value); }
export async function qualityRulesAdmin() { const s = await savedRules(); return { rules: mergeRules(s.value), defaults: DEFAULT_RULES, fields: RULE_FIELDS, sections: RULE_SECTIONS, updatedAt: s.updatedAt }; }
export async function saveQualityRules(userId: string, i: z.infer<typeof rulesInput>) {
  const sql = db(); const cur = (await savedRules()).value as Record<string, Record<string, unknown>>;
  const merged: Record<string, Record<string, unknown>> = { ...cur };
  for (const [s, v] of Object.entries(i)) merged[s] = { ...(cur[s] ?? {}), ...((v ?? {}) as Record<string, unknown>) }; // 칸 단위로 덮어씀(같은 구역의 다른 칸은 그대로)
  const next = mergeRules(merged);
  // 기본값과 같은 칸은 저장하지 않음(기본값이 바뀌면 따라가게)
  const diff = Object.fromEntries((Object.keys(next) as Sec[]).map((s) => [s, Object.fromEntries(Object.entries(next[s]).filter(([k, x]) => (DEFAULT_RULES[s] as Record<string, number>)[k] !== x))]).filter(([, o]) => Object.keys(o).length));
  await sql`insert into app_settings (key, value, updated_by) values ('mkt_quality_rules', ${sql.json(diff as never)}, ${userId})
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
  return next;
}

// ---------------- 공용 ----------------
const len = (s: string) => [...s].length;
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
/** 구글 광고 글자 폭: 한글·한자·전각은 2 */
export const textWidth = (s: string) => [...s].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0);
const EMOJI = /\p{Extended_Pictographic}/gu;
const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);
const sentences = (t: string) => t.split(/(?<=[.!?。…])\s+|\n+/).map((s) => s.trim()).filter((s) => len(s) >= 2);
/** 채우지 않은 자리({{숫자}}·○○·[확인 필요]·[○○ 입력]) — '[이벤트]' 같은 머리말은 아님 */
const PLACEHOLDER = /\{\{[^}]*\}\}|○○|△△|\[(?:확인\s*필요|[^\]\n]{0,12}입력)[^\]\n]{0,12}\]/;

// ---------------- ④ AI 티 제거(휴머나이저) ----------------
/** 한국어 상투어 사전 — AI 가 자주 쓰는 빈말(하나당 6점, 최대 48점 감점) */
export const CLICHES: [RegExp, string][] = [
  [/해\s?보는\s?(?:건|것은|게)\s?어떨까요/, '~해 보는 건 어떨까요'], [/놓치지\s?마(?:세요|시길)/, '놓치지 마세요'], [/지금\s?바로/, '지금 바로'], [/다양한/, '다양한'],
  [/혁신적(?:인|으로)/, '혁신적인'], [/의\s?모든\s?것/, '~의 모든 것'], [/특별한\s?(?:경험|순간|혜택|시간|하루)/, '특별한 경험'], [/한\s?단계\s?(?:더\s?)?(?:업그레이드|성장|높여)/, '한 단계 업그레이드'],
  [/완벽한/, '완벽한'], [/최적의/, '최적의'], [/새로운\s?차원/, '새로운 차원'], [/여러분의\s?(?:일상|삶|하루)/, '여러분의 일상'],
  [/(?:알아보|살펴보)(?:겠습니다|도록\s?하겠습니다)|(?:알아볼|살펴볼)까요/, '~를 알아보겠습니다'], [/결론적으로|요약하자면|종합해\s?보면/, '결론적으로'], [/뿐만\s?아니라/, '뿐만 아니라'],
  [/놀라운/, '놀라운'], [/마법\s?같은/, '마법 같은'], [/소중한\s?(?:시간|분들|고객|추억)/, '소중한 ~'], [/잊지\s?못할/, '잊지 못할'], [/라는\s?사실,?\s?알고\s?계셨나요/, '~라는 사실, 알고 계셨나요'],
  [/한번\s?(?:경험|확인|만나)(?:해)?\s?보세요/, '한번 경험해 보세요'], [/망설이지\s?마(?:세요|시고)/, '망설이지 마세요'], [/선사(?:해\s?드립|합)니다/, '선사합니다'], [/누구나\s?(?:쉽게|손쉽게)/, '누구나 쉽게'],
  [/(?:빠르게|급변하는)\s?(?:변화하는\s?)?(?:시대|세상)/, '빠르게 변화하는 시대'], [/여정을\s?(?:시작|함께)/, '여정을 시작'],
];
const INVISIBLE = /[​‌‎‏⁠-⁤﻿­‪-‮⁦-⁩]/g; // ZWJ(이모지 결합)는 남김
const ODD_SPACE = /[   　]/g;
export type HumanReport = { text: string; score: number; pass: boolean; issues: string[]; cliches: string[]; removed: { invisible: number; dashes: number } };
export function humanize(input: string, rules: QualityRules = DEFAULT_RULES): HumanReport {
  let t = String(input ?? '').replace(/\r\n/g, '\n'); let invisible = 0; let dashes = 0;
  t = t.replace(INVISIBLE, () => { invisible++; return ''; }).replace(ODD_SPACE, () => { invisible++; return ' '; });
  // 특수 대시: 숫자 사이 범위 → '~', 줄 머리 → '- ', 문장 중간 → 쉼표
  t = t.replace(/(\d)[ \t]*[–‒][ \t]*(\d)/g, (_, a, b) => { dashes++; return `${a}~${b}`; })
    .replace(/^[ \t]*[—―⸺⸻–‒][ \t]*/gm, () => { dashes++; return '- '; })
    .replace(/[ \t]*[—―⸺⸻–‒][ \t]*/g, () => { dashes++; return ', '; })
    .replace(/,[ \t]*([,.!?)\]])/g, '$1').replace(/,[ \t]*$/gm, '');
  const issues: string[] = []; let pen = 0;
  const cl = CLICHES.filter(([re]) => re.test(t)).map(([, w]) => w);
  if (cl.length) { pen += Math.min(48, cl.length * 6); issues.push(`상투어 ${cl.map((w) => `'${w}'`).join(' ')}`); }
  const n = len(t); const bang = (t.match(/!/g) ?? []).length;
  if (bang > Math.max(2, Math.floor(n / 150))) { pen += 8; issues.push(`느낌표 ${bang}개(과함)`); }
  if (/!!|！！/.test(t)) { pen += 5; issues.push("'!!' 겹 느낌표"); }
  const emo = (t.match(EMOJI) ?? []).length;
  if (emo > Math.max(3, Math.floor(n / 100))) { pen += 8; issues.push(`이모지 ${emo}개(과함)`); }
  if (/(?:\p{Extended_Pictographic}️?\s*){3,}/u.test(t)) { pen += 6; issues.push('이모지 나열'); }
  const ss = sentences(t).filter((s) => len(s) >= 8); // 릴스 컷 줄처럼 짧은 줄 몇 개는 빼고, 긴 글에서만
  if (ss.length >= 5) {
    const L = ss.map(len); const m = L.reduce((a, b) => a + b, 0) / L.length; const sd = Math.sqrt(L.reduce((a, b) => a + (b - m) ** 2, 0) / L.length);
    if (sd / m < 0.15) { pen += 10; issues.push('문장 길이가 거의 같음(단조로움)'); }
  }
  const triples = (t.match(/[^,·\n.!?]{1,15}[,·]\s?[^,·\n.!?]{1,15}[,·]\s?(?:그리고\s)?[^,·\n.!?]{1,15}/g) ?? []).length;
  if (triples >= 3) { pen += 8; issues.push(`3개씩 나열하는 습관 ${triples}회`); }
  if (invisible) issues.push(`보이지 않는 문자 ${invisible}개 지움`);
  if (dashes) issues.push(`특수 대시 ${dashes}개 바꿈`);
  const score = Math.max(0, Math.min(100, 100 - pen));
  return { text: t.trim(), score, pass: score >= rules.human.min, issues, cliches: cl, removed: { invisible, dashes } };
}

// ---------------- ① 훅 라이브러리·훅 점수 ----------------
/** 훅 공식 26개(한국어) — AI 가 서로 다른 공식으로 3개를 쓰게 함. 결과·가격·최상급은 재료에 근거가 있을 때만 */
export const HOOK_FORMULAS: [string, string][] = [
  ['반전', '다들 ○○라고 하지만, 사실은 △△'], ['숫자', '○○하는 3가지 방법'], ['아무도 안 알려주는', '아무도 안 알려주는 ○○'], ['실제 결과', '○○했더니 생긴 변화(재료에 있는 사례만)'],
  ['가장', '가장 쉬운 ○○(근거 있을 때만)'], ['공개', '처음 공개하는 ○○'], ['실수', '○○할 때 가장 많이 하는 실수'], ['질문', '○○, 해 본 적 있으세요?'],
  ['대상 호명', '○○하는 분이라면 꼭'], ['전후 비교', '○○ 전과 후'], ['시간', '딱 ○분이면 ○○'], ['경고', '○○하기 전에 이것부터'],
  ['이야기', '어제 ○○에서 생긴 일'], ['솔직 고백', '솔직히 말하면 ○○'], ['오해 깨기', '○○는 사실 오해입니다'], ['방법', '○○하는 법, 한 장 정리'],
  ['진짜 이유', '○○하는 진짜 이유'], ['해 봤다', '○○ 7일 해 봤습니다'], ['현장', '○○ 준비하는 현장'], ['가격·가치', '○○원으로 ○○하기(실제 가격만)'],
  ['공감', '월요일 아침, ○○할 때'], ['추천 순위', '○○ 추천 TOP 3'], ['체크리스트', '○○ 체크리스트 5'], ['비교', '○○ vs △△, 뭐가 나을까'],
  ['손해', '이거 모르면 ○○ 손해'], ['새 소식', '이번 주부터 ○○ 바뀝니다'],
];
/** #499-1(테크트리 EP.12·S1): 목적 — 콘텐츠형(참여: 시청 지속·저장·공유·댓글) / 광고형(전환: 리드·문의 단가). 틀과 훅 채점을 따로 */
export type HookMode = 'content' | 'ad';
export const HOOK_MODES: Record<HookMode, string> = { content: '콘텐츠형(참여)', ad: '광고형(전환)' };
export const asMode = (x: unknown): HookMode => (x === 'ad' ? 'ad' : 'content');
export const MODE_GUIDE: Record<HookMode, string> = {
  content: '콘텐츠형(참여): 첫 줄은 질문·공감·이야기로 — 가격·할인·신청 같은 판매 문구로 시작하지 않습니다. 구조: 이야기 → 반전 → 비교 → 자문자답 → 마지막에 행동 1개(저장·댓글 키워드). 성공 기준은 시청 지속·저장·공유·댓글.',
  ad: '광고형(전환): 첫 줄 2초 안에 대상·상황을 부르고(○○하는 분·○○ 앞둔 단지) 무엇을 주는지(무료 진단·체크리스트·제안서·실제 가격) 말합니다. 구조: 지목 → 제안 → 문제 한 줄 → 장점 2~3개 → 행동 1개. 제안·가격·혜택은 재료에 있는 것만. 성공 기준은 리드·문의 단가.',
};
/** AI 지시문에 넣는 훅 안내 */
export const hookGuide = (where: string, mode: HookMode = 'content') => `- hooks: ${where}에 쓸 훅 후보 3개(서로 다른 공식, 30자 안팎). 공식: ${HOOK_FORMULAS.map(([n, ex]) => `${n}(${ex})`).join(' · ')}.
  인사로 시작·"스크롤 멈추세요"류·"오늘은 ~를 소개합니다" 같은 내용 없는 서두 금지. 숫자·결과·가격은 재료에 있는 것만. 가장 좋은 훅을 본문 첫 줄(제목·첫 장면)에 씁니다.
- 목적 ${MODE_GUIDE[mode]}`;
const GREETING = /^(?:안녕하세요|안녕|반갑습니다|여러분\s?안녕)/;
const FILLER = /^(?:여러분|오늘은|오늘도|이번에는|자,|음,|혹시\s?아시나요)/;
const SCROLL_STOP = /스크롤\s?(?:을\s?)?(?:멈추|멈춰|내리지)|잠깐만요|주목해\s?주세요|이거\s?(?:꼭\s?)?보세요/;
const EMPTY_OPEN = /^(?:(?:오늘|이번)[^.!?\n]{0,20}(?:소개|알려|이야기|준비했|가져왔)|소개해\s?드릴|알려\s?드릴|함께\s?알아|[^.!?\n]{0,15}에\s?대해\s?알아보)/;
const VAGUE = /다양한|여러\s?가지|많은|좋은|특별한|최고의|놀라운|완벽한/;
const NUM_WORD = /\d|(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s?(?:가지|개|명|번|분|시간|일|주|달|개월|살|곳|단계)/;
const UNIT = /\d+(?:[.,]\d+)?\s?(?:%|가지|개|명|번|분|초|시간|일|주|개월|달|년|살|원|만\s?원|kg|km|cm|곳|단계|배|층|평|회|세트|TOP)/i;
const STAKES = /손해|실수|놓치면|망치|후회|아끼|절약|줄이|줄어|늘리|늘어|효과|결과|차이|비용|돈|위험|주의|경고|몰랐|바뀌|달라지|변화|살\s?빠|건강|통증|매출|문의|예약/;
const CALLOUT = /이라면|라면|하는\s?분|인\s?분|신\s?분|분들|분께|사장님|직장인|초보|입문|\d+대|엄마|아빠|부모|학생|주부|대표님|원장님|회원님|고객님|러너|헬린이|입주민|자영업|앞둔|소장님|관리사무소|입주자\s?대표/; // #499-1 '처음이신 분'·'공사 앞둔 단지'·'관리소장님'
const CURIOUS = /\?|사실|진짜|의외|아무도|몰랐|비밀|반전|하지만|대신|왜|이유|끝까지|공개|처음|정체|숨은|모르는|vs/i;
const OPEN_LOOP = /(?:것|이유|방법|차이|비밀|정체|결과|순간|한\s?가지|단\s?하나)\s*[.!?…]*$/;
/** 광고형 '제안'(무엇을 주는가) · 콘텐츠형 '처음부터 판다'(앞 12자 안 판매 문구) */
const OFFER = /무료|할인|\d+\s?%|\d[\d,]*\s?(?:만\s?)?원|체험|상담|진단|견적|제안서|체크리스트|시연|이벤트|혜택|쿠폰|증정|드려요|드립니다|받아\s?가|받으세요|신청|예약|오픈|출시|모집|1\s?\+\s?1/;
const SALES_EARLY = /^[^.!?\n]{0,12}(?:할인|특가|이벤트|구매|주문|\d[\d,]*\s?(?:만\s?)?원|지금\s?(?:바로\s?)?(?:신청|예약|구매|문의|상담)|선착순|마감\s?임박)/;
export type HookScore = { text: string; score: number; pass: boolean; parts: Record<string, number>; fails: string[]; mode?: HookMode; notes?: string[] };
/** 콘텐츠형: 5항목 × 20(앞부분 집중·구체성·걸린 것·대상 호명·궁금증) − 상투어 − '처음부터 판다' 15.
 * 광고형(#499-1): 앞부분 20·대상 호명 25·제안 25·구체성 15·걸린 것 15 — 궁금증 대신 '누구에게 무엇을'. 탈락 사유가 있으면 20점 이하 */
export function scoreHook(raw: string, rules: QualityRules = DEFAULT_RULES, keywords: string[] = [], mode: HookMode = 'content'): HookScore {
  const text = String(raw ?? '').replace(INVISIBLE, '').trim(); const n = len(text);
  const fails: string[] = [];
  if (!text) fails.push('훅 없음');
  if (GREETING.test(text)) fails.push('인사로 시작');
  if (SCROLL_STOP.test(text)) fails.push("'스크롤 멈추세요'류 문구");
  if (EMPTY_OPEN.test(text)) fails.push('내용 없는 서두');
  if (PLACEHOLDER.test(text)) fails.push('채우지 않은 자리표시');
  if (n > 80) fails.push('훅이 너무 김(80자 초과)');
  const kw = keywords.map((k) => k.trim()).filter((k) => len(k) >= 2);
  const front = !text || GREETING.test(text) || FILLER.test(text) || EMPTY_OPEN.test(text) ? 0 : n <= 30 ? 20 : n <= 45 ? 12 : 5;
  const spec = UNIT.test(text) ? 4 : NUM_WORD.test(text) ? 3 : kw.some((k) => text.includes(k)) ? 2 : VAGUE.test(text) ? 0 : 1; // 4단계 → 항목 배점에 맞춤
  const notes: string[] = []; let pen = CLICHES.filter(([re]) => re.test(text)).length * 10;
  let parts: Record<string, number>;
  if (mode === 'ad') {
    parts = { front, callout: CALLOUT.test(text) ? 25 : 0, offer: OFFER.test(text) ? 25 : 0, specific: [0, 4, 8, 11, 15][spec], stakes: STAKES.test(text) ? 15 : 0 };
    if (!parts.offer) notes.push('제안이 없음 — 광고형은 무엇을 주는지(무료 진단·체크리스트·제안서·실제 가격)를 2초 안에');
    if (!parts.callout) notes.push('대상 호명이 없음 — 누구에게(○○하는 분·○○ 앞둔 단지)');
  } else {
    parts = { front, specific: [0, 5, 10, 15, 20][spec], stakes: STAKES.test(text) ? 20 : 0, callout: CALLOUT.test(text) ? 20 : 0, curiosity: CURIOUS.test(text) || OPEN_LOOP.test(text) ? 20 : 0 };
    if (SALES_EARLY.test(text)) { pen += 15; notes.push('처음부터 판다(가격·할인·신청) — 콘텐츠형은 질문·공감·이야기로 시작'); }
  }
  let score = Math.max(0, Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0) - pen));
  if (fails.length) score = Math.min(score, 20);
  return { text, score, pass: !fails.length && score >= rules.hook.min, parts, fails, mode, notes };
}

// ---------------- ② 대본 → 초 단위 구성표 ----------------
const VIDEO = new Set(['reels', 'shorts', 'video']);
const CUT = /^\s*(?:[[(【]?\s*(?:컷|장면|씬|scene|cut|shot)\s*\d+\s*[\])】]?|#\s?\d+|\d+\s?[.)]|S\d+)\s*[:.)\-–]?\s*(.+)$/i;
/** 릴스·쇼츠 원고에서 컷 줄('[컷1] …', '#1 …', '1) …')만 — 괄호 안 화면 지시·따옴표는 뺌 */
export function scriptLines(body: string): string[] {
  const out = lines(body).map((l) => l.match(CUT)?.[1]).filter((x): x is string => !!x)
    .map((x) => x.replace(/\([^)]*\)/g, '').replace(/[“”"'‘’「」『』]/g, '').replace(/^(?:자막|내레이션|나레이션|대사|화면)\s*[:：]\s*/, '').trim()).filter(Boolean);
  return out.length >= 2 ? out : [];
}
/** 한국어 낭독 음절 수(숫자는 읽으면 길어 1.2, 영문 약어는 글자당 1, 단어는 모음 묶음 × 1.5) */
export function syllables(line: string) {
  let n = (line.match(/[가-힣]/g) ?? []).length + (line.match(/\d/g) ?? []).length * 1.2;
  for (const w of line.match(/[A-Za-z]+/g) ?? []) n += /^[A-Z]{1,5}$/.test(w) ? w.length : Math.max(1, (w.match(/[aeiouy]+/gi) ?? []).length) * 1.5;
  return n;
}
export type Timing = { rows: { line: string; from: number; to: number; sec: number; over?: boolean }[]; total: number; warnings: string[] };
const r1 = (x: number) => Math.round(x * 10) / 10;
const stems = (t: string) => new Set((t.match(/[가-힣A-Za-z0-9]{2,}/g) ?? []).map((w) => w.slice(0, 2)));
/** 광고형 마지막 장면 = 행동 1개(신청·문의·상담·예약·받기 등) */
const ACTION = /신청|문의|상담|예약|받아|받기|받으세요|클릭|링크|프로필|전화|DM|메시지|방문|구독|저장|댓글|확인해\s?보세요|시작하세요|들러/;
/** #499-1 광고형 영상 길이 제안값 15초 — 20초를 넘으면 경고 */
export const AD_MAX_SEC = 20;
export function scriptTiming(script: string[], rules: QualityRules = DEFAULT_RULES, mode: HookMode = 'content'): Timing {
  const per = rules.script.syllPerMin / 60; let at = 0;
  const rows = script.map((line, k) => {
    const pause = (line.match(/,/g) ?? []).length * 0.15 + (line.match(/[.!?…]/g) ?? []).length * 0.25;
    const sec = r1(Math.max(0.6, syllables(line) / per + pause)); const row = { line, from: r1(at), to: r1(at + sec), sec, over: sec > (k === 0 ? rules.hook.maxSec : rules.script.sceneMaxSec) }; at += sec; return row;
  });
  const total = r1(at); const warnings: string[] = [];
  if (rows[0] && rows[0].sec > rules.hook.maxSec) warnings.push(`훅(첫 장면) ${rows[0].sec}초 — ${rules.hook.maxSec}초 안에 끝나게 줄이세요`);
  rows.forEach((r, k) => { if (k > 0 && r.sec > rules.script.sceneMaxSec) warnings.push(`${k + 1}번째 장면 ${r.sec}초 — ${rules.script.sceneMaxSec}초 넘으면 이탈 구간(둘로 나누기)`); });
  const vague = (l: string) => !NUM_WORD.test(l) && (VAGUE.test(l) || CLICHES.some(([re]) => re.test(l)));
  for (let k = 1; k < rows.length; k++) if (vague(rows[k - 1].line) && vague(rows[k].line)) { warnings.push(`${k}~${k + 1}번째 장면이 연달아 막연함(숫자·장면 없이 '다양한·좋은')`); break; }
  if (mode === 'ad') { // 광고형: 끝은 반복 고리 대신 행동 1개, 15초 안팎
    if (rows.length >= 2 && !ACTION.test(rows[rows.length - 1].line)) warnings.push('광고형 마지막 장면에 행동 1개(신청·문의·상담·예약 등)를 넣으세요');
  } else if (rows.length >= 3) {
    const a = stems(rows[0].line); const z = rows[rows.length - 1].line;
    if (![...stems(z)].some((w) => a.has(w)) && !/처음|다시|그래서|그러니까|이게\s?바로|\?/.test(z)) warnings.push('마지막 장면이 첫 장면과 이어지지 않음 — 반복 시청 고리(첫 말로 돌아가기)를 넣으세요');
  }
  const max = mode === 'ad' ? Math.min(rules.script.maxTotalSec, AD_MAX_SEC) : rules.script.maxTotalSec;
  if (total > max) warnings.push(mode === 'ad' ? `전체 ${total}초 — 광고형은 15초 안팎(${max}초 넘음)` : `전체 ${total}초 — ${max}초를 넘음`);
  return { rows, total, warnings };
}
/** Higgsfield·제작 요청 카드에 넘기는 장면표 한 덩어리 */
export const timingText = (t: Timing) => `장면 구성(초 단위·분당 낭독 속도 기준, 전체 ${t.total}초):\n${t.rows.map((r, k) => `${k + 1}) ${r.from.toFixed(1)}~${r.to.toFixed(1)}초 «${r.line}»`).join('\n')}${t.warnings.length ? `\n주의: ${t.warnings.join(' / ')}` : ''}`;

// ---------------- ③ 채널별 글 검사기 ----------------
export type ChannelIssue = { level: 'error' | 'warn'; msg: string };
const CTA = /(?:문의|예약|신청|방문|상담|구매|주문|가입|DM|디엠|링크|프로필|댓글|저장|공유|팔로우|전화)\s?(?:하|해|주|남겨|눌러|확인|부탁|드려|걸어|보내)/g;
const HASHTAG = /(^|\s)#[^\s#]+/g;
/** 인스타 해시태그 상한(2025-12-18 이후 5개) — AI 원고는 앞에서부터 상한까지만 남김 */
export function trimHashtags(body: string, max: number) {
  let k = 0; const out = body.replace(HASHTAG, (m) => (++k > max ? '' : m));
  return { body: k > max ? out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : body, removed: Math.max(0, k - max) };
}
export function checkChannel(channel: string, kind: string | null | undefined, i: { title?: string; body: string; keywords?: string[]; mainKeyword?: string | null }, rules: QualityRules = DEFAULT_RULES) {
  const issues: ChannelIssue[] = []; const text = String(i.body ?? '').trim(); const L = lines(text); const title = String(i.title ?? '').trim();
  const urls = text.match(/https?:\/\/\S+/g) ?? []; const tags = (text.match(HASHTAG) ?? []).length;
  const kw = (i.keywords ?? []).map((k) => k.trim()).filter((k) => len(k) >= 2); let preview: string | null = null;
  if (channel === 'instagram') {
    const R = rules.instagram; preview = [...text].slice(0, R.preview).join('');
    if (L[0] && len(L[0]) > R.preview) issues.push({ level: 'warn', msg: `첫 줄 ${len(L[0])}자 — '더 보기' 전 ${R.preview}자 안에 핵심이 보이게` });
    if (tags > R.hashtags) issues.push({ level: 'error', msg: `해시태그 ${tags}개 — 최대 ${R.hashtags}개` });
    if (kind !== 'story') {
      const cta = new Set((text.match(CTA) ?? []).map((m) => m.replace(/\s/g, '').slice(0, 2))).size;
      if (cta > R.cta) issues.push({ level: 'warn', msg: `요청(CTA) ${cta}가지 — ${R.cta}개만(저장·댓글·문의 중 하나)` });
      else if (!cta) issues.push({ level: 'warn', msg: '요청(CTA)이 없음 — 저장·댓글·문의 중 하나를 마지막에' });
      if (kw.length && !kw.some((k) => text.includes(k))) issues.push({ level: 'warn', msg: `검색 키워드(${kw.slice(0, 2).join('·')})가 본문에 없음` });
    }
    if (urls.length) issues.push({ level: 'warn', msg: '인스타 본문 링크는 눌리지 않음 — "프로필 링크"로 안내' });
  } else if (channel === 'threads') {
    const R = rules.threads;
    if (len(text) > R.max) issues.push({ level: 'error', msg: `스레드는 ${R.max}자 이내(지금 ${len(text)}자)` });
    if (urls.length > R.links) issues.push({ level: 'warn', msg: `링크 ${urls.length}개 — ${R.links}개만` });
    preview = L[0] ?? null;
  } else if (channel === 'facebook') {
    const R = rules.facebook; preview = L.slice(0, R.previewLines).join('\n');
    if (len(L.slice(0, R.previewLines).join(' ')) > R.lineChars * R.previewLines) issues.push({ level: 'warn', msg: `첫 ${R.previewLines}줄(약 ${R.lineChars * R.previewLines}자) 안에 핵심이 보이게 — 뒤는 '더 보기'로 접힘` });
    if (urls.length > 1) issues.push({ level: 'warn', msg: `링크 ${urls.length}개 — 1개만(첫 링크가 카드로 보임)` });
  } else if (channel === 'youtube') {
    const R = rules.youtube;
    if (title && len(title) > R.title) issues.push({ level: 'error', msg: `유튜브 제목 ${len(title)}자 — ${R.title}자 이내` });
    const main = (i.mainKeyword ?? '').trim();
    if (title && main && !title.slice(0, R.titleFront).includes(main)) issues.push({ level: 'warn', msg: `제목 앞 ${R.titleFront}자 안에 핵심 키워드 '${main}'` });
    if (!L.length) issues.push({ level: 'warn', msg: `설명 첫 ${R.descLines}줄이 비어 있음` });
    preview = L.slice(0, R.descLines).join('\n') || null;
  } else if (channel === 'blog') {
    const R = rules.blog; const main = (i.mainKeyword ?? '').trim();
    if (title && main) { const at = title.indexOf(main); if (at < 0 || at > R.titleFront) issues.push({ level: 'warn', msg: `제목 앞쪽(${R.titleFront}자 안)에 키워드 '${main}'` }); }
    const heads = L.filter((l) => /^(?:■|##|\[소제목\])/.test(l)).length;
    if (heads < R.minHeadings) issues.push({ level: 'warn', msg: `소제목 ${heads}개 — ${R.minHeadings}개 이상(■ 소제목)` });
    for (const k of [...new Set([main, ...kw].filter((k) => len(k) >= 2))]) {
      const c = text.split(k).length - 1;
      if (c >= 5 && c / Math.max(1, len(text) / 1000) > R.keywordPer1000) issues.push({ level: 'warn', msg: `'${k}' ${c}회 — 반복 과다(네이버 저품질 위험)` });
    }
  }
  return { issues, preview };
}
/** 광고 문구: 구글 제목 30/설명 90(한글 2배폭) · 네이버 제목 15/설명 45 · Meta 기본 문구 첫 125자 */
export function checkAd(platform: 'google' | 'naver' | 'meta', a: { headline?: string; description?: string; primary?: string }, rules: QualityRules = DEFAULT_RULES): ChannelIssue[] {
  const R = rules.ads; const out: ChannelIssue[] = []; const h = (a.headline ?? '').trim(); const d = (a.description ?? '').trim();
  if (platform === 'google') {
    if (textWidth(h) > R.googleHeadline) out.push({ level: 'error', msg: `구글 제목 폭 ${textWidth(h)} — ${R.googleHeadline} 이내(한글은 2)` });
    if (textWidth(d) > R.googleDesc) out.push({ level: 'error', msg: `구글 설명 폭 ${textWidth(d)} — ${R.googleDesc} 이내(한글은 2)` });
  } else if (platform === 'naver') {
    if (len(h) > R.naverHeadline) out.push({ level: 'error', msg: `제목은 ${R.naverHeadline}자 이내(지금 ${len(h)}자)` });
    if (len(d) > R.naverDesc) out.push({ level: 'error', msg: `설명은 ${R.naverDesc}자 이내(지금 ${len(d)}자)` });
  } else if (len((a.primary ?? '').trim()) > R.metaPrimary) out.push({ level: 'warn', msg: `기본 문구 ${len((a.primary ?? '').trim())}자 — 첫 ${R.metaPrimary}자 뒤는 '더 보기'로 접힘(핵심을 앞에)` });
  return out;
}

// ---------------- ⑤ 브랜드 말투 프로필 ----------------
export const voiceInput = z.object({
  topics: z.string().trim().max(300).default(''), audience: z.string().trim().max(300).default(''),
  phrases: z.array(z.string().trim().min(1).max(60)).max(20).default([]), avoid: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  formality: z.enum(['polite', 'casual', 'mixed']).default('polite'), emoji: z.enum(['none', 'few', 'many']).default('few'),
  offer: z.string().trim().max(300).default(''), examples: z.array(z.string().trim().min(1).max(1500)).max(5).default([]),
});
export type Voice = z.infer<typeof voiceInput>;
const FORMALITY = { polite: '존댓말(…요·…니다)', casual: '반말', mixed: '존댓말 기본, 짧은 감탄은 반말 섞어도 됨' };
const EMOJI_USE = { none: '이모지 안 씀', few: '이모지 1~2개까지', many: '이모지 자유롭게(나열은 금지)' };
export const hasVoice = (v: Partial<Voice> | null | undefined) => !!v && !!(v.topics || v.audience || v.offer || v.phrases?.length || v.avoid?.length || v.examples?.length);
/** '절대 안 쓰는 표현'(금지어처럼 검사) — 배열이 아니면 없음 */
export const avoidOf = (v: unknown): string[] => { const a = (v as { avoid?: unknown } | null)?.avoid; return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []; };
/** 저장된 프로필이 형식에 안 맞으면(옛 값 등) 없는 것으로 — 원고 쓰기를 막지 않음 */
const voiceOf = (v: Partial<Voice> | null | undefined): Voice | null => { if (!hasVoice(v)) return null; const r = voiceInput.safeParse(v); return r.success ? r.data : null; };
/** AI 지시문에 넣는 말투 프로필 — 예시 글은 말투·리듬만 참고 */
export function voicePrompt(v: Partial<Voice> | null | undefined) {
  const x = voiceOf(v); if (!x) return '';
  return [`[말투 프로필]`, x.topics && `- 주로 다루는 주제: ${x.topics}`, x.audience && `- 타겟: ${x.audience}`, x.offer && `- 파는 것: ${x.offer}`,
    x.phrases.length && `- 자주 쓰는 말: ${x.phrases.join(', ')}`, x.avoid.length && `- 절대 안 쓰는 표현: ${x.avoid.join(', ')}`,
    `- ${FORMALITY[x.formality]} · ${EMOJI_USE[x.emoji]}`,
    x.examples.length && `잘 된 글 예시(말투·리듬만 참고, 내용·숫자는 베끼지 않음):\n${x.examples.map((e, k) => `${k + 1}) ${[...e].slice(0, 300).join('')}`).join('\n')}`].filter(Boolean).join('\n');
}
/** 말투 프로필과 다른 점(경고만) */
export function voiceIssues(text: string, v: Partial<Voice> | null | undefined): string[] {
  const x = voiceOf(v); if (!x) return [];
  const out: string[] = []; const ss = sentences(text);
  const casual = ss.filter((s) => /(?:[^니]다|어|야|지|해|아|자|네|군)[.!]?$/.test(s)).length; const polite = ss.filter((s) => /(?:요|니다|세요|죠)[.!?]?$/.test(s)).length;
  if (x.formality === 'polite' && casual >= 2 && casual > polite) out.push('말투 프로필은 존댓말 — 반말 문장이 많음');
  if (x.formality === 'casual' && polite >= 2 && polite > casual) out.push('말투 프로필은 반말 — 존댓말 문장이 많음');
  const emo = (text.match(EMOJI) ?? []).length;
  if (x.emoji === 'none' && emo) out.push(`말투 프로필은 이모지 안 씀 — ${emo}개 있음`);
  if (x.emoji === 'few' && emo > 2) out.push(`말투 프로필은 이모지 1~2개 — ${emo}개 있음`);
  return out;
}

// ---------------- 묶음 보고서 ----------------
/** 어느 줄이 훅인가: 릴스·쇼츠·영상 = 첫 장면, 블로그 = 제목, 그 밖 = 본문 첫 줄 */
export function hookOf(kind: string | null | undefined, title: string, body: string, script: string[]) {
  if (kind && VIDEO.has(kind) && script.length) return script[0];
  if (kind === 'blog') return title;
  return lines(body)[0] ?? '';
}
export type QualityReportData = {
  v?: number; human: { score: number; pass: boolean; issues: string[] }; needsPolish: boolean; hook: HookScore | null; hooks: HookScore[];
  channel: ChannelIssue[]; preview: string | null; timing: Timing | null; voice: string[]; keyword?: string | null; mode?: HookMode;
};
export function qualityReport(i: { channel: string; kind?: string | null; title?: string; body: string; hooks?: string[]; script?: string[]; keywords?: string[]; mainKeyword?: string | null; voice?: Partial<Voice> | null; cross?: string[]; mode?: HookMode | null }, rules: QualityRules = DEFAULT_RULES): { body: string; report: QualityReportData } {
  const mode: HookMode = i.mode === 'ad' ? 'ad' : 'content';
  const kind = i.kind ?? null; const h = humanize(i.body, rules); const title = String(i.title ?? '').replace(/^\s*\[시험\]\s*/, '');
  const script = i.script?.filter((x) => String(x ?? '').trim()).map((x) => String(x).trim()) ?? [];
  const sc = script.length >= 2 ? script : kind && VIDEO.has(kind) ? scriptLines(h.text) : [];
  const keywords = [i.mainKeyword ?? '', ...(i.keywords ?? [])].filter(Boolean);
  const hookText = hookOf(kind, title, h.text, sc);
  const ch = checkChannel(i.channel, kind, { title, body: h.text, keywords, mainKeyword: i.mainKeyword }, rules);
  // '스레드에도'·'페이스북에도' 같이 올리는 채널은 막는 문제(error)만
  for (const x of (i.cross ?? []).filter((c) => c !== i.channel)) for (const e of checkChannel(x, kind, { title, body: h.text }, rules).issues) if (e.level === 'error') ch.issues.push({ level: 'error', msg: `${x === 'threads' ? '스레드' : x === 'facebook' ? '페이스북' : x}: ${e.msg}` });
  return { body: h.text, report: {
    human: { score: h.score, pass: h.pass, issues: h.issues }, needsPolish: !h.pass, hook: hookText ? scoreHook(hookText, rules, keywords, mode) : null,
    hooks: (i.hooks ?? []).map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 3).map((x) => scoreHook(x, rules, keywords, mode)),
    channel: ch.issues, preview: ch.preview, timing: sc.length >= 2 ? scriptTiming(sc, rules, mode) : null, voice: voiceIssues(h.text, i.voice), keyword: i.mainKeyword ?? null, mode,
  } };
}

// ---------------- 화면 API: 글 품질 검사(저장 없음) ----------------
export const checkInput = z.object({
  channel: z.enum(['instagram', 'facebook', 'threads', 'blog', 'youtube', 'naver_place', 'other']), kind: z.enum(['feed', 'blog', 'reels', 'video', 'shorts', 'story']).nullable().optional(),
  title: z.string().max(300).default(''), body: z.string().max(20000).default(''), hooks: z.array(z.string().max(200)).max(5).optional(), script: z.array(z.string().max(300)).max(20).optional(),
  keyword: z.string().trim().max(40).optional(), brandId: z.string().uuid().nullable().optional(), cross: z.array(z.enum(['instagram', 'facebook', 'threads'])).max(3).optional(), mode: z.enum(['content', 'ad']).optional(),
  ad: z.object({ platform: z.enum(['google', 'naver', 'meta']), headline: z.string().max(200).optional(), description: z.string().max(500).optional(), primary: z.string().max(3000).optional() }).optional(),
});
export async function checkQuality(u: SessionUser, i: z.infer<typeof checkInput>) {
  await assertSpace(u, 'marketing');
  const rules = await qualityRules();
  const [brand] = i.brandId ? await db()<{ name: string; voice: Partial<Voice> }[]>`select name, voice from mkt_brands where id = ${i.brandId} and tenant = ${tenantOf(u)}` : [];
  if (i.brandId && !brand) throw notFound('브랜드를 찾을 수 없습니다');
  const name = String(brand?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
  const r = qualityReport({ channel: i.channel, kind: i.kind ?? null, title: i.title, body: i.body, hooks: i.hooks, script: i.script, keywords: name ? [name] : [], mainKeyword: i.keyword || null, voice: brand?.voice, cross: i.cross, mode: i.mode }, rules);
  const ad = i.ad ? { issues: checkAd(i.ad.platform, i.ad, rules), hook: i.ad.headline ? scoreHook(i.ad.headline, rules, name ? [name] : [], 'ad') : null } : null; // 광고 제목 = 늘 광고형 기준
  return { cleaned: r.body, ...r.report, ad, thresholds: { hook: rules.hook.min, human: rules.human.min } };
}
