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
  youtube: { title: number; titleFront: number; descLines: number }; blog: { titleFront: number; minHeadings: number; keywordPer1000: number; minChars: number };
  ads: { googleHeadline: number; googleDesc: number; naverHeadline: number; naverDesc: number; metaPrimary: number };
};
export const DEFAULT_RULES: QualityRules = {
  hook: { min: 40, maxSec: 3 }, human: { min: 70 }, script: { syllPerMin: 300, sceneMaxSec: 4, maxTotalSec: 60 },
  instagram: { preview: 125, hashtags: 5, cta: 1 }, threads: { max: 500, links: 1 }, facebook: { previewLines: 2, lineChars: 60 },
  youtube: { title: 100, titleFront: 40, descLines: 2 }, blog: { titleFront: 15, minHeadings: 2, keywordPer1000: 6, minChars: 1800 }, // 로컬 QA 10/24 ②: 블로그 1,800자 미만은 승인함에 안 올림
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
  ['blog', 'titleFront', '키워드는 제목 앞', 5, 60, '자'], ['blog', 'minHeadings', '소제목 최소', 0, 10, '개'], ['blog', 'keywordPer1000', '키워드 반복 최대(1000자당)', 1, 50, '회'], ['blog', 'minChars', '본문 최소 글자(승인함 올리기 전)', 300, 5000, '자'],
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
/** 훅 공식(한국어) — AI 가 서로 다른 공식으로 3개를 쓰게 함. 결과·가격·최상급은 재료에 근거가 있을 때만.
 *  로컬 QA 10/24 ④: 예문('다들 ○○라고 하지만, 사실은 △△')을 주면 AI 가 빈칸만 채워 같은 틀이 반복됨 → 문장 틀 없이 '구조'만 설명 */
export const HOOK_FORMULAS: [string, string][] = [
  ['반전', '흔히 믿는 것을 짧게 말하고 바로 뒤집기'], ['숫자', '재료에 있는 숫자 하나(개수·기간·금액)로 시작'], ['숨은 정보', '고객이 모르고 지나치는 사실 하나'], ['실제 결과', '재료에 있는 사례의 전후 변화 한 장면'],
  ['실수', '고객이 자주 하는 실수 하나를 짚기'], ['질문', '고객이 실제로 묻는 질문을 그 사람 말투로'], ['대상 호명', '누구 이야기인지 첫 단어로(직업·상황·단지)'], ['전후 비교', '바뀌기 전과 후를 한 줄에'],
  ['시간', '걸리는 시간·순서를 구체적으로'], ['경고', '하기 전에 확인할 것 하나'], ['이야기', '이번 주 현장에서 있었던 일 한 장면'], ['솔직 고백', '숨기지 않고 털어놓는 한마디'],
  ['오해 깨기', '흔한 오해 하나를 바로잡기'], ['방법', '한 가지 방법을 단계로'], ['진짜 이유', '고객 행동의 숨은 이유'], ['해 봤다', '직접 해 본 기간과 결과'],
  ['현장', '준비·작업 중인 현장 장면'], ['가격·가치', '재료에 있는 실제 가격·혜택'], ['공감', '고객 하루의 구체적인 순간'], ['체크리스트', '확인할 항목 수와 첫 항목'],
  ['비교', '두 선택지를 나란히'], ['손해', '모르면 생기는 구체적인 손해'], ['새 소식', '이번 주에 바뀌는 것'],
];
/** 로컬 QA 10/24 ④: 예문을 그대로 채운 틀 문구('아직도~계신가요?' 5·'다들~하지만 사실은' 4 등) — 훅 탈락·올리기 전 검사에서 막음 */
export const TEMPLATE_PHRASES: [RegExp, string][] = [
  [/아직도\s?[^?\n]{0,40}(?:계신가요|계세요|하시나요|하세요|있나요)\s?\?/, "'아직도 ~ 계신가요?'"],
  [/다들\s?[^\n]{0,40}(?:지만|는데|라는데),?\s?사실/, "'다들 ~지만 사실은'"],
  [/(?:해|봐|가|써|들어|먹어|받아)\s?(?:보신|본)\s?적\s?(?:있으세요|있나요|있으신가요|있으시죠)/, "'~해 본 적 있으세요?'"],
  [/(?:하는|인|이신|하시는)\s?분(?:이라면|들이라면)\s?꼭/, "'~하는 분이라면 꼭'"],
  [/편하게\s?(?:문의|연락|상담)/, "'편하게 문의해 주세요'"],
  [/(?:을|를)\s?소개(?:합니다|해\s?드립니다|해\s?드릴게요|할게요|해요)/, "'~를 소개합니다'"],
];
export const templatesIn = (t: string) => TEMPLATE_PHRASES.filter(([re]) => re.test(t)).map(([, w]) => w);
/** #499-1(테크트리 EP.12·S1): 목적 — 콘텐츠형(참여: 시청 지속·저장·공유·댓글) / 광고형(전환: 리드·문의 단가). 틀과 훅 채점을 따로 */
export type HookMode = 'content' | 'ad';
export const HOOK_MODES: Record<HookMode, string> = { content: '콘텐츠형(참여)', ad: '광고형(전환)' };
export const asMode = (x: unknown): HookMode => (x === 'ad' ? 'ad' : 'content');
export const MODE_GUIDE: Record<HookMode, string> = {
  content: '콘텐츠형(참여): 첫 줄은 질문·공감·이야기로 — 가격·할인·신청 같은 판매 문구로 시작하지 않습니다. 구조: 이야기 → 반전 → 비교 → 자문자답 → 마지막에 행동 1개(저장·댓글 키워드). 성공 기준은 시청 지속·저장·공유·댓글.',
  ad: '광고형(전환): 첫 줄 2초 안에 누구에게(직업·상황·단지를 구체적으로) 무엇을 주는지(무료 진단·체크리스트·제안서·실제 가격) 말합니다. 구조: 지목 → 제안 → 문제 한 줄 → 장점 2~3개 → 행동 1개. 제안·가격·혜택은 재료에 있는 것만. 성공 기준은 리드·문의 단가.',
};
/** AI 지시문에 넣는 훅 안내 */
export const hookGuide = (where: string, mode: HookMode = 'content') => `- hooks: ${where}에 쓸 훅 후보 3개(서로 다른 공식, 30자 안팎). 공식은 구조만 참고합니다(정해진 문장 틀을 베끼거나 빈칸을 채우는 식으로 쓰지 않음): ${HOOK_FORMULAS.map(([n, how]) => `${n}(${how})`).join(' · ')}.
  인사로 시작·"스크롤 멈추세요"류·내용 없는 서두 금지. 이런 틀 문구는 본문 어디에도 쓰지 않습니다: ${TEMPLATE_PHRASES.map(([, w]) => w).join(', ')}. 숫자·결과·가격은 재료에 있는 것만. 가장 좋은 훅을 본문 첫 줄(제목·첫 장면)에 씁니다.
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
  const tpl = templatesIn(text); if (tpl.length) fails.push(`틀 문구(${tpl.join(', ')})`); // 로컬 QA 10/24 ④
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
/** 행동 권유 = 요청형 말끝('…하세요·…해 주세요·남겨 주세요')만 셈 — 같은 묶음은 하나(전화·문의·상담 = 문의, 예약·신청·방문 = 신청·방문), 링크·프로필 안내는 따로 세지 않음.
 *  로컬 QA 10/24 ②: '방문하시면 상담해 드립니다' 같은 안내는 권유가 아님 · 권유 2가지 이상은 승인함에 안 올림(올리기 전 검사) */
const ASK = '(?:하세요|해\\s?주세요|해\\s?보세요|해\\s?두세요|하십시오|해\\s?주시면|주세요|주시면|하러\\s?오세요)';
const CTA_GROUPS: [RegExp, string][] = [
  [new RegExp(`(?:문의|상담|전화|연락|DM|디엠|메시지|톡)\\s?${ASK}|(?:메시지|DM|디엠)[^.!?\\n]{0,10}보내\\s?(?:주세요|보세요)`, 'i'), '문의'],
  [new RegExp(`(?:예약|신청|구매|주문|가입|등록|방문|체험|시작)\\s?${ASK}|(?:놀러|들러)\\s?(?:오세요|주세요)`), '신청·방문'],
  [new RegExp(`저장\\s?${ASK}`), '저장'], [new RegExp(`공유\\s?${ASK}`), '공유'],
  [/댓글[^.!?\n]{0,15}?(?:남겨|달아|써)\s?(?:주세요|보세요)|댓글\s?(?:주세요|부탁)/, '댓글'], [new RegExp(`(?:팔로우|구독)\\s?(?:${ASK}|부탁)`), '팔로우'],
];
export const ctaKinds = (t: string) => CTA_GROUPS.filter(([re]) => re.test(t)).map(([, k]) => k);
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
      const cta = ctaKinds(text.split('\n').filter((l) => !STICKER_LINE.test(l)).join('\n')).length;
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

// ---------------- ⑥ 브랜드 사실 카드(로컬 QA 10/24 ⑤) ----------------
/** 글 안에 직접 쓰는 연락처·운영 시간·요금·써도 되는 숫자(근거와 함께)·섞으면 안 되는 이름 — 카드에 없는 숫자·가격·시간은 쓰지 않음(mkt_brands.facts) */
export const factsInput = z.object({
  phone: z.string().trim().max(40).optional(), link: z.string().trim().max(200).optional(), website: z.string().trim().max(200).optional(), address: z.string().trim().max(200).optional(),
  hours: z.string().trim().max(200).optional(), prices: z.string().trim().max(500).optional(), numbers: z.string().trim().max(1000).optional(),
  avoidNames: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type Facts = z.infer<typeof factsInput>;
/** 저장 값(옛 값·빈 값 포함) → 카드. 형식이 안 맞으면 빈 카드 — 원고 쓰기를 막지 않음 */
export const factsOf = (v: unknown): Facts => { const r = factsInput.safeParse(v ?? {}); return r.success ? r.data : {}; };
const FACT_LABEL: [Exclude<keyof Facts, 'avoidNames'>, string][] = [['phone', '전화'], ['link', '문의·예약 링크'], ['website', '홈페이지'], ['address', '주소'], ['hours', '운영 시간'], ['prices', '요금·가격'], ['numbers', '써도 되는 숫자·근거']];
/** 원고 재료에 넣는 사실 카드 */
export function factsText(f: Facts) {
  const rows = FACT_LABEL.filter(([k]) => String(f[k] ?? '').trim()).map(([k, l]) => `- ${l}: ${String(f[k]).trim()}`);
  return rows.length ? `[사실 카드 — 이 브랜드의 확인된 사실. 숫자·가격·시간은 이 카드와 재료에 있는 값만]\n${rows.join('\n')}` : '';
}
export const hasContacts = (f: Facts) => !!(f.phone || f.link || f.website);
/** 글에 직접 쓸 연락처 한 줄(전화 → 문의 링크 → 홈페이지) */
export const contactLine = (f: Facts) => (f.phone ? `문의 ${f.phone}` : f.link ? `문의 ${f.link}` : f.website ?? '');
const digits = (s: string) => s.replace(/\D/g, '');
const urlKey = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
/** 글에 사실 카드의 연락처(전화 숫자·링크·홈페이지·주소 앞부분)가 있는가 */
export function contactIn(text: string, f: Facts) {
  const p = digits(f.phone ?? ''); if (p.length >= 7 && digits(text).includes(p)) return true;
  const lower = text.toLowerCase();
  for (const u of [f.link, f.website]) { const k = urlKey(u ?? ''); if (k.length >= 4 && lower.includes(k)) return true; }
  const a = (f.address ?? '').replace(/\s/g, ''); return a.length >= 8 && text.replace(/\s/g, '').includes(a.slice(0, 12));
}
const PHONE = /(?:0\d{1,2}|1[5-9]\d{2})[-.\s)]?\d{3,4}[-.\s]?\d{4}/;
const PHONE_ASK = /전화\s?(?:문의|상담|예약)(?!\s?(?:vs|VS|대신|말고|보다|와|과))|전화\s?(?:주세요|부탁)|전화로\s?(?:문의|예약|상담)/;
/** '이미지 참조'·'이미지에 안내된 연락처'처럼 연락처를 그림으로 돌린 말 */
const IMG_CONTACT = /(?:이미지|사진|그림|포스터|썸네일)\s?(?:에|속|의|에서)?\s?(?:안내된|있는|적힌|나온|표시된|담긴)?\s?(?:연락처|전화\s?번호|번호|주소|문의처)|(?:연락처|번호|문의처|주소)[^.\n]{0,10}(?:이미지|사진)\s?(?:참조|참고|확인)|(?:이미지|사진)\s?(?:참조|참고)/;
/** 다른 브랜드·회사 이름(명의) 섞임 — 3자 이상·영문은 그대로, 두 글자 이름(일반 낱말일 수 있음)은 브랜드로 쓰인 자리(서비스·운영·구축·명의…)만 */
const BRAND_CTX = '\\s?(?:의|이|가|은|는|에서|와|과)?\\s?(?:서비스|브랜드|운영|구축|시공|관리|본사|대표|팀|커뮤니티|센터|앱|플랫폼|솔루션|명의|헬스|피트니스)';
export function otherBrandIn(text: string, names: string[], own = ''): string | null {
  const mine = own.replace(/^\s*\[시험\]\s*/, '').trim().toLowerCase();
  for (const raw of names) {
    const n = raw.replace(/^\s*\[시험\]\s*/, '').trim();
    if (!n || (mine && (mine.includes(n.toLowerCase()) || n.toLowerCase().includes(mine)))) continue; // 같은 브랜드의 시험 복사본·겹치는 이름은 빼고
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = /[A-Za-z]/.test(n) ? new RegExp(`(?<![\\w.@-])${esc}(?![\\w.@-])`, 'i') : [...n].length >= 3 ? new RegExp(esc) : new RegExp(`${esc}${BRAND_CTX}`);
    if (re.test(text)) return n;
  }
  return null;
}

// ---------------- ⑦ 올리기 전 자동 검사(로컬 QA 10/24 ②·⑥) ----------------
/** JSON 모양 본문(원고 칸 이름이 섞임) — 본문 첫머리 '[브랜드]' 같은 자리표시는 JSON 이 아님 */
export const JSON_LIKE = /^\s*(?:\{|\[\s*["{[])|"(?:title|body|brief|why|hooks|keyword|card|script)"\s*:/;
/** 스토리의 '스티커 제안:' 줄(투표·질문 스티커 — 그림 글자·권유 수에 넣지 않음) */
export const STICKER_LINE = /^\s*스티커 제안\s*[:：]/;
const CUT_LABEL = /^\s*(?:[[(【]?\s*(?:컷|장면|씬|scene|cut|shot)\s*\d+|#\s?\d+\s|S\d+\s*[:.)\-–])/i;
const STICKER_ANY = /^\s*(?:[[(【]\s*(?:질문\s?|투표\s?|퀴즈\s?)?스티커(?:\s?제안)?\s*[\])】]\s*[:：\-–]?|(?:질문\s?|투표\s?|퀴즈\s?)?스티커(?:\s?제안)?\s*[:：\-–])\s*/; // '[질문 스티커] …'처럼 괄호면 쌍점 없이도
/** AI 가 '스티커:'·'[질문 스티커]' 등으로 쓴 줄을 '스티커 제안: …'으로 맞춤 */
export const normalizeSticker = (body: string) => body.split('\n').map((l) => (STICKER_ANY.test(l) ? `스티커 제안: ${l.replace(STICKER_ANY, '').trim()}` : l)).join('\n');
const normLine = (s: string) => s.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
/** 릴스·쇼츠·영상 원고의 캡션(게시 글)과 컷 대본을 나눔 — AI 가 대본 배열을 줬으면 그 줄과 같은 줄만 캡션에서 빼고(번호 목록은 그대로),
 *  안 줬으면 컷 줄('[컷1] …'·'#1 …'·'1) …')이 2개 이상일 때 대본으로. '대본:'·'캡션:' 머리줄은 뺌 */
export function splitScript(body: string, given: string[] = []): { caption: string; script: string[]; moved: number } {
  const src = body.replace(/\r\n/g, '\n').split('\n');
  const head = /^\s*[[(【]?\s*(?:대본|자막\s?대본|컷\s?구성|스크립트|캡션|게시\s?글)\s*[\])】]?\s*[:：]?\s*$/;
  const g = given.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (g.length >= 2) {
    const keys = g.map(normLine).filter((k) => k.length >= 4);
    const keep = src.filter((l) => { if (head.test(l)) return false; const c = l.match(CUT)?.[1] ?? l; const k = normLine(c); return !(k.length >= 4 && keys.some((x) => x === k || x.includes(k) || k.includes(x))); });
    return { caption: keep.join('\n').replace(/\n{3,}/g, '\n\n').trim(), script: g, moved: src.length - keep.length };
  }
  const cuts = src.filter((l) => CUT.test(l));
  if (cuts.length < 2) return { caption: body.trim(), script: [], moved: 0 };
  const keep = src.filter((l) => !CUT.test(l) && !head.test(l));
  return { caption: keep.join('\n').replace(/\n{3,}/g, '\n\n').trim(), script: scriptLines(cuts.join('\n')), moved: src.length - keep.length };
}
/** 끝이 조사·연결어미·꾸밈말로 끊긴 문장(예: '…관리자라면 꼭', '…주차는 건물 뒤편에', '…문의:') — 명사로 끝나는 안내('24시간 운영')·날짜('31일까지')는 그대로 */
const DANGLING = /(?:[,·:;(\[/\-–—]|(?:^|\s)(?:꼭|가장|바로|더욱|그리고|또는|하지만|그래서|그런데|및)|[가-힣](?:를|은|는|에|에서|에게|으로|라면|하면|해서|하고|하며|하는|있는|없는|위한|통한|통해|대한|같은|좋은|많은))$/;
const URL_END = /(?:https?:\/\/\S+|[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?)$/i;
export type PreflightInput = { channel: string; kind?: string | null; title?: string; body: string; isTest?: boolean; aiLabel?: string | null; facts?: Facts | null; otherBrands?: string[]; brandName?: string | null; script?: string[] | null; cross?: string[] | null };
/** 승인함(승인 대기)에 올리기 전에 막는 문제 — 걸리면 '수정 요청' 칸에 이유와 함께(자동 제작). 사람이 올린 글은 상세에 보여 주기만.
 *  빈 글·한 줄·끊긴 문장·JSON 모양·[시험]·해시태그 초과·권유 2가지 이상·연락처(이미지 참조·사실 카드)·블로그 길이·스토리 형식·릴스/쇼츠 대본·틀 문구·다른 브랜드 이름 */
export function preflight(i: PreflightInput, rules: QualityRules = DEFAULT_RULES): string[] {
  const kind = i.kind ?? null; const story = kind === 'story'; const video = !!kind && VIDEO.has(kind); const blog = i.channel === 'blog' || kind === 'blog';
  let all = String(i.body ?? '').replace(/\r\n/g, '\n');
  if (i.aiLabel) all = all.split(i.aiLabel).join('');
  all = all.trim();
  if (all.replace(/\s/g, '').length < 5) return ['본문이 비었거나 너무 짧음'];
  const out: string[] = [];
  if (JSON_LIKE.test(all)) out.push('본문이 코드(JSON) 모양 — 원고 칸 이름이 섞임');
  if (/\[시험\]/.test(all) || (!i.isTest && /\[시험\]/.test(i.title ?? ''))) out.push("'[시험]' 표시가 섞임");
  const body = lines(all).filter((l) => !/^(?:#[^\s#]+\s*)+$/.test(l) && !STICKER_LINE.test(l)); // 해시태그만 있는 줄·스티커 제안 줄 빼고
  const content = body.join('\n');
  if (!story && !video && !blog && i.channel !== 'threads' && sentences(content).length < 2 && len(content) < 80) out.push('한 줄짜리 글(내용 부족) — 두 문장 이상');
  const last = (body[body.length - 1] ?? '').replace(HASHTAG, '').replace(EMOJI, '').replace(/[\s"'”’」』)]+$/, '');
  if (last && !URL_END.test(last) && DANGLING.test(last)) out.push(`끝 문장이 끊김('…${[...last].slice(-12).join('')}')`);
  const social = ['instagram', 'facebook', 'threads']; const tags = (all.match(HASHTAG) ?? []).length;
  if ((social.includes(i.channel) || (i.cross ?? []).some((c) => social.includes(c))) && tags > rules.instagram.hashtags) out.push(`해시태그 ${tags}개 — ${rules.instagram.hashtags}개까지`);
  if (!blog) { const k = ctaKinds(content); if (k.length > rules.instagram.cta) out.push(`권유 ${k.length}가지(${k.join('·')}) — 글 한 편에 행동 하나`); }
  const f = i.facts ?? {};
  if (IMG_CONTACT.test(all)) out.push("연락처를 '이미지 참조'로 돌림 — 글 안에 직접");
  else if (!story && i.channel !== 'threads' && hasContacts(f) && !contactIn(all, f)) out.push(`연락처 없음 — 사실 카드의 ${f.phone ? '전화' : f.link ? '문의 링크' : '홈페이지'}를 글 안에 직접`);
  else if (PHONE_ASK.test(content) && !PHONE.test(all) && !contactIn(all, f)) out.push("'전화 문의'인데 번호가 없음"); // 스티커 제안 줄(투표·질문)·'전화 예약 vs 앱 예약' 같은 비교는 권유가 아님
  if (blog) { const n = len(content.replace(/\n/g, '')); if (n < rules.blog.minChars) out.push(`블로그 본문 ${n.toLocaleString('ko-KR')}자 — ${rules.blog.minChars.toLocaleString('ko-KR')}자 이상`); }
  if (story) { if (body.length > 2) out.push(`스토리 문구 ${body.length}줄 — 1~2줄`); if (!all.split('\n').some((l) => STICKER_LINE.test(l))) out.push("스토리 '스티커 제안:' 줄 없음"); }
  if (video) {
    const cuts = (i.script ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
    // 컷 이름표('[컷1]'·'장면 2:'·'#3 '·'S4')가 붙은 줄이나 대본과 같은 줄이 캡션에 2줄 이상 — 그냥 번호 목록('1. …')은 캡션 내용일 수 있어 대본 줄과 같을 때만
    const keys = cuts.map(normLine).filter((k) => k.length >= 4);
    if (lines(all).filter((l) => CUT_LABEL.test(l) || (CUT.test(l) && keys.includes(normLine(l.match(CUT)?.[1] ?? l)))).length >= 2) out.push('캡션에 컷 대본이 섞임 — 대본은 대본 칸에');
    if (cuts.length < 2) out.push('대본(컷) 없음');
    else { const first = scriptTiming(cuts.slice(0, 1), rules).rows[0]; if (first && first.sec > rules.hook.maxSec + 1) out.push(`첫 컷 대사 ${first.sec}초 — ${rules.hook.maxSec}초(15음절 안팎) 안으로`); } // QA: 첫 문장 6·7초
  }
  const tp = templatesIn(all); if (tp.length) out.push(`틀 문구 그대로: ${tp.join(', ')}`);
  const ob = otherBrandIn(blog ? `${i.title ?? ''}\n${all}` : all, [...(i.otherBrands ?? []), ...(f.avoidNames ?? [])], i.brandName ?? ''); if (ob) out.push(`다른 브랜드·회사 이름('${ob}')이 섞임`);
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
  preflight?: string[]; // 로컬 QA 10/24 ②: 올리기 전 검사에 걸린 것(자동 제작 글은 이게 있으면 승인함 대신 '수정 요청')
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
  const [brand] = i.brandId ? await db()<{ name: string; voice: Partial<Voice>; facts: unknown }[]>`select name, voice, facts from mkt_brands where id = ${i.brandId} and tenant = ${tenantOf(u)}` : [];
  if (i.brandId && !brand) throw notFound('브랜드를 찾을 수 없습니다');
  const name = String(brand?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
  const r = qualityReport({ channel: i.channel, kind: i.kind ?? null, title: i.title, body: i.body, hooks: i.hooks, script: i.script, keywords: name ? [name] : [], mainKeyword: i.keyword || null, voice: brand?.voice, cross: i.cross, mode: i.mode }, rules);
  const ad = i.ad ? { issues: checkAd(i.ad.platform, i.ad, rules), hook: i.ad.headline ? scoreHook(i.ad.headline, rules, name ? [name] : [], 'ad') : null } : null; // 광고 제목 = 늘 광고형 기준
  const others = i.brandId ? (await db()<{ name: string }[]>`select name from mkt_brands where tenant = ${tenantOf(u)} and id <> ${i.brandId}`).map((b) => b.name) : [];
  const pre = i.body.trim() ? preflight({ channel: i.channel, kind: i.kind ?? null, title: i.title, body: r.body, facts: factsOf(brand?.facts), otherBrands: others, brandName: name, script: i.script ?? null, cross: i.cross ?? null }, rules) : [];
  return { cleaned: r.body, ...r.report, preflight: pre, ad, thresholds: { hook: rules.hook.min, human: rules.human.min } };
}
