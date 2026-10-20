import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { notify } from './notifications';
import { zUuid } from './api';
import { tenantOf, type SessionUser } from './types';
import { hfGenerate, hfSettings, modelFor } from './higgsfield';

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
  tone: z.string().trim().max(200).nullable().optional(), quantity: z.number().int().min(1).max(5).default(1), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), goalWeek: z.number().int().optional() });
export const promptPatch = z.object({ promptEn: z.string().trim().min(5).max(4000), negativeEn: z.string().trim().max(1000).optional(), summaryKo: z.string().trim().max(1000).optional(), caption: z.string().trim().max(2000).optional(), model: z.string().max(40).nullable().optional(), refMediaIds: z.array(zUuid).max(10).optional() });
export const briefAction = z.discriminatedUnion('action', [z.object({ action: z.literal('prompt') }), z.object({ action: z.literal('update'), ...promptPatch.shape }), z.object({ action: z.literal('generate') }), z.object({ action: z.literal('cancel') })]);

export async function listBriefs(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const briefs = await sql<any[]>`select b.*, br.name as brand, cu.name as created_by_name, c.status as content_status, c.title as content_title,
      (select count(*)::int from mkt_production_requests q where q.brief_id = b.id and q.status in ('open', 'needs_approval')) as open_requests
    from mkt_briefs b left join mkt_brands br on br.id = b.brand_id left join users cu on cu.id = b.created_by left join mkt_contents c on c.id = b.content_id
    where b.tenant = ${t} and b.status <> 'canceled' order by b.created_at desc limit 60`;
  const brands = await sql<{ id: string; name: string; tone: string | null }[]>`select id, name, tone from mkt_brands where tenant = ${t} order by name`;
  const recent = await sql<{ id: string; title: string; channel: string }[]>`select id, title, channel from mkt_contents where tenant = ${t} and not is_test and status in ('published', 'approved') order by coalesce(published_at, scheduled_at) desc nulls last limit 12`;
  const hf = await hfSettings();
  return { briefs, brands, recent, kinds: KIND_SPEC, purposes: PURPOSE, canGenerate: isAdmin(u), provider: hf.enabled ? 'higgsfield' : 'card', models: hf.models.filter((m) => m.enabled).map(({ id, kind, name, credits }) => ({ id, kind, name, credits })) };
}
export async function createBrief(u: SessionUser, i: z.infer<typeof briefInput>) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const spec = KIND_SPEC[i.kind];
  const [b] = await sql<{ id: string }[]>`insert into mkt_briefs (tenant, brand_id, channel, kind, purpose, message, refs, tone, quantity, due_date, status, created_by)
    values (${t}, ${i.brandId ?? null}, ${spec.channel}, ${i.kind}, ${i.purpose}, ${i.message}, ${sql.json({ ...i.refs, goalWeek: i.goalWeek ?? null } as never)}, ${i.tone ?? null}, ${i.quantity}, ${i.dueDate ?? null}, 'queued', ${u.id}) returning id`;
  // 의뢰 즉시 프롬프트 작성(AI) — 실패하면 queued 로 남고 [프롬프트 다시] 로 재시도
  const p = await writePrompt(t, b.id, u.id).catch((e) => ({ error: String(e?.message ?? e) }));
  return { id: b.id, prompt: p };
}

/** AI(경력 30년 마케터·아트디렉터): 브랜드 키트·회사·목적·채널 규격·참고 자료 → 영문 생성 프롬프트 + 한글 요약 + 참고 사진 + 자막 */
export async function writePrompt(tenant: string, briefId: string, actorId: string | null) {
  const sql = db();
  const [b] = await sql<any[]>`select * from mkt_briefs where id = ${briefId} and tenant = ${tenant}`;
  if (!b) throw notFound();
  await sql`update mkt_briefs set status = 'prompting', updated_at = now() where id = ${briefId}`;
  const [brand] = b.brand_id ? await sql<any[]>`select * from mkt_brands where id = ${b.brand_id}` : [];
  const { companyAi } = await import('./ai/persona');
  const co = await companyAi({ tenant } as SessionUser).catch(() => ({} as any));
  const spec = KIND_SPEC[b.kind]; const refs = b.refs ?? {};
  const photos = refs.mediaIds?.length ? await sql<{ id: string; title: string; description: string | null }[]>`select id, title, description from library_files where id = any(${refs.mediaIds}::uuid[]) and tenant = ${tenant} and deleted_at is null` : [];
  const posts = refs.contentIds?.length ? await sql<{ title: string; body: string }[]>`select c.title, v.body from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = any(${refs.contentIds}::uuid[]) and c.tenant = ${tenant}` : [];
  const hf = await hfSettings(); const model = modelFor(hf.models, spec.media);
  const tone = b.tone || brand?.tone || co?.tone || '친절하고 담백하게';
  const fallback = { promptEn: `${spec.media === 'video' ? 'A 15-second vertical video' : 'A photorealistic photo'} for a Korean ${co?.industries?.[0] ?? 'local business'} brand "${brand?.name ?? co?.name ?? ''}": ${b.message}. Natural daylight, candid everyday scene, product/space close-up, warm and slightly humorous mood, minimal AI look (no close-up faces, use hands/back view), clean negative space for a short Korean headline. ${spec.aspect} aspect, ${spec.px}.`,
    negativeEn: 'text artifacts, distorted hands, extra fingers, uncanny faces, watermark, logo, low quality, oversaturated', summaryKo: `${spec.label}: ${PURPOSE[b.purpose]} 목적, 메시지 '${b.message}', 자연광 실사 느낌, ${tone}`, caption: b.message, refMediaIds: photos.map((p) => p.id), aspect: spec.aspect, model: model?.id ?? null, source: 'template' as 'template' | 'ai' };
  let out = fallback;
  const P = await import('./ai/provider');
  if (P.aiEnabled()) {
    try {
      const { assertMktAi } = await import('./mktAuto'); await assertMktAi(tenant);
      const p = P.anthropicProvider({ tier: 'default' });
      const r = await p.chat({
        system: `당신은 경력 30년의 마케터이자 아트디렉터입니다. 이미지·영상 생성 AI(Higgsfield: ${spec.media === 'video' ? 'Kling 계열 영상' : 'GPT Image 계열 실사'})에 넣을 프롬프트를 씁니다. JSON 만.
- promptEn: 영문 생성 프롬프트(장면·피사체·구도·조명·분위기·카피 자리·규격 ${spec.aspect} ${spec.px}). 실사 우선, 생성 인물은 AI 느낌 최소(얼굴 클로즈업 피함). 브랜드 로고·문자를 그리게 하지 않음(글자는 뒤에 렌더).
- negativeEn: 피할 것(영문).
- summaryKo: 의뢰자가 읽을 한글 의도 요약 3줄(왜 이 장면인지).
- caption: 이 시안에 얹을 한국어 자막·카피 1~2줄(브랜드 말투: ${tone}, 금지어: ${(brand?.banned_words ?? []).join(', ') || '없음'}, 과장·최상급 금지, 숫자·가격은 재료에 있는 것만).
- refMediaIds: 아래 참고 사진 중 기준으로 쓸 id 배열(없으면 빈 배열).
${REFERENCE_STYLE}`,
        tools: [], messages: [{ role: 'user', content: `[재료]\n브랜드: ${brand?.name ?? co?.name ?? '(없음)'}${brand?.intro ? `\n소개: ${brand.intro}` : ''}${brand?.products ? `\n주력 상품: ${brand.products}` : ''}${co?.business ? `\n회사 사업: ${co.business}` : ''}${co?.customers ? `\n주요 고객: ${co.customers}` : ''}\n목적: ${PURPOSE[b.purpose]}\n채널·종류: ${spec.label}(${spec.aspect}, ${spec.px})\n핵심 메시지: ${b.message}\n톤: ${tone}\n수량: ${b.quantity}\n${photos.length ? `참고 사진(자료실):\n${photos.map((p) => `- ${p.id} ${p.title}${p.description ? `: ${p.description.slice(0, 100)}` : ''}`).join('\n')}\n` : ''}${posts.length ? `참고 게시물:\n${posts.map((p) => `- ${p.title}: ${String(p.body ?? '').slice(0, 120)}`).join('\n')}\n` : ''}${refs.links?.length ? `레퍼런스 링크: ${refs.links.join(', ')}\n` : ''}` }],
        format: { type: 'object', additionalProperties: false, required: ['promptEn', 'negativeEn', 'summaryKo', 'caption', 'refMediaIds'], properties: { promptEn: { type: 'string' }, negativeEn: { type: 'string' }, summaryKo: { type: 'string' }, caption: { type: 'string' }, refMediaIds: { type: 'array', items: { type: 'string' } } } },
      });
      await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
        values (${tenant}, ${actorId}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${P.costUsd(r.model ?? p.model, r.usage)}, 'marketing_studio')`;
      const o = JSON.parse((r.content as any[]).filter((x) => x.type === 'text').map((x) => x.text).join(''));
      const okIds = new Set(photos.map((p) => p.id));
      out = { promptEn: String(o.promptEn ?? fallback.promptEn).slice(0, 4000), negativeEn: String(o.negativeEn ?? fallback.negativeEn).slice(0, 1000), summaryKo: String(o.summaryKo ?? '').slice(0, 1000), caption: String(o.caption ?? b.message).slice(0, 2000),
        refMediaIds: (Array.isArray(o.refMediaIds) ? o.refMediaIds.filter((x: string) => okIds.has(x)) : fallback.refMediaIds), aspect: spec.aspect, model: model?.id ?? null, source: 'ai' };
    } catch { /* AI 실패·한도 → 기본 프롬프트 */ }
  }
  const est = (model?.credits ?? (spec.media === 'video' ? 80 : 6.5)) * b.quantity;
  await sql`update mkt_briefs set prompt = ${sql.json(out as never)}, est_credits = ${est}, status = 'ready', updated_at = now() where id = ${briefId}`;
  return { ...out, estCredits: est };
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
    const prompt = { ...(b.prompt ?? {}), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), source: 'user' };
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
    const [c] = await sql<{ id: string }[]>`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, is_test, rationale)
      values (${t}, ${b.brand_id ?? null}, ${title}, ${spec.channel}, ${KIND_MAP[b.kind] ?? 'feed'}, ${scheduledAt}, 'draft', 1, ${b.created_by ?? u.id}, ${isTest}, ${sql.json(rationale as never)}) returning id`;
    await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${p.caption ?? b.message}, ${[]}, '제작의뢰실 — 자막·카피', ${u.id})`;
    contentId = c.id;
  }
  const hf = await hfSettings();
  if (hf.enabled) {
    await sql`update mkt_briefs set status = 'generating', content_id = ${contentId}, updated_at = now() where id = ${b.id}`;
    const mediaIds: string[] = []; const errors: string[] = [];
    for (let n = 0; n < b.quantity; n++) {
      const r = await hfGenerate({ kind: spec.media, model: p.model ?? modelFor(hf.models, spec.media)?.id ?? 'gpt_image', prompt: p.promptEn, negative: p.negativeEn, aspect: spec.aspect, seconds: spec.seconds });
      if (!r.ok) { errors.push(r.error); continue; }
      try {
        const { saveUrlToLibrary } = await import('./mktStudioStore');
        mediaIds.push(await saveUrlToLibrary(u, r.url, r.mime, `${spec.label} 시안 ${n + 1} — ${String(b.message).slice(0, 30)}`));
      } catch (e: any) { errors.push(String(e?.message ?? e)); }
    }
    if (mediaIds.length) {
      const { addVersion } = await import('./marketing');
      await addVersion(u, contentId, { body: p.caption ?? b.message, mediaIds, note: `제작의뢰실 생성(${mediaIds.length}장)` });
      await sql`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, created_by, title) values (${t}, ${contentId}, 2, ${spec.media === 'video' ? 'generate_video' : 'generate_image'}, ${Number(b.est_credits)}, '제작의뢰실 생성', ${u.id}, ${title})`;
      await sql`update mkt_briefs set status = 'review', result = ${sql.json({ provider: 'higgsfield', mediaIds, errors } as never)}, updated_at = now() where id = ${b.id}`;
      return { status: 'review', contentId, mediaIds, errors };
    }
    await sql`update mkt_briefs set status = 'failed', error = ${errors.join(' / ').slice(0, 500)}, result = ${sql.json({ provider: 'higgsfield', errors } as never)}, updated_at = now() where id = ${b.id}`;
    return { status: 'failed', contentId, errors };
  }
  // 연동 전: 제작 요청 카드(한도 검사 → needs_approval 가능)에 프롬프트·참고 사진·자막을 담아 로컬 도우미에 전달
  const { requestCard } = await import('./mktAuto');
  const brief = [`[제작의뢰실] ${spec.label} ${spec.px} · ${PURPOSE[b.purpose]} · 수량 ${b.quantity}`, p.summaryKo ? `의도: ${p.summaryKo}` : '', `프롬프트(EN): ${p.promptEn}`, p.negativeEn ? `피할 것: ${p.negativeEn}` : '', p.caption ? `자막: ${p.caption}` : '',
    p.refMediaIds?.length ? `참고 사진: ${p.refMediaIds.map((x: string) => `/api/library/${x}/download?inline=1`).join(' ')}` : '', p.model ? `모델: ${p.model}` : ''].filter(Boolean).join('\n');
  const ids: string[] = [];
  const est = Number(b.est_credits) / Math.max(1, b.quantity);
  for (let n = 0; n < b.quantity; n++) {
    const q = await requestCard({ id: contentId, tenant: t, title }, 1, spec.media, b.quantity > 1 ? `${brief}\n(${n + 1}/${b.quantity})` : brief, est);
    await sql`update mkt_production_requests set brief_id = ${b.id} where id = ${q.id}`; ids.push(q.id);
  }
  await sql`update mkt_briefs set status = 'generating', content_id = ${contentId}, result = ${sql.json({ provider: 'card', requestIds: ids } as never)}, updated_at = now() where id = ${b.id}`;
  await notify(sql, { userIds: await (await import('./mktAuto')).approvers(t), type: 'review_requested', title: `제작 요청 카드 ${ids.length}건: ${title}`, body: '제작의뢰실 프롬프트·참고 사진이 카드에 담겨 있습니다 — 만들어 붙이면 승인 대기로', link: '/s/marketing/automation', entityType: 'mkt_content', entityId: contentId, dedupeKey: `mktbrief:${b.id}` }).catch(() => {});
  return { status: 'generating', contentId, requestIds: ids };
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
