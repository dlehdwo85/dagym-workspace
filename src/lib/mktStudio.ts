import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { zUuid } from './api';
import { tenantOf, type SessionUser } from './types';
import { HF_TERMINAL, hfSettings, hfStatus, hfSubmit, modelFor, modelId, type HfState } from './higgsfield';

/**
 * 대표 10/20 19:00 제작의뢰실: 사용자가 의도를 적으면 AI 비서가 '경력 30년 마케터·아트디렉터'로 Higgsfield 에 넣을 영문 프롬프트 + 한글 요약 + 참고 사진 + 자막을 쓰고,
 * 의뢰자가 [수정]/[생성] → 생성(연동 켜짐: Higgsfield → 자료실 저장 → 새 버전 → 승인 대기 / 연동 전: 제작 요청 카드에 프롬프트·참고 사진을 담아 로컬 도우미에 전달) → 승인함.
 * 프롬프트·근거는 콘텐츠 '근거' 칸에 저장. 월 운영 목표 주간 달력의 빈 칸에서 의뢰가 미리 채워져 들어온다(#111).
 */
export const PURPOSE: Record<string, string> = { awareness: '인지', inquiry: '문의', hiring: '채용', trust: '신뢰', launch: '출시' };
export const KIND_SPEC: Record<string, { label: string; aspect: string; px: string; media: 'image' | 'video'; seconds?: number; channel: string }> = {
  feed: { label: '인스타 피드', aspect: '4:5', px: '1080×1350', media: 'image', channel: 'instagram' }, story: { label: '스토리', aspect: '9:16', px: '1080×1920', media: 'image', channel: 'instagram' },
  reels: { label: '릴스', aspect: '9:16', px: '1080×1920 · 15초', media: 'video', seconds: 15, channel: 'instagram' }, shorts: { label: '유튜브 쇼츠', aspect: '9:16', px: '1080×1920 · 15초', media: 'video', seconds: 15, channel: 'youtube' },
  blog_cover: { label: '블로그 표지', aspect: '16:9', px: '1200×675', media: 'image', channel: 'blog' }, video: { label: '광고 영상', aspect: '16:9', px: '1920×1080 · 15~20초', media: 'video', seconds: 20, channel: 'youtube' },
};
/** 삼립 광고 레퍼런스 특성(대표 10/20): 생활 밀착·따뜻한 유머·제품 클로즈업·자연광·과장 없는 담백한 한 줄 */
const REFERENCE_STYLE = '참고 스타일(삼립 광고 계열): 일상 속 장면, 따뜻하고 살짝 유머 있는 분위기, 제품·공간 클로즈업, 자연광·실사 질감, 과장 없는 담백한 한 줄 카피. 생성 인물은 AI 느낌 최소(얼굴 클로즈업 피하고 뒷모습·손·실루엣), 실사 사진이 있으면 그것을 기준으로.';

export const briefInput = z.object({ brandId: zUuid.nullable().optional(), kind: z.enum(Object.keys(KIND_SPEC) as [string, ...string[]]), purpose: z.enum(Object.keys(PURPOSE) as [string, ...string[]]), message: z.string().trim().min(2).max(300),
  refs: z.object({ mediaIds: z.array(zUuid).max(10).default([]), contentIds: z.array(zUuid).max(5).default([]), links: z.array(z.string().trim().url().max(500)).max(5).default([]) }).default({ mediaIds: [], contentIds: [], links: [] }),
  tone: z.string().trim().max(200).nullable().optional(), quantity: z.number().int().min(1).max(5).default(1), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), goalWeek: z.number().int().optional(),
  /** #499-1 용도: 콘텐츠형(참여) / 광고형(전환) — 첫 줄·구성 안내와 훅 채점이 다름 */
  mode: z.enum(['content', 'ad']).default('content') });
export const promptPatch = z.object({ promptEn: z.string().trim().min(5).max(4000), negativeEn: z.string().trim().max(1000).optional(), summaryKo: z.string().trim().max(1000).optional(), caption: z.string().trim().max(2000).optional(), model: z.string().max(40).nullable().optional(), refMediaIds: z.array(zUuid).max(10).optional() });
export const briefAction = z.discriminatedUnion('action', [z.object({ action: z.literal('prompt') }), z.object({ action: z.literal('update'), ...promptPatch.shape }), z.object({ action: z.literal('generate') }), z.object({ action: z.literal('cancel') })]);

export async function listBriefs(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  // 생성 중인 Higgsfield 의뢰는 화면을 열 때도 한 번 확인(tick 을 기다리지 않게, 기다리지는 않음)
  const pending = await sql<{ id: string }[]>`select id from mkt_briefs where tenant = ${t} and status = 'generating' and result->>'provider' = 'higgsfield' order by updated_at limit 3`;
  for (const x of pending) await pollBrief(x.id).catch(() => {});
  const briefs = await sql<any[]>`select b.*, br.name as brand, cu.name as created_by_name, c.status as content_status, c.title as content_title,
      (select count(*)::int from mkt_production_requests q where q.brief_id = b.id and q.status in ('open', 'needs_approval')) as open_requests
    from mkt_briefs b left join mkt_brands br on br.id = b.brand_id left join users cu on cu.id = b.created_by left join mkt_contents c on c.id = b.content_id
    where b.tenant = ${t} and b.status <> 'canceled' order by b.created_at desc limit 60`;
  const brands = await sql<{ id: string; name: string; tone: string | null }[]>`select id, name, tone from mkt_brands where tenant = ${t} order by name`;
  const recent = await sql<{ id: string; title: string; channel: string }[]>`select id, title, channel from mkt_contents where tenant = ${t} and not is_test and status in ('published', 'approved') order by coalesce(published_at, scheduled_at) desc nulls last limit 12`;
  const hf = await hfSettings();
  // #454 영상: 장면 진행·검수·합성 요약 + 내레이션 키·자료실 화면 캡처·배경음 준비 상태
  const V = await import('./mktVideo');
  for (const b of briefs) b.progress = V.v2Progress(b.result);
  const tts = await (await import('./video/tts')).ttsSettings();
  const [caps, bgm] = await Promise.all([V.videoAssets(t, '영상 화면 캡처'), V.videoAssets(t, '영상 배경음')]);
  return { briefs, brands, recent, kinds: KIND_SPEC, purposes: PURPOSE, canGenerate: isAdmin(u), provider: hf.enabled ? 'higgsfield' : 'card', models: hf.models.filter((m) => m.enabled).map(({ id, kind, name, credits, usd }) => ({ id, kind, name, credits, usd: usd ?? null })), pricing: hf.pricing, usdKrw: hf.usdKrw,
    video: { tts: { ready: tts.ready, provider: tts.provider ? tts.providers[tts.provider].label : null }, captures: caps.length, bgm: bgm.length } };
}
export async function createBrief(u: SessionUser, i: z.infer<typeof briefInput>) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const spec = KIND_SPEC[i.kind];
  const [b] = await sql<{ id: string }[]>`insert into mkt_briefs (tenant, brand_id, channel, kind, purpose, message, refs, tone, quantity, due_date, status, created_by, mode)
    values (${t}, ${i.brandId ?? null}, ${spec.channel}, ${i.kind}, ${i.purpose}, ${i.message}, ${sql.json({ ...i.refs, goalWeek: i.goalWeek ?? null } as never)}, ${i.tone ?? null}, ${i.quantity}, ${i.dueDate ?? null}, 'queued', ${u.id}, ${i.mode}) returning id`;
  // 의뢰 즉시 프롬프트 작성(AI) — 실패하면 queued 로 남고 [프롬프트 다시] 로 재시도
  const p = await writePrompt(t, b.id, u.id).catch((e) => ({ error: String(e?.message ?? e) }));
  return { id: b.id, prompt: p };
}

type Scene = { line: string; visualEn: string };
/** #426 자막 품질: 상투어·특수 대시 정리 + 훅(첫 줄·첫 장면) 점수 + 영상이면 초 단위 장면표(분당 300음절, 규격 초 넘으면 경고) */
function captionQuality(caption: string, scenes: Scene[], spec: { seconds?: number; channel: string }, rules: import('./mktQuality').QualityRules, Q: typeof import('./mktQuality'), mode: import('./mktQuality').HookMode = 'content') {
  const h = Q.humanize(caption, rules);
  const hookText = scenes[0]?.line || h.text.split('\n').map((l) => l.trim()).find(Boolean) || '';
  const timing = scenes.length >= 2 ? Q.scriptTiming(scenes.map((x) => x.line), { ...rules, script: { ...rules.script, maxTotalSec: spec.seconds ?? rules.script.maxTotalSec } }, mode) : null;
  return { caption: h.text, timing, quality: { mode, human: { score: h.score, pass: h.pass, issues: h.issues }, hook: hookText ? Q.scoreHook(hookText, rules, [], mode) : null } };
}
/** Higgsfield 프롬프트에 장면표를 그대로(장면별 초 + 영상 지시) */
export function withShots(promptEn: string, scenes: Scene[] | undefined, timing: { rows: { from: number; to: number }[] } | null | undefined) {
  if (!scenes?.length) return promptEn;
  return `${promptEn}\n\nShot list (keep this timing):\n${scenes.map((x, k) => `${k + 1}. ${timing?.rows[k] ? `${timing.rows[k].from.toFixed(1)}-${timing.rows[k].to.toFixed(1)}s` : ''} ${x.visualEn || x.line}`.replace(/\s+/g, ' ').trim()).join('\n')}`.slice(0, 4000);
}

/** #534 프롬프트 검사 재료: 규격(비율·크기)·브랜드 키트 색(서버 그리기와 같은 색)·자료실 참고 사진 후보(의뢰에 고른 사진이 없을 때 — 시안 바탕 폴더·브랜드 이름 먼저, 글자 든 그래픽·AI 생성 빼고) */
async function promptCtx(tenant: string, b: any, brand: any) {
  const spec = KIND_SPEC[b.kind]; const sql = db();
  const color = await (await import('./mktCarouselDraw')).brandDrawColor(tenant, brand).catch(() => null);
  const V = await import('./mktAutoVisual'); const name = String(brand?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim().toLowerCase();
  const rows = await sql<{ id: string; title: string; file_name: string; description: string | null; folder: string; tags: string[]; vision: unknown }[]>`select id, coalesce(nullif(title, ''), file_name) as title, file_name, description, folder, tags, vision from library_files
    where tenant = ${tenant} and space = 'marketing' and deleted_at is null and upload_status = 'ready' and mime_type in ('image/jpeg', 'image/png', 'image/webp') and coalesce(source, '') <> 'ai'
      and coalesce(security, 'internal') <> 'confidential' order by created_at desc limit 80`;
  const { visionText } = await import('./mktPhotos'); // #235 ⓒ 사진 AI 설명도 브랜드 맞추기에
  const score = (r: (typeof rows)[number]) => (V.backdropOk(r) ? 3 : 0) + (name && `${r.title} ${r.folder} ${(r.tags ?? []).join(' ')} ${r.description ?? ''} ${visionText(r.vision)}`.toLowerCase().includes(name) ? 6 : 0);
  const candidates = rows.filter((r) => !V.textGraphic(r)).map((r) => ({ r, s: score(r) })).sort((x, y) => y.s - x.s).slice(0, 3).map(({ r }) => ({ id: r.id, title: r.title, description: r.description }));
  return { ctx: { aspect: spec.aspect, px: spec.px, video: spec.media === 'video', brandColors: color ? [color] : [], refAvailable: candidates.length } as import('./mktPromptCheck').PromptCtx, candidates };
}

/** AI(경력 30년 마케터·아트디렉터): 브랜드 키트·회사·목적·채널 규격·참고 자료 → 영문 생성 프롬프트 + 한글 요약 + 참고 사진 + 자막
 *  #454 영상은 '국내 대기업 광고 수준' 장면 설계: 장면 3~5개(각 3~5초) · 같은 출연진·룩 · 한국인·한국 배경 · 화면 안 글자 금지 · 실제 화면 캡처 얹을 장면 · 끝 화면 · 배경음 */
export async function writePrompt(tenant: string, briefId: string, actorId: string | null) {
  const sql = db();
  const [b] = await sql<any[]>`select * from mkt_briefs where id = ${briefId} and tenant = ${tenant}`;
  if (!b) throw notFound();
  await sql`update mkt_briefs set status = 'prompting', updated_at = now() where id = ${briefId}`;
  const [brand] = b.brand_id ? await sql<any[]>`select * from mkt_brands where id = ${b.brand_id}` : [];
  const { companyAi } = await import('./ai/persona');
  const co = await companyAi({ tenant } as SessionUser).catch(() => ({} as any));
  const spec = KIND_SPEC[b.kind]; const refs = b.refs ?? {}; const video = spec.media === 'video';
  const picked = refs.mediaIds?.length ? await sql<{ id: string; title: string; description: string | null }[]>`select id, title, description from library_files where id = any(${refs.mediaIds}::uuid[]) and tenant = ${tenant} and deleted_at is null` : [];
  const PC = await promptCtx(tenant, b, brand); // #534 고른 참고 사진이 없으면 자료실 후보(시안 바탕·브랜드 사진)를 AI 에게 보여 주고 연결
  const photos = picked.length ? picked : PC.candidates;
  const mem = await (await import('./mktTeam')).memoryText(tenant, 'designer', b.brand_id ?? null).catch(() => ''); // #534 수정 요청 사유 = 디자인 담당 기억
  const posts = refs.contentIds?.length ? await sql<{ title: string; body: string }[]>`select c.title, v.body from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = any(${refs.contentIds}::uuid[]) and c.tenant = ${tenant}` : [];
  const V = video ? await import('./mktVideo') : null;
  const [caps, bgms] = V ? await Promise.all([V.videoAssets(tenant, '영상 화면 캡처'), V.videoAssets(tenant, '영상 배경음')]) : [[], []];
  const kit = brand?.video ?? {};
  const hf = await hfSettings(); const model = modelFor(hf.models, spec.media);
  const tone = b.tone || brand?.tone || co?.tone || '친절하고 담백하게';
  const Q = await import('./mktQuality'); const rules = await Q.qualityRules(); const voice = Q.voicePrompt(brand?.voice);
  const korean = 'All people are Korean (East Asian) and the setting is clearly South Korea; no text, letters, signage, logos or UI text in frame';
  const fallback = { promptEn: `${video ? `A ${spec.seconds ?? 15}-second ${spec.aspect === '9:16' ? 'vertical ' : ''}Korean TV-commercial-style video` : 'A photorealistic photo'} for a Korean ${co?.industries?.[0] ?? 'local business'} brand "${brand?.name ?? co?.name ?? ''}": ${b.message}. Natural daylight, candid everyday scene, product/space close-up, warm and slightly humorous mood, minimal AI look (no close-up faces, use hands/back view). ${korean}. ${video ? '' : 'Clean negative space for a short Korean headline. '}${spec.aspect} aspect, ${spec.px}.`,
    negativeEn: 'text artifacts, letters, signage, distorted hands, extra fingers, uncanny faces, watermark, logo, low quality, oversaturated, western-style houses, foreign-language signs, non-Korean people', summaryKo: `${spec.label}: ${PURPOSE[b.purpose]} 목적, 메시지 '${b.message}', 자연광 실사 느낌, ${tone}`, caption: b.message, refMediaIds: (picked.length ? picked : photos.slice(0, 1)).map((p) => p.id), aspect: spec.aspect, model: model?.id ?? null, source: 'template' as 'template' | 'ai' };
  let out: Record<string, any> = fallback;
  const P = await import('./ai/provider');
  if (P.aiEnabled()) {
    try {
      const { assertMktAi } = await import('./mktAuto'); await assertMktAi(tenant, { video }); // 영상 기획은 마케팅 크레딧 몫 — 회사 AI 예산 밖
      const p = P.anthropicProvider({ tier: 'default' });
      const target = Math.round((spec.seconds ?? 15) - 2.5 + 0.5 + 3 * 0.4);
      const videoRules = `- 국내 대기업 TV·디지털 광고 수준: 메시지 하나, 첫 3초 훅, 인물의 작은 감정 변화, 제품·서비스가 문제를 푸는 순간, 마지막은 브랜드(끝 화면은 합성 단계가 따로 붙임).
- 모든 인물은 한국인, 배경은 한국(한국 아파트·사무실·카페·거리). 서양식 주택·외국어 간판·영문 화면 금지.
- 화면 안에 글자를 넣지 않음(간판·화면 UI·자막·로고·숫자 모두). 한국어 자막·로고는 합성 단계가 넣음. 휴대폰·모니터 화면은 '부드러운 빛'만.
- character: 모든 장면에 똑같이 쓸 출연진 묘사(영문: 한국인, 나이대·옷·머리). look: 전 장면 공통 색·빛·분위기(영문).
- scenes: 3~5개, 장면마다 seconds 3~5(정수), 합계 약 ${target}초. 한 장면 = 한 동작·한 감정.
  line = 그 장면 한국어 자막 겸 내레이션 한 줄(분당 300음절: 3초 15음절·4초 20음절·5초 25음절 안쪽). 첫 장면 line 이 훅 — 인사·"스크롤 멈추세요" 금지, 구체적 상황·숫자·대상으로.
  visualEn = 그 장면만 읽어도 찍을 수 있는 영문 지시(구도·렌즈·카메라 움직임·빛·동작).
  screenMediaId·device = 아래 '실제 화면 캡처'를 휴대폰(phone)·노트북(laptop) 화면으로 얹을 장면이면 그 id(1~2장면만), 아니면 '' 와 'none'. 얹는 장면의 visualEn 은 흐릿하게 깔릴 배경(책상·사무실 등).
- endCard: headline = 끝 화면 한 줄(12자 안팎), cta = 행동 유도 한 줄${kit.cta ? `(브랜드 키트 값 '${kit.cta}' 그대로)` : ''}.
- bgmId: 아래 '배경음' 중 분위기에 맞는 id(없으면 '').
- promptEn: 전체 콘셉트 한 단락(영문, 장면 전체를 아우름).`;
      const r = await p.chat({
        system: `당신은 경력 30년의 마케터이자 아트디렉터${video ? '(국내 대기업 광고 크리에이티브 디렉터 겸 촬영감독)' : ''}입니다. 이미지·영상 생성 AI(Higgsfield: ${model?.name ?? (video ? 'Kling 계열 영상' : 'SOUL 계열 실사')})에 넣을 프롬프트를 씁니다. JSON 만.
${video ? videoRules : `- promptEn: 영문 생성 프롬프트(장면·피사체·구도·조명·분위기·카피 자리·규격 ${spec.aspect} ${spec.px}). 실사 우선, 생성 인물은 AI 느낌 최소(얼굴 클로즈업 피함). 인물은 한국인, 배경은 한국. 브랜드 로고·간판·문자를 그리게 하지 않음(글자는 뒤에 렌더).`}
- fields: 필수 칸(영문, #534) — who(누가: 한국인, 나이대·옷), where(어디서: 실제 한국 장소), action(무엇을: 한 동작), emotion(작은 감정 변화: from ○○ to ○○), lens(렌즈 mm), angle(앵글: eye-level 등), movement(카메라 움직임: ${video ? 'slow push-in·tracking 등' : '사진은 static'}), light(빛: 시간대·자연광 + 브랜드 키트 색${PC.ctx.brandColors.length ? ` ${PC.ctx.brandColors.join(', ')}` : ''}을 소품·옷·배경 포인트로), props(소품 2~4개).
- promptEn 에 이 칸을 모두 담아 쓰고, 구도는 ${spec.aspect} ${spec.px}·아래 24%는 한국어 자막 자리로 비움(사람·제품을 두지 않음). Props: 줄을 넣음.
- negativeEn: 피할 것(영문 — 화면 글자·로고·외국어 간판·서양식 배경·외국인·손 왜곡·손가락 뭉개짐 포함).
- summaryKo: 의뢰자가 읽을 한글 의도 요약 3줄(왜 이 장면인지).
- caption: 이 시안${video ? '을 올릴 게시물 본문' : '에 얹을'} 한국어 카피 1~2줄(브랜드 말투: ${tone}, 금지어: ${[...(brand?.banned_words ?? []), ...Q.avoidOf(brand?.voice)].join(', ') || '없음'}, 과장·최상급 금지, 숫자·가격은 재료에 있는 것만). 첫 줄이 훅 — 인사·"스크롤 멈추세요"·내용 없는 서두 금지, 숫자·장면·대상으로 구체적으로. 상투어(다양한·혁신적인·놓치지 마세요·지금 바로)·특수 대시(—)는 쓰지 않음.
- refMediaIds: 아래 참고 사진 중 기준으로 쓸 id 배열(없으면 빈 배열).
- 용도 ${Q.MODE_GUIDE[Q.asMode(b.mode)]}
${REFERENCE_STYLE}${voice ? `\n${voice}` : ''}${mem ? `\n${mem}` : ''}`,
        tools: [], messages: [{ role: 'user', content: `[재료]\n브랜드: ${brand?.name ?? co?.name ?? '(없음)'}${brand?.intro ? `\n소개: ${brand.intro}` : ''}${brand?.products ? `\n주력 상품: ${brand.products}` : ''}${co?.business ? `\n회사 사업: ${co.business}` : ''}${co?.customers ? `\n주요 고객: ${co.customers}` : ''}\n목적: ${PURPOSE[b.purpose]}\n용도: ${Q.HOOK_MODES[Q.asMode(b.mode)]}\n채널·종류: ${spec.label}(${spec.aspect}, ${spec.px})\n핵심 메시지: ${b.message}\n톤: ${tone}\n수량: ${b.quantity}\n${photos.length ? `참고 사진(자료실):\n${photos.map((p) => `- ${p.id} ${p.title}${p.description ? `: ${p.description.slice(0, 100)}` : ''}`).join('\n')}\n` : ''}${posts.length ? `참고 게시물:\n${posts.map((p) => `- ${p.title}: ${String(p.body ?? '').slice(0, 120)}`).join('\n')}\n` : ''}${refs.links?.length ? `레퍼런스 링크: ${refs.links.join(', ')}\n` : ''}${refs.concept ? `광고 컨셉(상황 매트릭스에서 채택 — 이 대상·상황·제안을 그대로 살림): 대상 ${refs.concept.role} · 상황 ${refs.concept.situation} · 고통 ${refs.concept.pain || '-'} · 제안 ${refs.concept.offer || '-'}\n첫 줄(훅): ${refs.concept.hook}\n광고 제목: ${refs.concept.headline || '-'}\n본문: ${String(refs.concept.primary ?? '').replace(/\n/g, ' / ')}\n` : ''}${video ? `실제 화면 캡처(자료실 '영상 화면 캡처'):\n${caps.length ? caps.map((c) => `- ${c.id} ${c.title}${c.description ? `: ${c.description.slice(0, 80)}` : ''}`).join('\n') : '(없음 — 화면 얹는 장면 없이)'}\n배경음(자료실 '영상 배경음'):\n${bgms.length ? bgms.map((x) => `- ${x.id} ${x.title}`).join('\n') : '(없음)'}\n` : ''}` }],
        format: { type: 'object', additionalProperties: false, required: ['promptEn', 'negativeEn', 'summaryKo', 'caption', 'refMediaIds', 'fields', ...(video ? ['character', 'look', 'scenes', 'endCard', 'bgmId'] : [])],
          properties: { promptEn: { type: 'string' }, negativeEn: { type: 'string' }, summaryKo: { type: 'string' }, caption: { type: 'string' }, refMediaIds: { type: 'array', items: { type: 'string' } },
            fields: { type: 'object', additionalProperties: false, required: ['who', 'where', 'action', 'emotion', 'lens', 'angle', 'movement', 'light', 'props'], properties: { who: { type: 'string' }, where: { type: 'string' }, action: { type: 'string' }, emotion: { type: 'string' },
              lens: { type: 'string' }, angle: { type: 'string' }, movement: { type: 'string' }, light: { type: 'string' }, props: { type: 'array', items: { type: 'string' } } } },
            ...(video ? { character: { type: 'string' }, look: { type: 'string' }, bgmId: { type: 'string' },
              endCard: { type: 'object', additionalProperties: false, required: ['headline', 'cta'], properties: { headline: { type: 'string' }, cta: { type: 'string' } } },
              scenes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['line', 'visualEn', 'seconds', 'screenMediaId', 'device'],
                properties: { line: { type: 'string' }, visualEn: { type: 'string' }, seconds: { type: 'integer' }, screenMediaId: { type: 'string' }, device: { type: 'string', enum: ['phone', 'laptop', 'none'] } } } } } : {}) } },
      });
      await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
        values (${tenant}, ${actorId}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${P.costUsd(r.model ?? p.model, r.usage)}, ${video ? 'marketing_video_plan' : 'marketing_studio'})`;
      const o = JSON.parse((r.content as any[]).filter((x) => x.type === 'text').map((x) => x.text).join(''));
      const okIds = new Set(photos.map((p) => p.id)); const capIds = new Set(caps.map((c) => c.id)); let screens = 0;
      const scenes = video && Array.isArray(o.scenes) ? o.scenes.map((x: any) => {
        const screen = capIds.has(String(x?.screenMediaId ?? '')) && x?.device !== 'none' && screens < 2 ? (screens++, { mediaId: String(x.screenMediaId), device: x.device === 'laptop' ? 'laptop' : 'phone' }) : null;
        return { line: String(x?.line ?? '').trim().slice(0, 120), visualEn: String(x?.visualEn ?? '').trim().slice(0, 700), seconds: Math.min(5, Math.max(3, Math.round(Number(x?.seconds) || 4))), screen };
      }).filter((x: { line: string; visualEn: string }) => x.line || x.visualEn).slice(0, 5) : [];
      out = { promptEn: String(o.promptEn ?? fallback.promptEn).slice(0, 4000), negativeEn: String(o.negativeEn ?? fallback.negativeEn).slice(0, 1000), summaryKo: String(o.summaryKo ?? '').slice(0, 1000), caption: String(o.caption ?? b.message).slice(0, 2000),
        refMediaIds: (Array.isArray(o.refMediaIds) ? o.refMediaIds.filter((x: string) => okIds.has(x)) : fallback.refMediaIds), aspect: spec.aspect, model: model?.id ?? null, source: 'ai',
        ...(o.fields && typeof o.fields === 'object' ? { fields: o.fields } : {}),
        ...(scenes.length ? { scenes } : {}), ...(video ? { character: String(o.character ?? '').slice(0, 400), look: String(o.look ?? '').slice(0, 300),
          endCard: { headline: String(o.endCard?.headline ?? '').slice(0, 30), cta: String(kit.cta || o.endCard?.cta || '').slice(0, 60) }, bgmId: bgms.some((x) => x.id === o.bgmId) ? o.bgmId : null } : {}) };
    } catch { /* AI 실패·한도 → 기본 프롬프트 */ }
  }
  const est = (model?.credits ?? (video ? 80 : 6.5)) * b.quantity;
  const q = captionQuality(out.caption, (out as { scenes?: Scene[] }).scenes ?? [], spec, rules, Q, Q.asMode(b.mode));
  // #534 프롬프트 검사: 필수 칸 8개 점수 → 빠진 칸은 AI 가 쓴 칸(없으면 기본값)으로 보강 · 참고 사진을 안 골랐으면 자료실 후보 1장 연결
  if (!out.refMediaIds?.length && photos.length) out.refMediaIds = [photos[0].id];
  const pc = (await import('./mktPromptCheck')).supplementPrompt(out as { promptEn: string; negativeEn: string; refMediaIds: string[] }, PC.ctx, out.fields);
  const saved = { ...out, promptEn: pc.promptEn, negativeEn: pc.negativeEn, check: pc.check, caption: q.caption, quality: q.quality, ...(q.timing ? { timing: q.timing } : {}) };
  await sql`update mkt_briefs set prompt = ${sql.json(saved as never)}, est_credits = ${est}, status = 'ready', updated_at = now() where id = ${briefId}`;
  return { ...saved, estCredits: est };
}

export async function actBrief(u: SessionUser, id: string, i: z.infer<typeof briefAction>) {
  await assertSpace(u, 'marketing');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db(); const t = tenantOf(u);
  const [b] = await sql<any[]>`select * from mkt_briefs where id = ${id} and tenant = ${t}`;
  if (!b) throw notFound();
  const mine = b.created_by === u.id;
  if (!mine && !isAdmin(u)) throw forbidden('내 의뢰만 고칠 수 있습니다');
  if (i.action === 'prompt') { if (!['queued', 'ready', 'failed'].includes(b.status)) throw badRequest('프롬프트를 다시 쓸 단계가 아닙니다'); return writePrompt(t, id, u.id); }
  if (i.action === 'update') {
    if (!['ready', 'failed'].includes(b.status)) throw badRequest('생성 전에만 고칠 수 있습니다');
    const { action: _a, ...patch } = i; void _a;
    const prompt: Record<string, any> = { ...(b.prompt ?? {}), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), source: 'user' };
    // 사람이 고친 자막은 그대로 두고 점수만 다시(자동으로 고치는 건 AI 가 쓴 자막만)
    if (patch.caption !== undefined) { const Q = await import('./mktQuality'); prompt.quality = captionQuality(patch.caption, prompt.scenes ?? [], KIND_SPEC[b.kind], await Q.qualityRules(), Q, Q.asMode(b.mode)).quality; }
    // #534 사람이 고친 프롬프트도 다시 검사 — 빠진 필수 칸은 AI 가 쓴 칸(없으면 기본값)으로 끝에 붙임
    const [brand] = b.brand_id ? await sql<any[]>`select * from mkt_brands where id = ${b.brand_id}` : [];
    const pc = (await import('./mktPromptCheck')).supplementPrompt(prompt as { promptEn: string }, (await promptCtx(t, b, brand)).ctx, prompt.fields);
    Object.assign(prompt, { promptEn: pc.promptEn, negativeEn: pc.negativeEn, check: pc.check });
    await sql`update mkt_briefs set prompt = ${sql.json(prompt as never)}, updated_at = now() where id = ${id}`;
    return { ok: true, prompt };
  }
  if (i.action === 'cancel') {
    if (['review', 'published'].includes(b.status)) throw badRequest('이미 시안이 올라간 의뢰입니다');
    await sql`update mkt_briefs set status = 'canceled', updated_at = now() where id = ${id}`;
    await sql`update mkt_production_requests set status = 'canceled', decided_by = ${u.id}, decided_at = now() where brief_id = ${id} and status in ('open', 'needs_approval')`;
    return { ok: true };
  }
  if (!isAdmin(u)) throw forbidden('생성은 관리자가 누릅니다(크레딧이 듭니다)');
  if (b.status !== 'ready' && b.status !== 'failed') throw badRequest('프롬프트가 준비된 의뢰만 생성할 수 있습니다');
  return generateBrief(u, b);
}

/** 생성: 콘텐츠(초안) + (연동 켜짐) Higgsfield → 자료실 → 새 버전 → 승인 대기 / (연동 전) 제작 요청 카드(프롬프트·참고 사진 포함) → 로컬 도우미가 [제작 완료]로 붙이면 승인 대기 */
async function generateBrief(u: SessionUser, b: any) {
  const sql = db(); const t = tenantOf(u); const spec = KIND_SPEC[b.kind]; const p = b.prompt ?? {};
  const [brand] = b.brand_id ? await sql<any[]>`select name, test_mode from mkt_brands where id = ${b.brand_id}` : [];
  const isTest = !!brand?.test_mode;
  const title = `${isTest ? '[시험] ' : ''}${spec.label} · ${String(b.message).slice(0, 60)}`;
  const scheduledAt = b.due_date ? new Date(`${b.due_date}T10:00:00+09:00`) : null;
  const { KIND_MAP } = { KIND_MAP: { feed: 'feed', story: 'story', reels: 'reels', shorts: 'shorts', blog_cover: 'blog', video: 'video' } as Record<string, string> };
  const rationale = { purpose: PURPOSE[b.purpose], metric: null, message: b.message, why: p.summaryKo ? String(p.summaryKo).split('\n')[0].slice(0, 200) : `제작의뢰실 의뢰(${PURPOSE[b.purpose]})`, source: 'user', topic: b.message, prompt: { en: p.promptEn, negative: p.negativeEn, model: p.model, aspect: p.aspect } };
  let contentId: string = b.content_id;
  if (!contentId) {
    const [c] = await sql<{ id: string }[]>`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, is_test, rationale, mode)
      values (${t}, ${b.brand_id ?? null}, ${title}, ${spec.channel}, ${KIND_MAP[b.kind] ?? 'feed'}, ${scheduledAt}, 'draft', 1, ${b.created_by ?? u.id}, ${isTest}, ${sql.json(rationale as never)}, ${b.mode ?? 'content'}) returning id`;
    await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${p.caption ?? b.message}, ${[]}, '제작의뢰실 — 자막·카피', ${u.id})`;
    contentId = c.id;
  }
  const hf = await hfSettings();
  if (hf.enabled) {
    // 로컬 10/22: 실제 API 는 비동기 — 제출(요청 id 저장) → 상태 폴링 → 완료 시 자료실 저장. 이미지는 잠깐 기다려 보고, 남은 건 tick(hfPollTick)이 이어받음
    const model = modelId(p.model) ?? modelFor(hf.models, spec.media)?.id;
    // #454 영상은 장면별 생성 → 검수 → 서버 합성(mktVideo)
    if (spec.media === 'video' && model) return (await import('./mktVideo')).startV2(b, contentId, model);
    const jobs: HfJob[] = []; const errors: string[] = [];
    if (!model) errors.push(`쓸 수 있는 ${spec.media === 'video' ? '영상' : '이미지'} 모델이 없습니다(플랫폼 운영 › 모델 표)`);
    else for (let n = 0; n < b.quantity; n++) {
      const r = await hfSubmit({ kind: spec.media, model, prompt: withShots(p.promptEn, p.scenes, p.timing), negative: p.negativeEn, aspect: spec.aspect, seconds: spec.seconds, idempotencyKey: randomUUID() });
      if (r.ok) jobs.push({ n, requestId: r.requestId, statusUrl: r.statusUrl, status: 'queued', mediaIds: [] }); else errors.push(r.error);
    }
    if (!jobs.length) {
      await sql`update mkt_briefs set status = 'failed', content_id = ${contentId}, error = ${errors.join(' / ').slice(0, 500)}, result = ${sql.json({ provider: 'higgsfield', model, errors } as never)}, updated_at = now() where id = ${b.id}`;
      return { status: 'failed', contentId, errors };
    }
    await sql`update mkt_briefs set status = 'generating', content_id = ${contentId}, error = null, result = ${sql.json({ provider: 'higgsfield', model, jobs, errors, mediaIds: [] } as never)}, updated_at = now() where id = ${b.id}`;
    const out = await pollBrief(b.id, { waitMs: spec.media === 'image' ? 40000 : 5000 });
    return { ...out, contentId };
  }
  // 연동 전: 제작 요청 카드(한도 검사 → needs_approval 가능)에 프롬프트·참고 사진·자막을 담아 로컬 도우미에 전달
  const { requestCard } = await import('./mktAuto');
  const brief = [`[제작의뢰실] ${spec.label} ${spec.px} · ${PURPOSE[b.purpose]} · 수량 ${b.quantity}`, p.summaryKo ? `의도: ${p.summaryKo}` : '', `프롬프트(EN): ${withShots(p.promptEn, p.scenes, p.timing)}`, p.negativeEn ? `피할 것: ${p.negativeEn}` : '', p.caption ? `자막: ${p.caption}` : '',
    p.timing ? (await import('./mktQuality')).timingText(p.timing) : '',
    p.refMediaIds?.length ? `참고 사진: ${p.refMediaIds.map((x: string) => `/api/library/${x}/download?inline=1`).join(' ')}` : '', p.model ? `모델: ${p.model}` : ''].filter(Boolean).join('\n');
  const ids: string[] = [];
  const est = Number(b.est_credits) / Math.max(1, b.quantity);
  for (let n = 0; n < b.quantity; n++) {
    const q = await requestCard({ id: contentId, tenant: t, title }, 1, spec.media, b.quantity > 1 ? `${brief}\n(${n + 1}/${b.quantity})` : brief, est);
    await sql`update mkt_production_requests set brief_id = ${b.id} where id = ${q.id}`; ids.push(q.id);
  }
  await sql`update mkt_briefs set status = 'generating', content_id = ${contentId}, result = ${sql.json({ provider: 'card', requestIds: ids } as never)}, updated_at = now() where id = ${b.id}`;
  await (await import('./mktAuto')).mktNotify(sql, { tenant: t, brand_id: b.brand_id ?? null, is_test: isTest, created_by: u.id }, u.id, { approval: true, type: 'review_requested', title: `제작 요청 카드 ${ids.length}건: ${title}`, body: '제작의뢰실 프롬프트·참고 사진이 카드에 담겨 있습니다 — 만들어 붙이면 승인 대기로', link: '/s/marketing/automation', entityType: 'mkt_content', entityId: contentId, dedupeKey: `mktbrief:${b.id}` }).catch(() => {});
  return { status: 'generating', contentId, requestIds: ids };
}

type HfJob = { n: number; requestId: string; statusUrl: string; status: HfState | 'timeout'; mediaIds: string[]; error?: string };
const HF_TIMEOUT_MIN = 30; // 영상도 이 안에 끝남 — 넘으면 남은 요청은 실패로(과금은 Higgsfield 가 완료분만)
/** 생성 요청 상태 확인 → 완료분 자료실 저장 → 모두 끝나면 새 버전·승인 대기(또는 실패). 동시에 둘이 돌지 않게 result.pollAt 으로 잡는다 */
export async function pollBrief(briefId: string, opt: { waitMs?: number } = {}): Promise<{ status: string; mediaIds?: string[]; errors?: string[] }> {
  const sql = db(); const until = Date.now() + (opt.waitMs ?? 0); let delay = 2000;
  const [pl] = await sql<{ p: string | null }[]>`select result->>'pipeline' as p from mkt_briefs where id = ${briefId}`;
  if (pl?.p === 'v2') return (await import('./mktVideo')).pollV2(briefId, opt);
  for (;;) {
    const [b] = await sql<any[]>`update mkt_briefs set result = result || jsonb_build_object('pollAt', now()) where id = ${briefId} and status = 'generating' and result->>'provider' = 'higgsfield'
      and coalesce((result->>'pollAt')::timestamptz, 'epoch') < now() - interval '3 minutes' returning *`;
    if (!b) { const [x] = await sql<any[]>`select status, result from mkt_briefs where id = ${briefId}`; return { status: x?.status ?? 'missing', mediaIds: x?.result?.mediaIds, errors: x?.result?.errors }; }
    const r = b.result; const jobs: HfJob[] = r.jobs ?? []; const errors: string[] = [...(r.errors ?? [])];
    const spec = KIND_SPEC[b.kind]; const old = Date.now() - new Date(b.updated_at).getTime() > HF_TIMEOUT_MIN * 60000;
    let actor: SessionUser | null = null;
    for (const j of jobs) {
      if (HF_TERMINAL.has(j.status as HfState) || j.status === 'timeout') continue;
      const st = await hfStatus(j.requestId, j.statusUrl);
      if (!st.ok) { if (!st.retry || old) { j.status = st.retry ? 'timeout' : 'failed'; j.error = st.error; errors.push(st.error); } continue; }
      if (st.status === 'completed') {
        try {
          actor ??= await actorFor(b.created_by);
          const { saveUrlToLibrary } = await import('./mktStudioStore');
          for (const [k, url] of st.urls.entries()) j.mediaIds.push(await saveUrlToLibrary(actor, url, spec.media === 'video' ? 'video/mp4' : 'image/png', `${spec.label} 시안 ${j.n + 1}${st.urls.length > 1 ? `-${k + 1}` : ''} — ${String(b.message).slice(0, 30)}`));
          j.status = 'completed'; if (!st.urls.length) { j.error = '완료됐지만 결과 주소가 없음'; errors.push(j.error); }
        } catch (e: any) { j.status = 'failed'; j.error = String(e?.message ?? e).slice(0, 200); errors.push(j.error); }
      } else if (HF_TERMINAL.has(st.status)) { j.status = st.status; j.error = st.error ?? `생성 ${st.status}`; errors.push(j.error); }
      else if (old) { j.status = 'timeout'; j.error = `${HF_TIMEOUT_MIN}분 안에 끝나지 않음`; errors.push(j.error); }
      else j.status = st.status;
    }
    const mediaIds = jobs.flatMap((j) => j.mediaIds); const done = jobs.every((j) => HF_TERMINAL.has(j.status as HfState) || j.status === 'timeout');
    if (!done) {
      await sql`update mkt_briefs set result = ${sql.json({ ...r, jobs, errors, mediaIds, pollAt: null } as never)} where id = ${briefId}`;
      if (Date.now() + delay > until) return { status: 'generating', mediaIds, errors };
      await new Promise((ok) => setTimeout(ok, delay)); delay = Math.min(delay * 1.5, 10000); continue;
    }
    if (!mediaIds.length) {
      await sql`update mkt_briefs set status = 'failed', error = ${errors.join(' / ').slice(0, 500) || '생성 실패'}, result = ${sql.json({ ...r, jobs, errors, mediaIds, pollAt: null } as never)}, updated_at = now() where id = ${briefId}`;
      return { status: 'failed', errors };
    }
    actor ??= await actorFor(b.created_by);
    const p = b.prompt ?? {}; const t = b.tenant;
    const { addVersion } = await import('./marketing');
    const v = await addVersion(actor, b.content_id, { body: p.caption ?? b.message, mediaIds, note: `제작의뢰실 생성(${mediaIds.length}${spec.media === 'video' ? '편' : '장'} · ${r.model})` });
    const [c] = await sql<{ title: string }[]>`select title from mkt_contents where id = ${b.content_id}`;
    await sql`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, created_by, title) values (${t}, ${b.content_id}, ${(v as any)?.version ?? 2}, ${spec.media === 'video' ? 'generate_video' : 'generate_image'}, ${Number(b.est_credits)}, ${`제작의뢰실 생성 · ${r.model}`}, ${b.created_by}, ${c?.title ?? ''})`;
    // 새 버전 알림(재승인 대기)은 addVersion 이 보냄
    await sql`update mkt_briefs set status = 'review', error = ${errors.length ? errors.join(' / ').slice(0, 500) : null}, result = ${sql.json({ ...r, jobs, errors, mediaIds, pollAt: null } as never)}, updated_at = now() where id = ${briefId}`;
    return { status: 'review', mediaIds, errors };
  }
}
/** tick: 생성 중인 Higgsfield 의뢰 상태 이어받기(한 번에 5건, 기다리지 않음) */
export async function hfPollTick() {
  const rows = await db()<{ id: string }[]>`select id from mkt_briefs where status = 'generating' and result->>'provider' = 'higgsfield' order by updated_at limit 5`;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.id] = (await pollBrief(r.id).catch((e) => ({ status: `error ${String(e?.message ?? e).slice(0, 80)}` }))).status;
  return { checked: rows.length, out };
}
/** tick·폴링에서 의뢰자 권한으로 자료실 저장·새 버전(세션 없이) — 계정이 막혔으면 실패로 남김 */
export async function actorFor(userId: string): Promise<SessionUser> {
  const [r] = await db()<any[]>`select u.id, u.email, u.name, u.role, u.status, u.timezone, u.is_demo, u.platform_admin, u.tenant, t.kind from users u join tenants t on t.id = u.tenant where u.id = ${userId} and u.status = 'active' and t.status = 'active'`;
  if (!r) throw new Error('의뢰자 계정을 쓸 수 없어 결과를 저장하지 못했습니다');
  return { id: r.id, email: r.email, name: r.name, role: r.role, status: r.status, timezone: r.timezone, sessionId: '', isDemo: r.is_demo, platformAdmin: r.platform_admin, tenant: r.tenant, personal: r.kind === 'personal' } as SessionUser;
}

/** 제작 요청 카드가 [제작 완료]/[취소]되면 의뢰 상태를 따라가게(mktAuto.actRequest 에서 부름) */
export async function onRequestSettled(requestId: string, outcome: 'done' | 'canceled') {
  const sql = db();
  const [q] = await sql<{ brief_id: string | null }[]>`select brief_id from mkt_production_requests where id = ${requestId}`;
  if (!q?.brief_id) return;
  const [left] = await sql<{ n: number }[]>`select count(*)::int as n from mkt_production_requests where brief_id = ${q.brief_id} and status in ('open', 'needs_approval')`;
  if (outcome === 'done') await sql`update mkt_briefs set status = 'review', updated_at = now() where id = ${q.brief_id} and status = 'generating'`;
  else if (!left.n) await sql`update mkt_briefs set status = 'failed', error = '제작 요청이 모두 취소됨', updated_at = now() where id = ${q.brief_id} and status = 'generating'`;
}
/** 콘텐츠 게시·반려가 의뢰 상태에 비침(목록 조회 때) */
export const briefStatusLabel = (s: string, contentStatus?: string | null) => contentStatus === 'published' ? '게시됨' : contentStatus === 'changes' && s === 'review' ? '수정 요청' : ({ queued: '대기', prompting: '프롬프트 작성 중', ready: '프롬프트 준비', generating: '생성 중', review: '승인 대기', published: '게시됨', rejected: '반려', failed: '실패', canceled: '취소' } as Record<string, string>)[s] ?? s;
