import { z } from 'zod';
import * as D from './mktCarouselDraw';

/**
 * #544(대표 10/24 '바디랩 표지가 다 똑같다 · 바탕 글자 위에 또 글자 · 브랜드별 레퍼런스와 비교해 개선한 뒤 승인 다시'): 서버가 그리는 자동 시안의 '피드 틀'.
 * 브랜드 키트에서 고른 틀(3~4종)을 돌려 쓰고 — 최근 3개 게시물과 같은 틀·같은 사진은 쓰지 않음 — 색·머리줄·연락처 줄·시리즈 머리말은 키트 값.
 * 근거: docs/handoff/BRAND_FEED_REFERENCE_2026-10-24.md 4번 표(남의 피드에서는 구성·흐름만 — 그림·문구·로고·색은 쓰지 않음). 회사·브랜드 이름과 색은 코드에 넣지 않는다.
 * 그리기: 사진·그러데이션·휴대폰 틀은 sharp, 글자·도형 층은 next/og(satori) — 카드뉴스(#499-5)와 같은 글꼴·낱말 줄바꿈.
 * 사진 틀은 자료실 '마케팅/시안 바탕(글자 없는 사진)'(또는 태그 '글자없음') 사진만 — 글자 든 그림 위에 글자를 얹지 않는다.
 */
type Need = 'photo' | 'photos4' | 'screen' | 'screen_wide' | 'points' | 'compare' | 'prices' | null;
export const FEED_TEMPLATES = {
  title: { label: '제목형', desc: '바탕 색 + 포인트 색 머리말 + 큰 제목', need: null },
  list: { label: '번호 목록형', desc: '제목 + 01~05 핵심 목록', need: 'points' },
  photo_fade: { label: '사진 + 아래 그러데이션', desc: '글자 없는 실사 + 아래쪽 바탕 색 그러데이션 + 제목', need: 'photo' },
  photo_dim: { label: '사진 덧칠형', desc: '실사 + 어두운 덧칠 + 가운데 제목', need: 'photo' },
  photo_caption: { label: '사진 + 작은 제목', desc: '실사를 가리지 않게 아래 한 줄 제목', need: 'photo' },
  grid4: { label: '사진 4분할', desc: '실사 4장 + 이름표 + 위 제목', need: 'photos4' },
  phone: { label: '휴대폰 화면형', desc: '휴대폰 틀 안에 실제 화면 캡처 + 제목', need: 'screen' },
  laptop: { label: '노트북 화면형', desc: '노트북 틀 안에 PC 화면 캡처(가로) + 제목', need: 'screen_wide' }, // #262(대표 10/25 ④)
  vs: { label: 'VS 비교형', desc: '두 칸 비교 + 가운데 VS + 아래 로고', need: 'compare' },
  poster: { label: '이벤트 포스터', desc: '강한 색 세트 + 아주 큰 제목 + 혜택 + 기간·연락처', need: null },
  price: { label: '가격 카드', desc: '제목 + 기간·금액 칸(재료에 있는 금액만)', need: 'prices' },
  statement: { label: '큰 글씨 강조형', desc: '짙은 바탕 + 큰 문장 + 핵심어 동그라미', need: null },
  report: { label: '리포트 표지형', desc: '시리즈 머리말 + 큰 제목 + 아래 한 줄', need: null },
} as const satisfies Record<string, { label: string; desc: string; need: Need }>;
export type TemplateId = keyof typeof FEED_TEMPLATES;
export const TEMPLATE_IDS = Object.keys(FEED_TEMPLATES) as [TemplateId, ...TemplateId[]];
export const NEED_LABEL: Record<Exclude<Need, null>, string> = {
  photo: "사진 필요 — 자료실 '마케팅/시안 바탕(글자 없는 사진)' 폴더", photos4: '시안 바탕 사진 4장 이상', screen: "화면 캡처 필요 — 자료실 '영상 화면 캡처' 폴더", screen_wide: "PC 화면 캡처(가로) 필요 — 자료실 '영상 화면 캡처' 폴더",
  points: '글에 핵심 3개 이상일 때', compare: '글이 두 가지를 견줄 때', prices: '브랜드 키트 재료(주력 상품)에 금액이 2개 이상 있을 때',
};
/** 브랜드 성격별 묶음(레퍼런스 문서 4번 표의 브랜드별 틀을 업종 중립 이름으로) — 고른 뒤 틀을 하나씩 켜고 끌 수 있음 */
export const FEED_STYLES = {
  trust: { label: '신뢰형 — 진한 바탕·포인트 색·실사', templates: ['title', 'list', 'photo_fade', 'grid4'] },
  tech: { label: '기술·앱형 — 휴대폰 화면·실사 덧칠·비교', templates: ['phone', 'laptop', 'photo_dim', 'vs', 'list'] },
  event: { label: '매장 이벤트형 — 강한 색 포스터·가격·사진', templates: ['poster', 'price', 'photo_caption'] },
  product: { label: '제품 화면형 — 화면 카드·큰 글씨·리포트', templates: ['phone', 'laptop', 'statement', 'report'] },
} as const satisfies Record<string, { label: string; templates: readonly TemplateId[] }>;
export type StyleId = keyof typeof FEED_STYLES;
/** 이벤트 포스터·가격 카드(매장 이벤트형) 색 세트 — 게시물마다 돌려 씀(바탕·글자·혜택 띠) */
export const EVENT_SETS = [
  { bg: '#1D4ED8', fg: '#FFFFFF', accent: '#FACC15' }, { bg: '#EC4899', fg: '#FFFFFF', accent: '#FFFFFF' },
  { bg: '#DC2626', fg: '#FFFFFF', accent: '#111111' }, { bg: '#FACC15', fg: '#111111', accent: '#111111' },
] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const feedInput = z.object({
  style: z.enum(Object.keys(FEED_STYLES) as [StyleId, ...StyleId[]]).nullable().optional(),
  templates: z.array(z.enum(TEMPLATE_IDS)).max(TEMPLATE_IDS.length).optional(),
  palette: z.object({ bg: hex.nullable().optional(), bg2: hex.nullable().optional(), accent: hex.nullable().optional(), text: hex.nullable().optional() }).optional(),
  header: z.string().trim().max(40).nullable().optional(), contact: z.string().trim().max(80).nullable().optional(), kicker: z.string().trim().max(16).nullable().optional(),
});
export type FeedStored = z.infer<typeof feedInput>;
/** 저장 값 정리: 틀은 중복 없이 카탈로그 순서로, 빈 글자는 뺌 */
export function normalizeFeed(i: FeedStored): FeedStored {
  const templates = TEMPLATE_IDS.filter((t) => (i.templates ?? []).includes(t));
  const palette = Object.fromEntries(Object.entries(i.palette ?? {}).filter(([, v]) => !!v).map(([k, v]) => [k, String(v).toUpperCase()]));
  return { style: i.style ?? null, templates, palette, header: i.header || null, contact: i.contact || null, kicker: i.kicker || null };
}

export type Kit = { style: StyleId | null; templates: TemplateId[]; bg: string; bg2: string; accent: string; text: string; header: string; contact: string; kicker: string; from: D.ColorFrom | null };
const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export const mix = (a: string, b: string, t: number) => `#${rgb(a).map((x, i) => Math.round(x + (rgb(b)[i] - x) * t).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const rgba = (c: string, a: number) => `rgba(${rgb(c).join(',')},${a})`;
const dark = (c: string) => D.lum(c) < 0.45;
const on = (c: string) => (dark(c) ? '#FFFFFF' : '#111111');
const contrast = (a: string, b: string) => { const [x, y] = [D.lum(a), D.lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** 글자로 쓰는 포인트 색(머리말·번호·강조 테두리): 바탕과 대비 3:1(큰 글자 기준)이 안 되면 밝게/어둡게 — 남색 바탕에 파란 포인트 같은 경우 */
export const ink = (c: string, bg: string) => { let x = c; for (let i = 0; i < 8 && contrast(x, bg) < 3; i++) x = mix(x, dark(bg) ? '#FFFFFF' : '#000000', 0.2); return x; };
/** 키트 값 + 기본값: 바탕 = 피드 틀 → 영상 끝 화면 → 브랜드 색 → 회사 기본 색(brandColorInfo) · 보조·포인트·글자는 바탕에서 */
export function kitOf(feed: FeedStored | null | undefined, color: { color: string | null; from: D.ColorFrom | null }, brand: string): Kit {
  const p = feed?.palette ?? {};
  const bg = color.color ?? '#1E293B'; const dk = dark(bg);
  const templates = TEMPLATE_IDS.filter((t) => (feed?.templates ?? []).includes(t));
  return { style: (feed?.style as StyleId) ?? null, templates, bg, bg2: D.okColor(p.bg2) ?? mix(bg, dk ? '#FFFFFF' : '#000000', dk ? 0.12 : 0.16),
    accent: D.okColor(p.accent) ?? mix(bg, dk ? '#FFFFFF' : '#000000', dk ? 0.62 : 0.55), text: D.okColor(p.text) ?? (dk ? '#FFFFFF' : '#111827'),
    header: (feed?.header ?? '').trim() || brand, contact: (feed?.contact ?? '').trim(), kicker: (feed?.kicker ?? '').trim(), from: color.from };
}

/** AI 가 원고와 함께 낸 시안 칸(#544) — 금액·기간은 재료에 있는 숫자만 남김 */
export type FeedCard = { kicker?: string; points?: string[]; left?: string; right?: string; keyword?: string; period?: string; prices?: { label: string; value: string }[] };
export const CARD_FORMAT = { type: 'object', additionalProperties: false, required: ['kicker', 'kickerAlts', 'points', 'left', 'right', 'keyword', 'period', 'prices'],
  properties: { kicker: { type: 'string' }, kickerAlts: { type: 'array', items: { type: 'string' } }, points: { type: 'array', items: { type: 'string' } }, left: { type: 'string' }, right: { type: 'string' }, keyword: { type: 'string' }, period: { type: 'string' },
    prices: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'value'], properties: { label: { type: 'string' }, value: { type: 'string' } } } } } } as const;
export const CARD_GUIDE = "- card: 시안 그림 칸(짧게) — kicker(표지 위 작은 머리말 2~8자 — 이 글 내용을 한마디로, 글마다 다르게), kickerAlts(다른 머리말 후보 2개), points(본문 핵심 3~5개, 각 18자 안, 번호·기호 없이), left·right(글이 두 가지를 견줄 때만 각 10자 안 — 아니면 빈 문자열), keyword(첫 줄에서 강조할 낱말 하나), period(재료에 기간이 있을 때만 '10/1~10/31' 꼴 — 없으면 빈 문자열), prices(재료에 있는 가격만 {label:'3개월', value:'19만원'} — 없으면 빈 배열).";
const cut = (s: unknown, n: number) => { const a = [...String(s ?? '').replace(/\s+/g, ' ').trim()]; return a.length <= n ? a.join('') : `${a.slice(0, n - 1).join('').trim()}…`; };
const nums = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).map((x) => x.replace(/[,.]/g, ''));
export function cardFrom(o: any, material: string): FeedCard | undefined {
  if (!o || typeof o !== 'object') return undefined;
  const have = new Set(nums(material));
  const inMaterial = (s: string) => nums(s).length > 0 && nums(s).every((n) => have.has(n));
  return { kicker: cut(o.kicker, 10), points: (Array.isArray(o.points) ? o.points : []).map((x: unknown) => cut(x, 22)).filter(Boolean).slice(0, 5), left: cut(o.left, 14), right: cut(o.right, 14), keyword: cut(o.keyword, 12),
    period: o.period && inMaterial(String(o.period)) ? cut(o.period, 24) : '',
    prices: (Array.isArray(o.prices) ? o.prices : []).filter((p: any) => p?.label && p?.value && inMaterial(String(p.value))).map((p: any) => ({ label: cut(p.label, 10), value: cut(p.value, 12) })).slice(0, 4) };
}

/** 187차 ⑤ 머리말 비교용(띄어쓰기·문장부호·대소문자 무시) */
export const kickerKey = (s: unknown) => String(s ?? '').replace(/[\s·.,!?~'"‘’“”()\[\]「」『』<>《》-]/g, '').toLowerCase();
/** 187차 ⑤(대표 '표지 머리말이 다 같다'): 브랜드 키트 머리말을 채웠으면 그 값으로 고정(AI 머리말은 비움 — 그림은 키트 값),
 *  비웠으면 AI 머리말 → 게시 시각이 가까운 같은 브랜드 글 머리말과 겹치면 후보(kickerAlts)에서 → 다 겹치면 비움(같은 머리말을 또 쓰지 않음) */
export function pickKicker(card: FeedCard | undefined, alts: unknown, near: string[], fixed: string): FeedCard | undefined {
  if (!card) return card;
  if (fixed.trim()) return { ...card, kicker: '' };
  const used = new Set(near.map(kickerKey).filter(Boolean));
  const cands = [card.kicker, ...(Array.isArray(alts) ? alts : [])].map((x) => cut(x, 10)).filter((x) => kickerKey(x).length >= 2);
  return { ...card, kicker: cands.find((k) => !used.has(kickerKey(k))) ?? '' };
}

export type Hints = { head: string; sub: string; kicker: string; points: string[]; left: string; right: string; keyword: string; period: string; prices: { label: string; value: string }[] };
const BULLET = /^\s*(?:\d{1,2}[.)]|0\d\b|[①-⑩]|[-•·▶■□✔✓☑]|[✅🔹🔸▪◆])\s*/u;
/** 그림에 넣을 칸: AI 칸(card) 먼저, 없으면 글에서(목록 줄·'3개월 19만원'·'10/1~10/31'·'A vs B') */
export function hintsOf(o: { head: string; sub: string; title: string; body: string; card?: FeedCard | null; kit: Kit }): Hints {
  const c = o.card ?? {};
  const lines = o.body.split('\n').map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => BULLET.test(l)).map((l) => cut(l.replace(BULLET, '').replace(/#[^\s#]+/g, ''), 22)).filter((l) => [...l].length >= 2);
  const points = (c.points?.length ?? 0) >= 3 ? c.points! : bullets.length >= 3 ? bullets.slice(0, 5) : c.points ?? [];
  const priceRe = /(\d{1,2}\s*(?:개월|회|주|일권)|1일|일일권)\s*[:：·]?\s*(?:월\s*)?(\d[\d,]*\s*(?:만\s*)?원)/g;
  const found = [...o.body.matchAll(priceRe)].map((m) => ({ label: m[1].replace(/\s+/g, ''), value: m[2].replace(/\s+/g, '') }));
  const prices = (c.prices?.length ?? 0) >= 2 ? c.prices! : found.length >= 2 ? found.slice(0, 4) : [];
  const period = c.period || (o.body.match(/\d{1,2}\s*[./월]\s*\d{1,2}\s*일?\s*(?:\([^)]{1,3}\))?\s*[~∼–-]\s*(?:\d{1,2}\s*[./월]\s*)?\d{1,2}\s*일?/)?.[0] ?? '').replace(/\s+/g, '');
  const vs = `${o.title} ${o.head}`.match(/([^\s,.?!]{1,10}(?:\s[^\s,.?!]{1,8})?)\s*(?:vs\.?|VS|대신)\s*([^\s,.?!]{1,10}(?:\s[^\s,.?!]{1,8})?)/);
  const words = o.head.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => [...w].length >= 2);
  const keyword = c.keyword && o.head.includes(c.keyword) ? c.keyword : words.sort((a, b) => [...b].length - [...a].length)[0] ?? '';
  return { head: o.head, sub: o.sub, kicker: o.kit.kicker || c.kicker || '', points, left: c.left || vs?.[1] || '', right: c.right || vs?.[2] || '', keyword, period: cut(period, 24), prices };
}

export const usesPhoto = (t: string) => ['photo', 'photos4'].includes(String(FEED_TEMPLATES[t as TemplateId]?.need ?? ''));
export type Assets = { photo: boolean; photos: number; screen: boolean; screenWide?: boolean };
export function eligible(t: TemplateId, h: Hints, a: Assets) {
  const need = FEED_TEMPLATES[t].need as Need;
  return need === null || (need === 'photo' && a.photo) || (need === 'photos4' && a.photos >= 4) || (need === 'screen' && a.screen) || (need === 'screen_wide' && !!a.screenWide) || (need === 'points' && h.points.length >= 3)
    || (need === 'compare' && !!h.left && !!h.right) || (need === 'prices' && h.prices.length >= 2);
}
export const hash = (s: string) => { let x = 2166136261; for (const ch of s) { x ^= ch.codePointAt(0)!; x = Math.imul(x, 16777619) >>> 0; } return x; };
/** 틀 고르기: 최근 3개(게시 시각이 가까운 같은 브랜드 글)에 쓴 틀은 빼고, 최근 12개에서 덜 쓴 틀 먼저 · prefer = 그 틀 그대로(글만 고친 수정본) · avoid = 다른 틀로 다시 그리기 */
export function chooseTemplate(pool: TemplateId[], o: { near: (string | null)[]; usage: Record<string, number>; seed: string; prefer?: string | null; avoid?: string | null }): TemplateId | null {
  if (!pool.length) return null;
  if (o.prefer && pool.includes(o.prefer as TemplateId) && o.prefer !== o.avoid) return o.prefer as TemplateId;
  const keep = pool.filter((t) => t !== o.avoid); const fresh = keep.filter((t) => !o.near.includes(t));
  const cands = fresh.length ? fresh : keep.length ? keep : pool;
  return [...cands].sort((a, b) => (o.usage[a] ?? 0) - (o.usage[b] ?? 0) || hash(o.seed + a) - hash(o.seed + b))[0];
}
/** 자료실 사진 이름 → 4분할 이름표(카메라 파일 이름·숫자만이면 비움) */
export const labelOf = (title: string) => { const t = title.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim(); return /^(img|dsc|kakaotalk|photo|사진|image)[\s_-]*\d/i.test(t) || /^\d[\d\s_-]*$/.test(t) ? '' : cut(t, 10); };

// ---------------- 그리기 ----------------
const W = 1080;
/** 안전 영역: 스토리(9:16)는 위 진행 막대·프로필 자리, 아래 24% 비움(답장 칸) · 블로그 대표 이미지는 정사각 */
const boxOf = (H: number) => (H >= 1900 ? { top: 210, bottom: Math.round(H * 0.24) + 24, pad: 80 } : H <= 1100 ? { top: 60, bottom: 60, pad: 72 } : { top: 72, bottom: 76, pad: 80 });
/** 실제 글꼴 폭(Noto Sans KR, em) — 줄 수를 그림과 같게 센다(로컬 10/24 '사진 덧칠형 제목 4줄 + 작은 글 겹침': 글자 수 어림으로는 3줄인데 그리면 4줄) */
type Meter = (s: string, bold: boolean) => number;
let meterP: Promise<Meter> | null = null;
function meter(): Promise<Meter> {
  meterP ??= (async () => {
    const f = await D.fonts(); const m: any = await import('@pdf-lib/fontkit'); const fk = m.default ?? m;
    const fb = fk.create(f.bold), fr = fk.create(f.reg);
    return (s: string, bold: boolean) => { const font = bold ? fb : fr; return font.layout(s).advanceWidth / font.unitsPerEm; };
  })().catch((e) => { meterP = null; throw e; });
  return meterP;
}
export type FitOpts = { bold?: boolean; ls?: number; mark?: string; spill?: boolean };
/** rows() 와 같은 낱말 줄바꿈(낱말 칸 + 칸 사이 0.26em, 넘치면 다음 줄)으로 몇 줄이 되는지 — 한 낱말이 한 줄보다 길면 Infinity(keep-all 이라 넘침) */
function wrapCount(M: Meter, s: string, size: number, width: number, o: FitOpts) {
  const gap = Math.round(size * 0.26); const ls = o.ls ?? -Math.round(size * 0.025); let n = 0;
  for (const l of s.split('\n').map((x) => x.trim()).filter(Boolean)) {
    let cur = -1; n++;
    for (const w of l.split(/\s+/)) {
      const ww = (M(w, o.bold ?? true) * size + ls * [...w].length + (o.mark && w.includes(o.mark) ? size * 0.56 : 0)) * 1.03; // 3% 여유(글꼴 차이)
      if (ww > width) return Infinity;
      if (cur < 0) cur = ww; else if (cur + gap + ww <= width) cur += gap + ww; else { n++; cur = ww; }
    }
  }
  return Math.max(1, n);
}
export type Fitted = { text: string; size: number; lines: number };
/** 줄 수 안에 드는 가장 큰 글자 크기 — 안 되면 ① 최소 크기의 85%까지 줄여 보고 ② (spill) 한 줄 더 쓰고(틀이 아래 칸을 그만큼 내림)
 *  ③ 그래도 넘치면 낱말 단위로 잘라 '…'. 줄바꿈(\n)이 있으면 푼 글도 시험 — 정해 둔 줄 수를 넘겨 아래 글·사진과 겹치는 일이 없게 */
export function fitTo(M: Meter, s: string, width: number, lines: number, max: number, min: number, o: FitOpts = {}): Fitted {
  const down = (a: number, b: number) => { const r: number[] = []; for (let z = a; z > b; z -= 2) r.push(z); return r.concat(b); };
  const tryAt = (t: string, n: number, sizes: number[]) => { for (const z of sizes) { const k = wrapCount(M, t, z, width, o); if (k <= n) return { text: t, size: z, lines: k }; } return null; };
  const flat = s.replace(/\s*\n\s*/g, ' ').trim();
  const texts = flat !== s ? [s, flat] : [s];
  for (const t of texts) { const r = tryAt(t, lines, down(max, Math.max(12, Math.floor(min * 0.85)))); if (r) return r; }
  if (o.spill !== false) for (const t of texts) { const r = tryAt(t, lines + 1, down(max, min)); if (r) return r; }
  const n = o.spill !== false ? lines + 1 : lines; const words = flat.split(/\s+/);
  for (let k = words.length - 1; k >= 1; k--) {
    const t = `${words.slice(0, k).join(' ').replace(/[\s,.·…]+$/, '')}…`; const c = wrapCount(M, t, min, width, o);
    if (c <= n) return { text: t, size: min, lines: c };
  }
  return { text: cut(flat, 6), size: min, lines: 1 };
}
const svg = (w: number, h: number, inner: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${inner}</svg>`);
const vgrad = (w: number, h: number, stops: [number, string, number][]) => svg(w, h, `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`);
const fill = (w: number, h: number, c: string, a = 1, r = 0) => svg(w, h, `<rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${c}" fill-opacity="${a}"/>`);
async function cover(buf: Buffer, w: number, h: number, r = 0) {
  const sharp = (await import('sharp')).default;
  const img = await sharp(buf).rotate().resize(w, h, { fit: 'cover' }).ensureAlpha().png().toBuffer();
  return r ? sharp(img).composite([{ input: svg(w, h, `<rect width="${w}" height="${h}" rx="${r}" ry="${r}"/>`), blend: 'dest-in' }]).png().toBuffer() : img;
}
/** 휴대폰 틀 안 화면: 세로 캡처는 폭에 맞추고 위에서부터(양옆 메뉴·글자가 잘리지 않게, 아래가 남으면 캡처 맨 아래 색) — 가로 캡처만 가운데 잘라 채움 */
async function screenFit(buf: Buffer, w: number, h: number, r: number) {
  const sharp = (await import('sharp')).default;
  const m = await sharp(buf).metadata(); const [iw, ih] = (m.orientation ?? 1) >= 5 ? [m.height ?? 0, m.width ?? 0] : [m.width ?? 0, m.height ?? 0];
  if (!iw || !ih || iw / ih > 0.75) return cover(buf, w, h, r);
  const img = await sharp(buf).rotate().resize({ width: w }).ensureAlpha().png().toBuffer();
  const rh = (await sharp(img).metadata()).height ?? h;
  let fitted: Buffer;
  if (rh >= h) fitted = await sharp(img).extract({ left: 0, top: 0, width: w, height: h }).png().toBuffer();
  else {
    const [cr, cg, cb] = await sharp(img).extract({ left: 0, top: rh - 1, width: w, height: 1 }).resize(1, 1).raw().toBuffer();
    fitted = await sharp({ create: { width: w, height: h, channels: 4, background: { r: cr, g: cg, b: cb, alpha: 1 } } }).composite([{ input: img, left: 0, top: 0 }]).png().toBuffer();
  }
  return sharp(fitted).composite([{ input: svg(w, h, `<rect width="${w}" height="${h}" rx="${r}" ry="${r}"/>`), blend: 'dest-in' }]).png().toBuffer();
}
type Logo = { src: string; w: number; h: number; lum: number };
async function logoOf(buf: Buffer): Promise<Logo> {
  const sharp = (await import('sharp')).default;
  const u = await D.logoUri(buf);
  const { data } = await sharp(buf, { density: 150 }).resize(48, 48, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) { sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255; n++; }
  return { ...u, lum: n ? sum / n : 0.5 };
}

export type RenderIn = { t: TemplateId; kit: Kit; brand: string; H: number; h: Hints; photo: Buffer | null; photos: { data: Buffer; label: string }[]; screen: Buffer | null; screenWide?: Buffer | null; logo: Buffer | null; font: Buffer | null; set?: { bg: string; fg: string; accent: string } };
type X = RenderIn & { logoEl: Logo | null; b: ReturnType<typeof boxOf>; width: number; set: { bg: string; fg: string; accent: string }; fitT: (s: string, width: number, lines: number, max: number, min: number, o?: FitOpts) => Fitted };
type Spec = { bg: string; layers: { input: Buffer; left: number; top: number }[]; el: (fam: string) => D.El };
const { h } = D;
const abs = (style: Record<string, unknown>, kids: unknown) => h({ position: 'absolute', ...style }, kids);
const root = (H: number, kids: unknown[]) => h({ position: 'relative', width: W, height: H, fontFamily: 'Noto Sans KR', overflow: 'hidden' }, kids.filter(Boolean));
/** 낱말 줄바꿈(카드뉴스와 같음) + mark = 그 낱말에 동그라미(큰 글씨 강조형) */
const rows = (s: string, size: number, o: { center?: boolean; mark?: string; markColor?: string } = {}) => s.split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => h({ width: '100%', flexWrap: 'wrap', justifyContent: o.center ? 'center' : 'flex-start', columnGap: Math.round(size * 0.26) }, l.split(/\s+/).map((w) => (o.mark && w.includes(o.mark)
    ? h({ border: `${Math.max(4, Math.round(size * 0.055))}px solid ${o.markColor}`, borderRadius: 9999, padding: `0 ${Math.round(size * 0.22)}px` }, w) : h({}, w)))));
const titleEl = (s: string, size: number, color: string, fam: string, o: { center?: boolean; mark?: string; markColor?: string; lh?: number } = {}) =>
  h({ flexDirection: 'column', alignItems: o.center ? 'center' : 'flex-start', fontFamily: fam, fontWeight: 700, fontSize: size, lineHeight: o.lh ?? 1.2, letterSpacing: -Math.round(size * 0.025), color, wordBreak: 'keep-all', textAlign: o.center ? 'center' : 'left' }, rows(s, size, o));
const subEl = (s: string, size: number, color: string, o: { center?: boolean; mt?: number } = {}) => (s ? h({ flexDirection: 'column', alignItems: o.center ? 'center' : 'flex-start', marginTop: o.mt ?? 28, fontSize: size, fontWeight: 400, lineHeight: 1.5, color, wordBreak: 'keep-all', textAlign: o.center ? 'center' : 'left' }, rows(s, size, o)) : null);
const kickerEl = (s: string, color: string, o: { center?: boolean; size?: number } = {}) => (s ? h({ alignItems: 'center', justifyContent: o.center ? 'center' : 'flex-start', columnGap: 14, marginBottom: 26 }, [h({ width: 40, height: 6, borderRadius: 3, background: color }, ''), h({ fontSize: o.size ?? 32, fontWeight: 700, color, letterSpacing: 1 }, s)]) : null);
/** 머리줄(왼쪽 위): 키트 로고(어두운 로고를 어두운 바탕에 놓을 때는 흰 받침) + 머리줄 글자 */
function headerEl(x: X, color: string, bgDark: boolean, o: { size?: number } = {}) {
  const L = x.logoEl; const kids: unknown[] = [];
  if (L) {
    const s = Math.min(1, 52 / L.h); const im = D.img(L.src, Math.round(L.w * s), Math.round(L.h * s), { objectFit: 'contain' });
    const plate = bgDark && L.lum < 0.45 ? '#FFFFFF' : !bgDark && L.lum > 0.78 ? '#111111' : null;
    kids.push(plate ? h({ background: plate, borderRadius: 12, padding: '8px 14px' }, [im]) : im);
  }
  if (x.kit.header && (!L || x.kit.header !== x.brand)) kids.push(h({ fontSize: o.size ?? 28, fontWeight: 700, letterSpacing: 0.5, color }, x.kit.header));
  return h({ alignItems: 'center', columnGap: 16 }, kids);
}
const headerAt = (x: X, color: string, bgDark: boolean) => abs({ left: x.b.pad, top: x.b.top }, [headerEl(x, color, bgDark)]);
const contactEl = (x: X, color: string, width = x.width, o: { center?: boolean; weight?: number } = {}) => {
  if (!x.kit.contact) return null;
  const c = x.fitT(x.kit.contact, width, 1, 30, 20, { bold: o.weight === 700, ls: 0, spill: false });
  return h({ fontSize: c.size, fontWeight: o.weight ?? 400, color, justifyContent: o.center ? 'center' : 'flex-start', width }, c.text);
};
const contactAt = (x: X, color: string) => (x.kit.contact ? abs({ left: x.b.pad, right: x.b.pad, bottom: x.b.bottom, flexDirection: 'column' }, [h({ height: 2, background: rgba(color, 0.28), marginBottom: 22 }, ''), contactEl(x, rgba(color, 0.9))]) : null);

const DRAW: Record<TemplateId, (x: X) => Promise<Spec>> = {
  async title(x) {
    const { kit } = x; const T = x.fitT(x.h.head, x.width, 3, x.H >= 1900 ? 120 : 108, 62);
    return { bg: kit.bg, layers: [], el: (fam) => root(x.H, [headerAt(x, kit.text, dark(kit.bg)),
      abs({ left: x.b.pad, right: x.b.pad, top: x.b.top + 110, bottom: x.b.bottom + (kit.contact ? 110 : 40), flexDirection: 'column', justifyContent: 'center' }, [
        kickerEl(x.h.kicker, ink(kit.accent, kit.bg)), titleEl(T.text, T.size, kit.text, fam), subEl(x.h.sub, 38, rgba(kit.text, 0.8), { mt: 34 })].filter(Boolean)),
      contactAt(x, kit.text)]) };
  },
  async list(x) {
    const { kit } = x; const pts = x.h.points.slice(0, 5); const T = x.fitT(x.h.head, x.width, 2, 80, 50); const rs = x.H <= 1100 ? 32 : pts.length > 4 ? 35 : 38;
    return { bg: kit.bg, layers: [], el: (fam) => root(x.H, [headerAt(x, kit.text, dark(kit.bg)),
      abs({ left: x.b.pad, right: x.b.pad, top: x.b.top + 110, flexDirection: 'column' }, [kickerEl(x.h.kicker, ink(kit.accent, kit.bg)), titleEl(T.text, T.size, kit.text, fam),
        h({ flexDirection: 'column', marginTop: 40, borderTop: `3px solid ${rgba(kit.text, 0.5)}` }, pts.map((p, i) => h({ alignItems: 'center', padding: `${x.H <= 1100 ? 16 : 22}px 0`, borderBottom: `1px solid ${rgba(kit.text, 0.2)}` }, [
          h({ width: 92, fontFamily: fam, fontSize: rs + 8, fontWeight: 700, color: ink(kit.accent, kit.bg) }, String(i + 1).padStart(2, '0')), h({ flex: 1, fontSize: rs, color: kit.text, wordBreak: 'keep-all' }, p)])))].filter(Boolean)),
      contactAt(x, kit.text)]) };
  },
  async photo_fade(x) {
    const { kit } = x; const T = x.fitT(x.h.head, x.width, 2, 92, 56);
    return { bg: kit.bg, layers: [{ input: await cover(x.photo!, W, x.H), left: 0, top: 0 }, { input: vgrad(W, x.H, [[0, '#000000', 0.4], [0.17, '#000000', 0], [0.4, kit.bg, 0], [0.7, kit.bg, 0.8], [1, kit.bg, 0.96]]), left: 0, top: 0 }],
      el: (fam) => root(x.H, [headerAt(x, '#FFFFFF', true),
        abs({ left: x.b.pad, right: x.b.pad, bottom: x.b.bottom + (kit.contact ? 96 : 10), flexDirection: 'column' }, [kickerEl(x.h.kicker, ink(kit.accent, kit.bg)), titleEl(T.text, T.size, '#FFFFFF', fam), subEl(x.h.sub, 36, 'rgba(255,255,255,0.86)', { mt: 24 })].filter(Boolean)),
        contactAt(x, '#FFFFFF')]) };
  },
  async photo_dim(x) {
    const { kit } = x; const T = x.fitT(x.h.head, x.width, 3, 100, 58); const shade = dark(kit.bg) ? kit.bg : '#000000';
    return { bg: kit.bg, layers: [{ input: await cover(x.photo!, W, x.H), left: 0, top: 0 }, { input: fill(W, x.H, shade, 0.66), left: 0, top: 0 }],
      el: (fam) => root(x.H, [headerAt(x, '#FFFFFF', true),
        // 상자는 늘이고(stretch) 줄마다 가운데 — alignItems center 면 제목 칸 폭이 좁게 잡혀 4줄이 되고 아래 글이 겹쳤음(로컬 10/24 06e30253)
        abs({ left: x.b.pad, right: x.b.pad, top: x.b.top + 110, bottom: x.b.bottom + (kit.contact ? 110 : 40), flexDirection: 'column', justifyContent: 'center' }, [
          kickerEl(x.h.kicker, ink(kit.accent, kit.bg), { center: true }), titleEl(T.text, T.size, '#FFFFFF', fam, { center: true }), subEl(x.h.sub, 36, 'rgba(255,255,255,0.86)', { center: true, mt: 28 })].filter(Boolean)),
        x.kit.contact ? abs({ left: x.b.pad, right: x.b.pad, bottom: x.b.bottom, justifyContent: 'center' }, [contactEl(x, 'rgba(255,255,255,0.9)', x.width, { center: true })]) : null]) };
  },
  async photo_caption(x) {
    const band = x.H <= 1100 ? 170 : 196; const top = x.H - (x.H >= 1900 ? x.b.bottom : 0) - band; const T = x.fitT(cut(x.h.head.replace(/\n/g, ' '), 24), x.width, 1, 54, 36, { ls: -1, spill: false });
    return { bg: '#000000', layers: [{ input: await cover(x.photo!, W, x.H), left: 0, top: 0 }, { input: vgrad(W, 260, [[0, '#000000', 0.45], [1, '#000000', 0]]), left: 0, top: 0 }, { input: fill(W, band, '#000000', 0.58), left: 0, top }],
      el: (fam) => root(x.H, [headerAt(x, '#FFFFFF', true),
        abs({ left: x.b.pad, right: x.b.pad, top: top + (x.kit.contact ? 34 : 56), flexDirection: 'column' }, [h({ fontFamily: fam, fontSize: T.size, fontWeight: 700, color: '#FFFFFF', letterSpacing: -1 }, T.text),
          x.kit.contact ? h({ marginTop: 14 }, [contactEl(x, 'rgba(255,255,255,0.85)', x.width)]) : null].filter(Boolean))]) };
  },
  async grid4(x) {
    const { kit } = x; const T = x.fitT(x.h.head, x.width, 2, 72, 46); const tTop = x.b.top + 104; const kick = x.h.kicker ? 58 : 0;
    const gy = tTop + kick + T.lines * T.size * 1.2 + 40; const gap = 16; const tw = Math.floor((x.width - gap) / 2);
    const th = Math.min(tw, Math.floor((x.H - x.b.bottom - (kit.contact ? 70 : 0) - gy - gap) / 2)); const at = (i: number) => ({ left: x.b.pad + (i % 2) * (tw + gap), top: Math.round(gy + Math.floor(i / 2) * (th + gap)) });
    const tiles = await Promise.all(x.photos.slice(0, 4).map(async (p, i) => ({ input: await cover(p.data, tw, th, 22), ...at(i) })));
    return { bg: kit.bg, layers: tiles, el: (fam) => root(x.H, [headerAt(x, kit.text, dark(kit.bg)),
      abs({ left: x.b.pad, right: x.b.pad, top: tTop, flexDirection: 'column' }, [kickerEl(x.h.kicker, ink(kit.accent, kit.bg)), titleEl(T.text, T.size, kit.text, fam)].filter(Boolean)),
      ...x.photos.slice(0, 4).map((p, i) => (p.label ? abs({ left: at(i).left + 18, top: at(i).top + th - 18 - 50, height: 50, alignItems: 'center', padding: '0 18px', borderRadius: 999, background: 'rgba(0,0,0,0.62)', color: '#FFFFFF', fontSize: 26, fontWeight: 700 }, p.label) : null)),
      contactAt(x, kit.text)]) };
  },
  async phone(x) {
    const sharp = (await import('sharp')).default; const { kit } = x; const T = x.fitT(x.h.head, x.width, 2, 84, 52); const tTop = x.b.top + 104;
    const tBottom = tTop + (x.h.kicker ? 58 : 0) + T.lines * T.size * 1.2;
    const pw = x.H <= 1100 ? 360 : 430; const ph = Math.round(pw * 2.05); const px = W - x.b.pad - pw + 6; const py = Math.round(tBottom + 56);
    const body = await sharp(svg(pw, ph, `<rect width="${pw}" height="${ph}" rx="64" ry="64" fill="#0B0B0F"/><rect x="5" y="5" width="${pw - 10}" height="${ph - 10}" rx="60" ry="60" fill="none" stroke="#2A2A33" stroke-width="3"/>`))
      .composite([{ input: await screenFit(x.screen!, pw - 28, ph - 28, 48), left: 14, top: 14 }, { input: fill(118, 30, '#0B0B0F', 1, 15), left: Math.round((pw - 118) / 2), top: 26 }]).png().toBuffer();
    const visible = Math.min(ph, x.H - py); const phone = await sharp(body).extract({ left: 0, top: 0, width: pw, height: Math.max(1, visible) }).png().toBuffer();
    const colW = px - x.b.pad - 40;
    return { bg: kit.bg, layers: [{ input: vgrad(W, x.H, [[0, kit.bg, 1], [1, kit.bg2, 1]]), left: 0, top: 0 }, ...(visible > 40 ? [{ input: phone, left: px, top: py }] : [])],
      el: (fam) => root(x.H, [headerAt(x, kit.text, dark(kit.bg)),
        abs({ left: x.b.pad, right: x.b.pad, top: tTop, flexDirection: 'column' }, [kickerEl(x.h.kicker, ink(kit.accent, kit.bg)), titleEl(T.text, T.size, kit.text, fam)].filter(Boolean)),
        abs({ left: x.b.pad, width: colW, top: py + 10, flexDirection: 'column' }, [subEl(x.h.sub, 34, rgba(kit.text, 0.86), { mt: 0 }),
          ...x.h.points.slice(0, 3).map((p) => h({ alignItems: 'center', columnGap: 14, marginTop: 22, fontSize: 30, color: kit.text, wordBreak: 'keep-all' }, [h({ width: 12, height: 12, borderRadius: 999, background: ink(kit.accent, kit.bg2), flexShrink: 0 }, ''), h({ flex: 1 }, p)]))].filter(Boolean)),
        kit.contact ? abs({ left: x.b.pad, width: colW, bottom: x.b.bottom }, [contactEl(x, rgba(kit.text, 0.9), colW, { weight: 700 })]) : null]) };
  },
  /** #262(대표 10/25 20:05 ④ 노트북 목업 틀): 가로(PC) 캡처를 16:10 화면에 꽉 채운 노트북(위 가운데 카메라 점·아래 받침대) — 제목은 위, 부제는 틀 아래(자리가 있을 때), 틀이 안 들어가면 비율대로 줄임 */
  async laptop(x) {
    const sharp = (await import('sharp')).default; const { kit } = x; const T = x.fitT(x.h.head, x.width, 2, 84, 52); const tTop = x.b.top + 104;
    const tBottom = tTop + (x.h.kicker ? 58 : 0) + T.lines * T.size * 1.2;
    const bez = 18, base = 26; const lw0 = W - (x.b.pad - 12) * 2; const sh0 = Math.round((lw0 - bez * 2) * 10 / 16); const lh0 = sh0 + bez * 2 + base;
    const ly = Math.round(tBottom + 60); const room = x.H - x.b.bottom - (kit.contact ? 56 : 0) - ly;
    const k = Math.min(1, room / lh0); const lw = Math.round(lw0 * k), lh = Math.round(lh0 * k); const lx = Math.round((W - lw) / 2);
    const body = await sharp(svg(lw0, lh0, `<rect width="${lw0}" height="${sh0 + bez * 2}" rx="28" ry="28" fill="#0B0B0F"/><rect x="4" y="4" width="${lw0 - 8}" height="${sh0 + bez * 2 - 8}" rx="25" ry="25" fill="none" stroke="#2A2A33" stroke-width="3"/><circle cx="${lw0 / 2}" cy="${bez / 2 + 1}" r="4" fill="#2A2A33"/><rect y="${sh0 + bez * 2 - 4}" width="${lw0}" height="${base + 4}" rx="10" ry="10" fill="#C3C7D0"/><rect x="${Math.round(lw0 / 2 - 90)}" y="${sh0 + bez * 2 - 4}" width="180" height="9" rx="4" ry="4" fill="#8E929C"/>`))
      .composite([{ input: await cover(x.screenWide!, lw0 - bez * 2, sh0, 8), left: bez, top: bez }]).png().toBuffer();
    const laptop = k < 1 ? await sharp(body).resize(lw, lh).png().toBuffer() : body;
    const after = ly + lh + 36; const subRoom = x.H - x.b.bottom - (kit.contact ? 56 : 0) - after;
    return { bg: kit.bg, layers: [{ input: vgrad(W, x.H, [[0, kit.bg, 1], [1, kit.bg2, 1]]), left: 0, top: 0 }, { input: laptop, left: lx, top: ly }],
      el: (fam) => root(x.H, [headerAt(x, kit.text, dark(kit.bg)),
        abs({ left: x.b.pad, right: x.b.pad, top: tTop, flexDirection: 'column' }, [kickerEl(x.h.kicker, ink(kit.accent, kit.bg)), titleEl(T.text, T.size, kit.text, fam)].filter(Boolean)),
        subRoom >= 80 && x.h.sub ? abs({ left: x.b.pad, right: x.b.pad, top: after, flexDirection: 'column' }, [subEl(x.h.sub, 34, rgba(kit.text, 0.86), { mt: 0 })]) : null,
        contactAt(x, kit.text)]) };
  },
  async vs(x) {
    const { kit } = x; const T = x.fitT(x.h.head, x.width, 2, 76, 48); const tTop = x.b.top + 104;
    const cy = Math.round(tTop + (x.h.kicker ? 58 : 0) + T.lines * T.size * 1.2 + 64); const gap = 28; const cw = Math.floor((x.width - gap) / 2);
    const ch = x.H >= 1900 ? 620 : x.H <= 1100 ? 360 : 500; const L = Math.abs(D.lum(kit.bg2) - D.lum(kit.bg)) < 0.02 ? mix(kit.bg, '#FFFFFF', 0.14) : kit.bg2; const R = contrast(kit.accent, L) < 1.6 ? kit.text : kit.accent; const d = 150; // 두 칸 색이 비슷하면 오른쪽은 글자 색으로
    const card = (s: string, bg: string) => { const c = x.fitT(s, cw - 72, 3, 66, 36); return h({ width: cw, height: ch, borderRadius: 32, background: bg, flexDirection: 'column', justifyContent: 'center', padding: '0 36px' }, [titleEl(c.text, c.size, on(bg), 'Noto Sans KR', { center: true })]); };
    return { bg: kit.bg, layers: [], el: (fam) => root(x.H, [
      abs({ left: x.b.pad, right: x.b.pad, top: tTop, flexDirection: 'column' }, [kickerEl(x.h.kicker, ink(kit.accent, kit.bg)), titleEl(T.text, T.size, kit.text, fam)].filter(Boolean)),
      abs({ left: x.b.pad, top: cy, width: x.width, columnGap: gap }, [card(x.h.left, L), card(x.h.right, R)]),
      abs({ left: Math.round(W / 2 - d / 2), top: Math.round(cy + ch / 2 - d / 2), width: d, height: d, borderRadius: 999, background: kit.text, border: `8px solid ${kit.bg}`, alignItems: 'center', justifyContent: 'center', fontFamily: fam, fontSize: 52, fontWeight: 700, color: kit.bg, letterSpacing: 1 }, 'VS'),
      abs({ left: x.b.pad, right: x.b.pad, bottom: x.b.bottom, flexDirection: 'column', alignItems: 'center', rowGap: 16 }, [headerEl(x, kit.text, dark(kit.bg)), contactEl(x, rgba(kit.text, 0.85), x.width, { center: true })].filter(Boolean))]) };
  },
  async poster(x) {
    const s = x.set; const T = x.fitT(x.h.head, x.width, 3, 150, 74); const pill = cut(x.h.sub || x.h.points[0] || '', 22);
    return { bg: s.bg, layers: [], el: (fam) => root(x.H, [
      abs({ right: -220, top: -180, width: 760, height: 760, borderRadius: 9999, background: s.fg, opacity: 0.07 }, ''), abs({ right: 120, top: 330, width: 260, height: 260, borderRadius: 9999, background: s.fg, opacity: 0.06 }, ''),
      abs({ left: x.b.pad, right: x.b.pad, top: x.b.top + 4, flexDirection: 'column' }, [h({ fontSize: 30, fontWeight: 700, letterSpacing: 6, color: s.fg }, x.kit.header.toUpperCase()), h({ marginTop: 18, width: 120, height: 6, background: s.fg }, '')]),
      abs({ left: x.b.pad, right: x.b.pad, top: x.b.top + 120, bottom: x.b.bottom + 190, flexDirection: 'column', justifyContent: 'center' }, [titleEl(T.text, T.size, s.fg, fam, { lh: 1.1 }),
        pill ? h({ marginTop: 44, alignSelf: 'flex-start', background: s.accent, color: s.accent.toUpperCase() === s.bg.toUpperCase() ? s.fg : on(s.accent), fontSize: 40, fontWeight: 700, padding: '16px 34px', borderRadius: 999 }, pill) : null].filter(Boolean)),
      abs({ left: x.b.pad, right: x.b.pad, bottom: x.b.bottom, flexDirection: 'column', rowGap: 10 }, [x.h.period ? h({ fontFamily: fam, fontSize: 44, fontWeight: 700, color: s.fg }, x.h.period) : null, contactEl(x, s.fg)].filter(Boolean))]) };
  },
  async price(x) {
    const s = x.kit.style === 'event' ? x.set : { bg: x.kit.bg, fg: x.kit.text, accent: x.kit.accent }; const ps = x.h.prices.slice(0, 4); const T = x.fitT(x.h.head, x.width, 2, 80, 50);
    const cols = ps.length === 4 ? 2 : ps.length; const gap = 20; const cw = Math.floor((x.width - gap * (cols - 1)) / cols); const ch = ps.length === 4 ? 230 : 300;
    const cardBg = dark(s.bg) ? '#FFFFFF' : '#111111'; const cardFg = on(cardBg); const lab = dark(s.bg) ? s.bg : s.fg === '#111111' ? s.bg : s.fg;
    return { bg: s.bg, layers: [], el: (fam) => root(x.H, [headerAt(x, s.fg, dark(s.bg)),
      abs({ left: x.b.pad, right: x.b.pad, top: x.b.top + 110, flexDirection: 'column' }, [kickerEl(x.h.kicker, x.kit.style === 'event' ? s.fg : ink(x.kit.accent, s.bg)), titleEl(T.text, T.size, s.fg, fam),
        h({ marginTop: 48, flexWrap: 'wrap', columnGap: gap, rowGap: gap, width: x.width }, ps.map((p) => h({ width: cw, height: ch, borderRadius: 28, background: cardBg, flexDirection: 'column', justifyContent: 'center', alignItems: 'center', rowGap: 14 }, [
          h({ fontSize: 34, fontWeight: 700, color: cardBg === '#FFFFFF' ? lab : '#FFFFFF' }, p.label), ((v) => h({ fontFamily: fam, fontSize: v.size, fontWeight: 700, color: cardFg }, v.text))(x.fitT(p.value, cw - 40, 1, 66, 34, { ls: 0, spill: false }))])))].filter(Boolean)),
      abs({ left: x.b.pad, right: x.b.pad, bottom: x.b.bottom, flexDirection: 'column', rowGap: 8 }, [x.h.period ? h({ fontSize: 36, fontWeight: 700, color: s.fg }, x.h.period) : null, contactEl(x, s.fg)].filter(Boolean))]) };
  },
  async statement(x) {
    const { kit } = x; const bg = D.lum(kit.bg) < 0.06 ? kit.bg : mix(kit.bg, '#000000', 0.55); const T = x.fitT(x.h.head, x.width, 3, 124, 64, { mark: x.h.keyword });
    return { bg, layers: [], el: (fam) => root(x.H, [headerAt(x, '#FFFFFF', true),
      abs({ left: x.b.pad, right: x.b.pad, top: x.b.top + 110, bottom: x.b.bottom + (kit.contact ? 110 : 40), flexDirection: 'column', justifyContent: 'center' }, [
        titleEl(T.text, T.size, '#FFFFFF', fam, { mark: x.h.keyword, markColor: ink(kit.accent, bg), lh: 1.3 }), subEl(x.h.sub, 38, 'rgba(255,255,255,0.72)', { mt: 36 })].filter(Boolean)),
      contactAt(x, '#FFFFFF')]) };
  },
  async report(x) {
    const { kit } = x; const T = x.fitT(x.h.head, x.width, 3, 104, 60);
    return { bg: kit.bg, layers: [], el: (fam) => root(x.H, [headerAt(x, kit.text, dark(kit.bg)),
      abs({ left: x.b.pad, right: x.b.pad, top: x.b.top + 120, flexDirection: 'column' }, [x.h.kicker ? h({ fontSize: 32, fontWeight: 700, color: ink(kit.accent, kit.bg), letterSpacing: 1 }, x.h.kicker) : null,
        h({ marginTop: 18, height: 3, background: rgba(kit.text, 0.35) }, ''), h({ marginTop: 56, flexDirection: 'column' }, [titleEl(T.text, T.size, kit.text, fam)]), subEl(x.h.sub, 36, rgba(kit.text, 0.8), { mt: 34 })].filter(Boolean)),
      kit.contact ? abs({ left: x.b.pad, right: x.b.pad, bottom: x.b.bottom, alignItems: 'center', columnGap: 18 }, [h({ width: 56, height: 6, borderRadius: 3, background: ink(kit.accent, kit.bg) }, ''), contactEl(x, ink(kit.accent, kit.bg), x.width - 80, { weight: 700 })]) : null]) };
  },
};

/** 한 장 그리기 → PNG. 글자는 글꼴에 있는 것만(외부 글꼴을 받으러 가지 않게), 브랜드 글꼴은 제목에만(못 읽으면 기본 글꼴) */
export async function renderFeed(x: RenderIn): Promise<Buffer> {
  const f = await D.fonts(); const c = (s: string) => D.clean(s, f.has);
  const hh: Hints = { ...x.h, head: c(x.h.head), sub: c(x.h.sub), kicker: c(x.h.kicker), points: x.h.points.map(c).filter(Boolean), left: c(x.h.left), right: c(x.h.right), keyword: c(x.h.keyword), period: c(x.h.period), prices: x.h.prices.map((p) => ({ label: c(p.label), value: c(p.value) })) };
  const kit: Kit = { ...x.kit, header: c(x.kit.header), contact: c(x.kit.contact), kicker: c(x.kit.kicker) };
  const b = boxOf(x.H); const logoEl = x.logo ? await logoOf(x.logo).catch(() => null) : null;
  const need = FEED_TEMPLATES[x.t].need as Need;
  const t: TemplateId = (need === 'photo' && !x.photo) || (need === 'photos4' && x.photos.length < 4) || (need === 'screen' && !x.screen) || (need === 'screen_wide' && !x.screenWide) ? 'title' : x.t; // 사진·화면을 못 읽었으면 제목형으로
  const M = await meter();
  const spec = await DRAW[t]({ ...x, t, h: hh, kit, brand: c(x.brand), logoEl, b, width: W - b.pad * 2, set: x.set ?? EVENT_SETS[0], fitT: (s, w, n, max, min, o) => fitTo(M, s, w, n, max, min, o) });
  const { ImageResponse } = await import('next/og');
  const fonts: any[] = [{ name: 'Noto Sans KR', data: f.bold, weight: 700, style: 'normal' }, { name: 'Noto Sans KR', data: f.reg, weight: 400, style: 'normal' }];
  const render = async (brandFont: boolean) => Buffer.from(await new ImageResponse(spec.el(brandFont ? 'Brand' : 'Noto Sans KR') as any, { width: W, height: x.H, fonts: brandFont ? [{ name: 'Brand', data: x.font!, weight: 700, style: 'normal' }, ...fonts] : fonts }).arrayBuffer());
  let layer: Buffer | null = null;
  if (x.font) { try { layer = await render(true); } catch { /* 브랜드 글꼴을 못 읽으면 기본 글꼴로 */ } }
  layer ??= await render(false);
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: W, height: x.H, channels: 4, background: spec.bg } }).composite([...spec.layers, { input: layer, left: 0, top: 0 }]).png().toBuffer();
}
