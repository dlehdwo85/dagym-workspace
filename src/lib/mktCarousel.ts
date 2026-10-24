import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { audit } from './log';
import { zUuid } from './api';
import { tenantOf, type SessionUser } from './types';
import { aiJson } from './mktOps';
import type { DrawOpts, Slide, SlideKind } from './mktCarouselDraw';

/**
 * #499-5 카드뉴스(캐러셀) 장별 생성기 — 테크트리 EP.11 '캐러셀 5.0' 대응(docs/handoff/TECHTREE_VIDEOS_2026-10-23.md 3장 E·부록 C).
 * ① 제품·서비스(+대상·비교 대상) → AI 주제 후보 4개(A vs B · N가지 방법 · 유형별 추천 · 체크리스트, 콘텐츠형 훅 점수)
 * ② 고른 주제 → AI 장별 문구·표·이미지 계획·인스타 본문·댓글 키워드(6장 틀: 표지 질문 → 왜 다른가 → A → B → 유형별 추천 표 → CTA)
 * ③ 직원이 고침(장 추가·빼기·순서, 자료실 사진, 틀 3종) — 미리보기는 서버가 그린 그림 그대로
 * ④ [이미지로 만들어 승인 요청]: 우리 서버가 장마다 JPEG(1080×1350) → 자료실 '마케팅/카드뉴스' → 인스타 콘텐츠 승인 대기(사진 여러 장 = 캐러셀 게시)
 *    다시 그리면 같은 콘텐츠의 새 버전(재승인). 외부 유료 생성 없음 — AI 는 문구만(마케팅 AI 한도).
 * 숫자·실적·가격은 재료에 있는 것만, 없으면 {{ }} — 남아 있으면 그리지 않음(그림에 자리표시가 찍히지 않게). 금지어도 그리기 전에 막음.
 */
export const PATTERNS = { vs: 'A vs B 비교', howto: 'N가지 방법', types: '유형별 추천', checklist: '체크리스트' } as const;
export const TEMPLATES = { box: '사진 + 검정 상자', clean: '흰 바탕', bold: '브랜드 색' } as const;
export type Pattern = keyof typeof PATTERNS;
const PATTERN_KEYS = Object.keys(PATTERNS) as Pattern[];
const STRUCTURE: Record<Pattern, string[]> = {
  vs: ['cover: A vs B 질문', 'body: 같은 목적인데 왜 다를까', 'body: A의 특징', 'body: B의 특징', 'table: 유형별 추천 표', 'cta'],
  howto: ['cover: 실패 없이 ○○하는 법 N가지', 'body: 왜 자꾸 실패할까', 'body: 방법 1', 'body: 방법 2', 'body: 방법 3', 'cta'],
  types: ['cover: 나에게 맞는 ○○는?', 'body: 고르는 기준', 'body: 유형 1', 'body: 유형 2', 'table: 유형별 추천 표', 'cta'],
  checklist: ['cover: ○○ 전에 꼭 확인할 N가지', 'body: 왜 확인해야 할까', 'body: 확인 1~3', 'body: 확인 4~6', 'table: 한눈에 보는 표', 'cta'],
};
const MAX_SLIDES = 10; // 인스타 캐러셀 최대 10장
const opt = (n: number) => z.string().trim().max(n).optional();
const zPattern = z.enum(PATTERN_KEYS as [Pattern, ...Pattern[]]);
const zTemplate = z.enum(['box', 'clean', 'bold']);
export const carouselTopicInput = z.object({ brandId: zUuid.nullable().optional(), product: z.string().trim().min(2, '제품·서비스를 적어 주세요').max(120), audience: opt(60), a: opt(30), b: opt(30), note: opt(300) });
export const carouselInput = carouselTopicInput.extend({ topic: z.string().trim().min(2, '주제를 적거나 골라 주세요').max(80), pattern: zPattern, keyword: opt(20), template: zTemplate.default('box') });
const slideInput = z.object({ kind: z.enum(['cover', 'body', 'table', 'cta']), title: z.string().trim().min(1, '장마다 제목이 필요합니다').max(60), body: z.string().max(300).default(''),
  rows: z.array(z.array(z.string().trim().max(40)).min(1).max(3)).max(7).default([]), imagePlan: z.string().max(200).default(''), imageId: zUuid.nullable().optional() });
export const carouselPatch = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), topic: z.string().trim().min(2).max(80).optional(), slides: z.array(slideInput).min(3).max(MAX_SLIDES).optional(), caption: z.string().max(2200).optional(), keyword: opt(20), template: zTemplate.optional() }),
  z.object({ action: z.literal('rewrite'), note: z.string().trim().min(2, '무엇을 고칠지 두 글자 이상 적어 주세요').max(500) }),
  z.object({ action: z.literal('cancel') })]);
export const carouselRenderInput = z.object({ scheduledAt: z.string().datetime({ offset: true }).nullable().optional() });

type Topic = { pattern: Pattern; topic: string; why: string; a: string; b: string; score?: number };
type Row = { id: string; tenant: string; brand_id: string | null; product: string; topic: string; pattern: Pattern; input: { audience?: string; a?: string; b?: string; note?: string; changes?: string };
  slides: Slide[]; caption: string; keyword: string | null; template: DrawOpts['template']; status: 'draft' | 'sent' | 'canceled'; source: 'ai' | 'template'; media_ids: string[]; content_id: string | null;
  rendered_at: string | null; created_by: string | null; created_at: string; updated_at: string };
const clip = (v: unknown, n: number) => String(v ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const clipLines = (v: unknown, n: number) => String(v ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, n);
const PLACEHOLDER = /\{\{[^}]*\}\}/;
/** 받침에 맞는 조사(을/를·이/가·와/과·은/는) — 한글이 아니면 뒤 것 */
const josa = (w: string, pair: '을를' | '이가' | '와과' | '은는') => { const c = w.trim().slice(-1).charCodeAt(0); const batchim = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0; return `${w}${batchim ? pair[0] : pair[1]}`; };

/** 재료: 회사·브랜드 소개·주력 상품·말투 + 금지어 (#499-6 경쟁 광고 보관함도 씀) */
export async function material(tenant: string, brandId: string | null) {
  const sql = db();
  const [brand] = brandId ? await sql<any[]>`select id, name, intro, products, voice, banned_words, color, video from mkt_brands where id = ${brandId} and tenant = ${tenant}` : [];
  if (brandId && !brand) throw notFound('브랜드를 찾을 수 없습니다');
  const { companyAi } = await import('./ai/persona');
  const co = await companyAi({ tenant } as SessionUser).catch(() => ({} as any));
  const Q = await import('./mktQuality');
  const text = [`회사: ${co?.name ?? ''}${co?.industries?.length ? ` (${co.industries.join('·')})` : ''}`, co?.business ? `사업: ${co.business}` : '', co?.customers ? `주요 고객: ${co.customers}` : '',
    brand ? `브랜드: ${brand.name}${brand.intro ? ` — ${String(brand.intro).slice(0, 200)}` : ''}` : '', brand?.products ? `주력 상품: ${String(brand.products).slice(0, 200)}` : '', Q.voicePrompt(brand?.voice)].filter(Boolean).join('\n');
  return { brand: brand ?? null, co, text, banned: [...(brand?.banned_words ?? []), ...Q.avoidOf(brand?.voice)].filter((w: string) => w && w.trim().length >= 2) as string[] };
}
const bannedLine = (b: string[]) => (b.length ? `\n금지어(쓰지 않음): ${b.join(', ')}` : '');

// ---------------- ① 주제 후보 ----------------
function templateTopics(product: string, a?: string, b?: string): Topic[] {
  const A = a || '직접 하기', B = b || product;
  return [{ pattern: 'vs', topic: `${A} vs ${B}, 무엇이 맞을까?`, why: '둘 중 하나를 고르는 비교는 저장·공유가 잘 됩니다', a: A, b: B },
    { pattern: 'howto', topic: `${product}, 실패 없이 고르는 법 3가지`, why: '방법 N가지는 끝까지 넘겨 보게 만듭니다', a: '', b: '' },
    { pattern: 'types', topic: `나에게 맞는 ${josa(product, '은는')}? 유형별 추천`, why: '내 경우를 찾게 해 댓글이 늘어납니다', a: '', b: '' },
    { pattern: 'checklist', topic: `${josa(product, '을를')} 정하기 전 꼭 확인할 5가지`, why: '체크리스트는 저장해 두고 다시 봅니다', a: '', b: '' }];
}
export async function carouselTopics(u: SessionUser, i: z.infer<typeof carouselTopicInput>) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const m = await material(t, i.brandId ?? null);
  const Q = await import('./mktQuality'); const rules = await Q.qualityRules();
  const scored = (xs: Topic[]) => xs.map((x) => ({ ...x, score: Q.scoreHook(x.topic, rules, [], 'content').score }));
  let aiError: string | null = null;
  try {
    const o = await aiJson(t, u.id, `당신은 경력 30년의 인스타그램 콘텐츠 마케터입니다. 카드뉴스(캐러셀) 주제 후보를 냅니다. JSON 만.
유형마다 1개씩 4개 — vs=A vs B 둘 중 무엇?(비교) · howto=실패 없이 ○○하는 법 N가지 · types=유형별 추천(나에게 맞는 ○○는?) · checklist=○○ 전에 확인할 N가지.
각 후보: {pattern, topic(표지 질문 30자 이내), why(이 주제가 먹히는 이유 한 줄), a, b(vs 일 때 비교 대상 두 개 — 나머지 유형은 빈 문자열)}.
${Q.MODE_GUIDE.content}
숫자·실적·가격은 재료에 있는 것만 — 없으면 쓰지 않습니다. 과장·최상급 금지.`,
      `[재료]\n${m.text}\n\n제품·서비스: ${i.product}\n대상: ${i.audience || '(재료에서 판단)'}${i.a || i.b ? `\n비교 대상: ${i.a || '?'} vs ${i.b || '?'}` : ''}${i.note ? `\n메모: ${i.note}` : ''}${bannedLine(m.banned)}`,
      { type: 'object', additionalProperties: false, required: ['topics'], properties: { topics: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['pattern', 'topic', 'why', 'a', 'b'],
        properties: { pattern: { type: 'string' }, topic: { type: 'string' }, why: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' } } } } } }, 'marketing_carousel', { make: true });
    const got = (Array.isArray(o?.topics) ? o.topics : []).map((x: any) => ({ pattern: x?.pattern, topic: clip(x?.topic, 80), why: clip(x?.why, 120), a: clip(x?.a, 30), b: clip(x?.b, 30) }))
      .filter((x: Topic) => PATTERN_KEYS.includes(x.pattern) && x.topic.length >= 2) as Topic[];
    const byPattern = PATTERN_KEYS.map((p) => got.find((x) => x.pattern === p)).filter((x): x is Topic => !!x);
    if (byPattern.length) return { topics: scored(byPattern), source: 'ai' as const, aiError };
  } catch (e) { aiError = clip((e as Error)?.message ?? e, 200); }
  return { topics: scored(templateTopics(i.product, i.a, i.b)), source: 'template' as const, aiError };
}

// ---------------- ② 장별 문구 ----------------
type Gen = { slides: Slide[]; caption: string; keyword: string; source: 'ai' | 'template'; changes?: string; aiError?: string | null };
const blank = (kind: SlideKind, title: string, body = '', rows: string[][] = [], imagePlan = ''): Slide => ({ kind, title, body, rows, imagePlan, imageId: null });
const ctaSlide = (kw: string) => blank('cta', `댓글에 '${kw}' 남겨 주세요`, `${josa(kw, '을를')} 보내 드려요\n도움이 됐다면 저장·팔로우`);
function templateSlides(product: string, topic: string, pattern: Pattern, kw: string, a?: string, b?: string): Slide[] {
  const A = a || 'A', B = b || 'B';
  const mid: Record<Pattern, Slide[]> = {
    vs: [blank('body', '같은 목적인데 왜 다를까', `${A} · ${B}, 출발점이 달라요.\n{{가장 큰 차이 한 줄}}\n세 가지만 비교해 보세요.`, [], '두 가지를 나란히 놓은 실제 사진'),
      blank('body', `${A}의 특징`, '{{특징 1}}\n{{특징 2}}\n{{주의할 점}}', [], `${A} 실제 모습`), blank('body', `${B}의 특징`, '{{특징 1}}\n{{특징 2}}\n{{이런 분께 맞아요}}', [], `${B} 실제 모습`),
      blank('table', '이런 경우엔 이것', '', [['이런 경우', '추천'], ['{{경우 1}}', A], ['{{경우 2}}', B], ['{{경우 3}}', '{{추천}}']])],
    howto: [blank('body', '왜 자꾸 실패할까', '{{가장 흔한 실수}}\n{{그래서 생기는 문제}}', [], '실수 장면을 보여 주는 실제 사진'),
      ...[1, 2, 3].map((k) => blank('body', `방법 ${k}. {{핵심 한 줄}}`, '{{설명 1}}\n{{설명 2}}', [], `방법 ${k}을 보여 주는 실제 사진`))],
    types: [blank('body', '고르는 기준 3가지', '{{기준 1}}\n{{기준 2}}\n{{기준 3}}', [], '고르는 모습의 실제 사진'),
      blank('body', '{{유형 1}}이라면', '{{추천과 이유}}', [], '유형 1에 맞는 실제 사진'), blank('body', '{{유형 2}}이라면', '{{추천과 이유}}', [], '유형 2에 맞는 실제 사진'),
      blank('table', '유형별 추천 한눈에', '', [['유형', '추천'], ['{{유형 1}}', '{{추천}}'], ['{{유형 2}}', '{{추천}}'], ['{{유형 3}}', '{{추천}}']])],
    checklist: [blank('body', '왜 확인해야 할까', '{{놓치면 생기는 문제}}', [], '확인하는 손·서류의 실제 사진'),
      blank('body', '확인 1~3', '1. {{확인 1}}\n2. {{확인 2}}\n3. {{확인 3}}'), blank('body', '확인 4~5', '4. {{확인 4}}\n5. {{확인 5}}'),
      blank('table', '한눈에 보는 체크리스트', '', [['항목', '기준'], ['{{항목 1}}', '{{기준}}'], ['{{항목 2}}', '{{기준}}'], ['{{항목 3}}', '{{기준}}']])],
  };
  return [blank('cover', topic, pattern === 'checklist' ? '하나라도 빠지면 다시 보세요' : '결정 전에 이것만 보세요', [], `${product} 대표 사진(실제 사진)`), ...mid[pattern], ctaSlide(kw)];
}
const templateCaption = (product: string, topic: string, kw: string) => `${topic}\n\n${product}, 장마다 정리했어요. 저장해 두고 비교해 보세요.\n\n댓글에 '${kw}' 남기면 보내 드려요.\n\n#${product.replace(/[^\p{L}\p{N}]+/gu, '')} #카드뉴스`;
/** AI 결과 정리: 첫 장 표지·마지막 장 CTA·최대 10장·길이 */
function normSlides(raw: any[], topic: string, kw: string): Slide[] {
  const kinds = new Set(['cover', 'body', 'table', 'cta']);
  let s: Slide[] = (Array.isArray(raw) ? raw : []).map((x: any) => ({ kind: kinds.has(x?.kind) ? x.kind : 'body', title: clipLines(x?.title, 60), body: clipLines(x?.body, 300),
    rows: (Array.isArray(x?.rows) ? x.rows : []).slice(0, 7).map((r: unknown) => (Array.isArray(r) ? r : []).slice(0, 3).map((c) => clip(c, 40))).filter((r: string[]) => r.some(Boolean)),
    imagePlan: clip(x?.imagePlan, 200), imageId: null })).filter((x) => x.title);
  s = s.map((x, k) => (x.kind === 'table' && !x.rows.length ? { ...x, kind: 'body' as const } : x.kind === 'cover' && k > 0 ? { ...x, kind: 'body' as const } : x));
  if (s[0]?.kind !== 'cover') s.unshift(blank('cover', topic));
  const ctas = s.filter((x) => x.kind === 'cta'); s = s.filter((x) => x.kind !== 'cta');
  return [...s.slice(0, MAX_SLIDES - 1), ctas.at(-1) ?? ctaSlide(kw)].map((x) => (x.kind === 'cover' || x.kind === 'body' ? x : { ...x, imagePlan: '' })); // 사진은 표지·본문 장만
}
const slidesText = (s: Slide[]) => s.map((x, k) => `${k + 1}. [${x.kind}] ${x.title.replace(/\n/g, ' / ')}${x.body ? ` — ${x.body.replace(/\n/g, ' / ')}` : ''}${x.rows.length ? ` — 표: ${x.rows.map((r) => r.join(' | ')).join(' / ')}` : ''}`).join('\n');
async function generate(tenant: string, actorId: string, p: { product: string; topic: string; pattern: Pattern; audience?: string; a?: string; b?: string; note?: string; keyword?: string; brandId: string | null }, prev?: { slides: Slide[]; caption: string; note: string }): Promise<Gen | null> {
  const m = await material(tenant, p.brandId);
  const mem = await (await import('./mktTeam')).memoryText(tenant, 'designer', p.brandId).catch(() => ''); // #499-7 디자인 담당 기억(수정 요청·대표 메모)
  const kw0 = clip(p.keyword, 20).replace(/['"‘’“”]/g, '');
  try {
    const Q = await import('./mktQuality');
    const o = await aiJson(tenant, actorId, `당신은 경력 30년의 인스타그램 콘텐츠 마케터입니다. 카드뉴스(캐러셀) 장별 문구와 이미지 계획을 씁니다. JSON 만.
틀(1080×1350 · 6장, 내용이 많으면 8장까지): ${STRUCTURE[p.pattern].map((x, k) => `${k + 1}) ${x}`).join(' → ')}
- slides[]: {kind(cover|body|table|cta), title, body, rows, imagePlan}
- cover: title = 표지 질문(30자 이내, 두 줄이면 \\n), body = 부제 한 줄(25자 이내)
- body: title 20자 이내, body 2~4줄(줄마다 \\n, 줄당 25자 안팎) — 블로그처럼 정보 위주, '~해요' 말투
- table: title 한 줄 + rows = 머리줄 포함 3~6줄 × 2~3칸(칸당 15자 이내), body 는 빈 문자열
- cta(마지막 1장): title = 댓글 키워드로 무엇을 받는지('댓글에 '키워드' 남기면 ○○ 보내 드려요'), body = '도움이 됐다면 저장·팔로우' 한 줄
- imagePlan: 장마다 넣을 실제 사진 한 줄(현장·제품·손·공간 — 정면 쇼핑몰 사진·생성 인물 금지). table·cta 는 빈 문자열
- caption: 인스타 본문 — 첫 줄 = 표지 질문을 살린 훅, 요약 3~5줄, 마지막 줄 = 같은 댓글 키워드 행동, 해시태그 3~5개
- keyword: 댓글 키워드(2~6자 — 예: 비교표·체크리스트)
- ${Q.MODE_GUIDE.content}
- 숫자·실적·가격·후기는 재료에 있는 것만. 없으면 {{ }} 로 비워 둡니다(직원이 채움). 과장·최상급 금지.${prev ? "\n- changes: '수정 요청 → 반영한 점' 한 줄" : ''}`,
      `[재료]\n${m.text}\n\n제품·서비스: ${p.product}\n주제(표지): ${p.topic}\n유형: ${PATTERNS[p.pattern]}${p.a || p.b ? `\n비교 대상: A=${p.a || '?'} · B=${p.b || '?'}` : ''}\n대상: ${p.audience || '(재료에서 판단)'}${kw0 ? `\n댓글 키워드: ${kw0}` : ''}${p.note ? `\n메모: ${p.note}` : ''}${bannedLine(m.banned)}${mem ? `\n\n${mem}` : ''}${prev ? `\n\n[지금 안]\n${slidesText(prev.slides)}\n본문: ${prev.caption}\n\n[수정 요청] ${prev.note}` : ''}`,
      { type: 'object', additionalProperties: false, required: ['slides', 'caption', 'keyword', ...(prev ? ['changes'] : [])], properties: { caption: { type: 'string' }, keyword: { type: 'string' }, ...(prev ? { changes: { type: 'string' } } : {}),
        slides: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'title', 'body', 'rows', 'imagePlan'], properties: { kind: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, imagePlan: { type: 'string' },
          rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } } } } } } }, 'marketing_carousel', { make: true });
    if (o === null && prev) throw badRequest('AI 가 꺼져 있어 고칠 수 없습니다 — 직접 고쳐 주세요');
    const aiKw = clip(o?.keyword, 20).replace(/['"‘’“”]/g, '');
    const kw = (prev ? aiKw || kw0 : kw0 || aiKw) || '자료'; // 처음: 직원이 적은 키워드 우선 · 고칠 때: 지금 키워드를 AI 에 주고 AI 답을 따름
    const slides = normSlides(o?.slides, p.topic, kw);
    if (slides.length >= 3) return { slides, caption: String(o?.caption ?? '').trim().slice(0, 2200) || templateCaption(p.product, p.topic, kw), keyword: kw, source: 'ai', changes: prev ? clip(o?.changes, 300) : undefined };
  } catch (e) {
    if (prev) throw e instanceof HttpError && e.status === 400 ? e : badRequest(`AI 로 고치지 못했습니다 — 직접 고쳐 주세요 (${clip((e as Error)?.message ?? e, 150)})`);
    const kw = kw0 || '자료';
    return { slides: templateSlides(p.product, p.topic, p.pattern, kw, p.a, p.b), caption: templateCaption(p.product, p.topic, kw), keyword: kw, source: 'template', aiError: clip((e as Error)?.message ?? e, 200) };
  }
  if (prev) throw badRequest('AI 가 쓸 수 있는 안을 내지 못했습니다 — 직접 고쳐 주세요');
  const kw = kw0 || '자료';
  return { slides: templateSlides(p.product, p.topic, p.pattern, kw, p.a, p.b), caption: templateCaption(p.product, p.topic, kw), keyword: kw, source: 'template', aiError: null };
}

// ---------------- 보기 ----------------
/** 그리기 전 검사: 자리표시 {{ }}·금지어(장 번호와 함께) + 표지 콘텐츠형 훅 점수 */
async function check(r: Pick<Row, 'slides' | 'caption'>, banned: string[], rules?: Awaited<ReturnType<typeof import('./mktQuality').qualityRules>>) {
  const Q = await import('./mktQuality');
  const text = (s: Slide) => [s.title, s.body, ...s.rows.flat()].join('\n');
  const placeholders = r.slides.map((s, k) => (PLACEHOLDER.test(text(s)) ? k + 1 : 0)).filter(Boolean);
  if (PLACEHOLDER.test(r.caption)) placeholders.push(0);
  const hits = banned.filter((w) => r.slides.some((s) => text(s).includes(w)) || r.caption.includes(w));
  const cover = r.slides[0]?.title?.replace(/\n/g, ' ') ?? '';
  return { placeholders, banned: hits, score: Q.scoreHook(cover, rules ?? await Q.qualityRules(), [], 'content') };
}
async function viewRows(t: string, id?: string) {
  const sql = db();
  const rows = await sql<(Row & { brand_name: string | null; banned_words: string[] | null; voice: any; content_status: string | null; content_version: number | null; created_by_name: string | null })[]>`
    select c.*, b.name as brand_name, b.banned_words, b.voice, mc.status as content_status, mc.current_version as content_version, u.name as created_by_name
    from mkt_carousels c left join mkt_brands b on b.id = c.brand_id left join mkt_contents mc on mc.id = c.content_id left join users u on u.id = c.created_by
    where c.tenant = ${t} ${id ? sql`and c.id = ${id}` : sql`and (c.status <> 'canceled' or c.updated_at > now() - interval '3 days')`}
    order by (c.status = 'draft') desc, c.updated_at desc limit 30`;
  const Q = await import('./mktQuality'); const rules = await Q.qualityRules();
  const ids = [...new Set(rows.flatMap((r) => (r.slides ?? []).map((s) => s.imageId).filter((x): x is string => !!x)))];
  const photos = ids.length ? Object.fromEntries((await sql<{ id: string; title: string }[]>`select id, coalesce(nullif(title, ''), file_name) as title from library_files where id = any(${ids}::uuid[]) and tenant = ${t} and deleted_at is null`).map((f) => [f.id, f.title])) : {};
  const out = [];
  for (const r of rows) {
    const { banned_words, voice, ...rest } = r;
    out.push({ ...rest, photos: Object.fromEntries(r.slides.filter((s) => s.imageId && photos[s.imageId]).map((s) => [s.imageId!, photos[s.imageId!]])),
      check: await check(r, [...(banned_words ?? []), ...Q.avoidOf(voice)].filter((w) => w && w.trim().length >= 2), rules) });
  }
  return out;
}
export async function carouselView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u);
  const brands = await db()<{ id: string; name: string; color: string | null; hasLogo: boolean }[]>`select id, name, color, (video->>'logoFileId') is not null as "hasLogo" from mkt_brands where tenant = ${t} order by name`;
  return { items: await viewRows(t), brands, patterns: PATTERNS, templates: TEMPLATES, canDecide: isAdmin(u), userId: u.id, aiEnabled: (await import('./ai/provider')).aiEnabled() };
}
async function load(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('카드뉴스를 찾을 수 없습니다');
  const [r] = await db()<Row[]>`select * from mkt_carousels where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!r) throw notFound('카드뉴스를 찾을 수 없습니다'); // 다른 회사 것은 없는 것처럼
  return r;
}

// ---------------- 만들기·고치기 ----------------
/** [장별 문구 만들기](마케팅 공간 누구나): AI 장별 문구 → 초안(그리기 전) */
export async function createCarousel(u: SessionUser, i: z.infer<typeof carouselInput>) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const brandId = i.brandId ?? null;
  const g = (await generate(t, u.id, { ...i, brandId }))!;
  const input = { audience: i.audience || undefined, a: i.a || undefined, b: i.b || undefined, note: i.note || undefined };
  const [r] = await db()<{ id: string }[]>`insert into mkt_carousels (tenant, brand_id, product, topic, pattern, input, slides, caption, keyword, template, source, created_by)
    values (${t}, ${brandId}, ${i.product}, ${i.topic}, ${i.pattern}, ${db().json(input as never)}, ${db().json(g.slides as never)}, ${g.caption}, ${g.keyword}, ${i.template}, ${g.source}, ${u.id}) returning id`;
  return { item: (await viewRows(t, r.id))[0], aiError: g.aiError ?? null };
}
/** 고치기(저장) · AI 로 고치기(수정 요청 반영) · 취소(만든 사람·관리자, 초안만) */
export async function patchCarousel(u: SessionUser, id: string, i: z.infer<typeof carouselPatch>) {
  const r = await load(u, id); const sql = db();
  if (r.status === 'canceled') throw badRequest('취소한 카드뉴스입니다');
  if (i.action === 'cancel') {
    if (r.created_by !== u.id && !isAdmin(u)) throw forbidden('만든 사람이나 관리자만 취소합니다');
    if (r.status !== 'draft') throw badRequest('승인 요청을 보낸 카드뉴스는 승인함에서 처리해 주세요');
    await sql`update mkt_carousels set status = 'canceled', updated_at = now() where id = ${id}`;
    return { item: (await viewRows(r.tenant, id))[0] };
  }
  if (i.action === 'rewrite') {
    const g = (await generate(r.tenant, u.id, { product: r.product, topic: r.topic, pattern: r.pattern, ...r.input, keyword: r.keyword ?? undefined, brandId: r.brand_id }, { slides: r.slides, caption: r.caption, note: i.note }))!;
    // 고른 사진은 같은 자리(장 번호)에 남긴다
    const slides = g.slides.map((s, k) => ({ ...s, imageId: s.kind === 'cover' || s.kind === 'body' ? r.slides[k]?.imageId ?? null : null }));
    await sql`update mkt_carousels set slides = ${sql.json(slides as never)}, caption = ${g.caption}, keyword = ${g.keyword}, source = 'ai', input = ${sql.json({ ...r.input, changes: g.changes || i.note } as never)}, updated_at = now() where id = ${id}`;
    await (await import('./mktTeam')).remember(r.tenant, 'designer', { brandId: r.brand_id, kind: 'edit', text: i.note, sourceType: 'mkt_carousel', sourceId: id, by: u.id }).catch(() => {}); // #499-7 수정 이유 = 디자인 담당 기억
    return { item: (await viewRows(r.tenant, id))[0], changes: g.changes ?? null };
  }
  if (i.slides) {
    if (i.slides[0].kind !== 'cover') throw badRequest('첫 장은 표지여야 합니다');
    if (i.slides.at(-1)!.kind !== 'cta' || i.slides.filter((s) => s.kind === 'cta').length !== 1) throw badRequest('마지막 장(CTA)은 하나, 맨 끝에 둡니다');
    if (i.slides.filter((s) => s.kind === 'cover').length !== 1) throw badRequest('표지는 한 장만 둡니다');
    const t = i.slides.find((s) => s.kind === 'table' && !s.rows.length); if (t) throw badRequest(`표 장 '${t.title}'에 줄이 없습니다`);
    const ids = [...new Set(i.slides.map((s) => s.imageId).filter((x): x is string => !!x))];
    const { loadLibraryFile } = await import('./library');
    for (const fid of ids) {
      const f = await loadLibraryFile(u, fid, 'meta');
      if (!/^image\//.test(f.mime_type)) throw badRequest(`사진이 아닌 자료입니다: ${f.title}`);
      if (f.effective_security === 'confidential') throw badRequest(`기밀 자료는 카드뉴스(외부 게시)에 넣을 수 없습니다: ${f.title}`);
    }
  }
  const slides = i.slides?.map((s) => ({ ...s, title: clipLines(s.title, 60), body: clipLines(s.body, 300), imageId: s.kind === 'cover' || s.kind === 'body' ? s.imageId ?? null : null }));
  await sql`update mkt_carousels set topic = ${i.topic ?? r.topic}, slides = ${sql.json((slides ?? r.slides) as never)}, caption = ${i.caption ?? r.caption}, keyword = ${i.keyword !== undefined ? i.keyword.replace(/['"‘’“”]/g, '') || null : r.keyword},
    template = ${i.template ?? r.template}, updated_at = now() where id = ${id}`;
  return { item: (await viewRows(r.tenant, id))[0] };
}

// ---------------- ③ 그리기 ----------------
async function drawOpts(r: Row): Promise<DrawOpts> {
  const [b] = r.brand_id ? await db()<{ name: string; color: string | null; video: any; feed: any }[]>`select name, color, video, feed from mkt_brands where id = ${r.brand_id}` : [];
  const kit = b?.video ?? {};
  const { libBytes } = await import('./mktVideo');
  const D0 = await import('./mktCarouselDraw');
  const logo = await libBytes(r.tenant, kit.logoFileId, /^image\//).catch(() => null);
  const font = await libBytes(r.tenant, kit.fontFileId, /font|\.(otf|ttf)$/i).catch(() => null);
  return { template: r.template, color: await D0.brandDrawColor(r.tenant, b), brand: b?.name ?? '', keyword: r.keyword ?? '', logo: logo?.data ?? null, font: font && /\.(otf|ttf)$/i.test(font.name) ? font.data : null };
}
async function photoOf(u: SessionUser, s: Slide) {
  if (!s.imageId || (s.kind !== 'cover' && s.kind !== 'body')) return null;
  const { loadLibraryFile } = await import('./library');
  const f = await loadLibraryFile(u, s.imageId, 'meta').catch(() => null); // 지운 사진·볼 수 없는 사진은 빼고 그림
  if (!f?.storage_key || !/^image\//.test(f.mime_type) || f.effective_security === 'confidential') return null; // 나중에 기밀로 바뀐 사진도 빼고 그림
  return (await import('./storage')).getObject(f.storage_key);
}
/** 미리보기: 한 장(1부터) PNG — 서버가 그리는 그림 그대로 */
export async function carouselSlidePng(u: SessionUser, id: string, n: number) {
  const r = await load(u, id);
  const s = r.slides[n - 1]; if (!s) throw notFound('그 장이 없습니다');
  const D = await import('./mktCarouselDraw');
  return D.drawSlide(s, n - 1, r.slides.length, await drawOpts(r), await photoOf(u, s));
}
/** [이미지로 만들어 승인 요청]: 장마다 JPEG → 자료실 '마케팅/카드뉴스' → 인스타 콘텐츠 승인 대기(이미 보냈으면 새 버전) */
export async function renderCarousel(u: SessionUser, id: string, i: z.infer<typeof carouselRenderInput>) {
  const r = await load(u, id);
  if (r.status === 'canceled') throw badRequest('취소한 카드뉴스입니다');
  const m = await material(r.tenant, r.brand_id).catch(() => ({ banned: [] as string[] }));
  const c = await check(r, m.banned);
  if (c.placeholders.length) throw badRequest(`채우지 않은 자리표시 {{ }}가 있습니다 — ${c.placeholders.map((k) => (k ? `${k}장` : '본문')).join(' · ')}`);
  if (c.banned.length) throw badRequest(`금지어가 들어 있습니다: ${c.banned.join(', ')}`);
  if (!r.caption.trim()) throw badRequest('인스타 본문(캡션)을 적어 주세요');
  const sql = db(); const name = `carousel:${id}`; const holder = randomUUID();
  const got = await sql`insert into job_locks (name, locked_until, holder) values (${name}, now() + interval '2 minutes', ${holder})
    on conflict (name) do update set locked_until = excluded.locked_until, holder = excluded.holder where job_locks.locked_until < now() returning holder`;
  if (!got.length) throw new HttpError(409, 'carousel_busy', '지금 그리는 중입니다 — 잠시 뒤 다시 눌러 주세요');
  try {
    const D = await import('./mktCarouselDraw'); const o = await drawOpts(r);
    const { saveGeneratedFile } = await import('./library');
    const safe = r.topic.replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 60) || '카드뉴스'; const title = r.topic.replace(/\s+/g, ' ').trim().slice(0, 60);
    const mediaIds: string[] = [];
    for (let k = 0; k < r.slides.length; k++) {
      const s = r.slides[k];
      const jpg = await D.toJpeg(await D.drawSlide(s, k, r.slides.length, o, await photoOf(u, s)));
      const f = await saveGeneratedFile(u, { fileName: `${safe}_${String(k + 1).padStart(2, '0')}.jpg`, mime: 'image/jpeg', data: jpg, title: `${title} ${k + 1}/${r.slides.length}`, folder: '마케팅/카드뉴스',
        tags: ['카드뉴스', ...(o.brand ? [o.brand] : [])], description: s.imagePlan ? `사진 계획: ${s.imagePlan}` : undefined, source: 'ai', space: 'marketing', meta: { carouselId: id, slide: k + 1 } });
      mediaIds.push(f.id);
    }
    const M = await import('./marketing');
    const [prev] = r.content_id ? await sql<{ status: string }[]>`select status from mkt_contents where id = ${r.content_id} and tenant = ${r.tenant}` : [];
    let contentId: string; let version: number;
    if (prev && prev.status !== 'published') {
      ({ version } = await M.addVersion(u, r.content_id!, { body: r.caption, mediaIds, note: '카드뉴스를 고쳐 다시 그렸습니다' })); contentId = r.content_id!;
    } else {
      const made = await M.createContent(u, { title: r.topic.replace(/\n/g, ' ').slice(0, 200), channel: 'instagram', brandId: r.brand_id, scheduledAt: i.scheduledAt ?? null, mode: 'content', body: r.caption, mediaIds,
        rationale: { purpose: '카드뉴스 — 저장·공유·댓글', message: r.topic.replace(/\n/g, ' ').slice(0, 200), why: `${PATTERNS[r.pattern]} 카드뉴스 ${r.slides.length}장 · 댓글 키워드 '${r.keyword ?? ''}'`.slice(0, 300) } });
      contentId = made.id; version = made.version;
      await sql`update mkt_contents set kind = 'feed' where id = ${contentId}`;
    }
    await sql`update mkt_carousels set status = 'sent', media_ids = ${mediaIds}, content_id = ${contentId}, rendered_at = now(), updated_at = now() where id = ${id}`;
    await audit(sql, u.id, 'mkt.carousel_render', 'mkt_carousel', id, { contentId, version, slides: mediaIds.length }).catch(() => {});
    return { item: (await viewRows(r.tenant, id))[0], contentId, version, mediaIds };
  } finally { await sql`delete from job_locks where name = ${name} and holder = ${holder}`; }
}
