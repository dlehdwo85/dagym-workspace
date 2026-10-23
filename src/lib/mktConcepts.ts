import { after } from 'next/server';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { zUuid } from './api';
import { tenantOf, type SessionUser } from './types';
import { aiJson, MAX_REVISIONS } from './mktOps';
import { KIND_SPEC, briefStatusLabel } from './mktStudio';

/**
 * #499-4 상황 매트릭스 소재 생성기(테크트리 EP.12 '경우의 수 쪼개기' — docs/handoff/TECHTREE_VIDEOS_2026-10-23.md 3장 B-2).
 * 입력: 제품·서비스 + 구매자 역할(입대의·관리소장…) × 상황(입주 전·운영 중 문제·재계약…, 상황마다 고통·제안)
 * → AI(경력 30년 퍼포먼스 마케터)가 '대상 × 상황' 표에서 컨셉 후보 8~12개(광고형 첫 줄·제목·본문·각도·형식) → 운영실·승인함 '광고 컨셉'
 * → 대표가 1~4개 채택 → 채택한 컨셉마다 광고형(#499-1) 제작 의뢰(제작의뢰실 — 프롬프트는 응답 뒤 바로 작성), 나머지는 반려로 기록.
 * 채택·반려 기록 = 같은 브랜드 다음 매트릭스의 AI 재료(브랜드 기억). 반려 사유 → AI 고친 안(최대 3판). 채택한 컨셉 → [새 각도](대상·상황은 그대로, 형식·각도만 바꾼 4~6개).
 * 숫자·실적·가격은 재료에 있는 것만 — 없으면 {{ }} 로 비워 둠(훅 채점에서 '채우지 않은 자리표시'로 걸림). AI 가 없거나 한도면 역할×상황 기본 조합.
 */
const line = (max: number) => z.string().trim().min(1).max(max);
const situationInput = z.object({ name: line(40), pain: z.string().trim().max(120).default(''), offer: z.string().trim().max(80).default('') });
export const conceptSetInput = z.object({ brandId: zUuid.nullable().optional(), product: z.string().trim().min(2).max(120), roles: z.array(line(30)).min(1).max(6),
  situations: z.array(situationInput).min(1).max(6), note: z.string().trim().max(300).optional(), count: z.number().int().min(4).max(12).default(10) });
export const conceptSuggestInput = z.object({ brandId: zUuid.nullable().optional() });
export const conceptAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('adopt'), conceptIds: z.array(z.string().min(1).max(10)).min(1, '채택할 컨셉을 골라 주세요').max(4, '한 번에 4개까지 채택합니다'), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('reject'), note: z.string().trim().min(1, '반려 사유를 적어 주세요').max(500) }), z.object({ action: z.literal('cancel') })]);
export const conceptVariantInput = z.object({ conceptId: z.string().min(1).max(10) });

type Situation = z.infer<typeof situationInput>;
type Input = { roles: string[]; situations: Situation[]; note?: string; count: number; variantOf?: { setId: string; conceptId: string; hook: string } };
export type Concept = { id: string; role: string; situation: string; pain: string; offer: string; hook: string; headline: string; primary: string; angle: string; format: 'video' | 'image';
  score: { score: number; pass: boolean; fails: string[]; notes: string[] } | null; decision: 'adopted' | 'rejected' | null };
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const uniq = (xs: string[]) => [...new Map(xs.map((x) => [x.replace(/\s+/g, '').toLowerCase(), x])).values()];
const splitList = (s: string) => uniq(String(s ?? '').split(/[,·/|\n]+/).map((x) => clip(x, 30)).filter((x) => x.length >= 2));

/** 재료: 회사·브랜드 소개·주력 상품·말투 프로필 + 금지어 */
async function material(tenant: string, brandId: string | null) {
  const sql = db();
  const [brand] = brandId ? await sql<any[]>`select id, name, intro, products, voice, banned_words from mkt_brands where id = ${brandId} and tenant = ${tenant}` : [];
  if (brandId && !brand) throw notFound();
  const { companyAi } = await import('./ai/persona');
  const co = await companyAi({ tenant } as SessionUser).catch(() => ({} as any));
  const Q = await import('./mktQuality');
  const text = [`회사: ${co?.name ?? ''}${co?.industries?.length ? ` (${co.industries.join('·')})` : ''}`, co?.business ? `사업: ${co.business}` : '', co?.customers ? `주요 고객: ${co.customers}` : '',
    brand ? `브랜드: ${brand.name}${brand.intro ? ` — ${String(brand.intro).slice(0, 200)}` : ''}` : '', brand?.products ? `주력 상품: ${String(brand.products).slice(0, 200)}` : '', Q.voicePrompt(brand?.voice)].filter(Boolean).join('\n');
  return { brand: brand ?? null, co, text, banned: [...(brand?.banned_words ?? []), ...Q.avoidOf(brand?.voice)] as string[] };
}
/** 브랜드 기억: 같은 브랜드(브랜드 없으면 브랜드 없는 것)의 최근 결정 3묶음 — 채택·반려한 컨셉과 결정 메모 */
async function memoryOf(tenant: string, brandId: string | null) {
  const rows = await db()<{ concepts: Concept[]; decision_note: string | null }[]>`select concepts, decision_note from mkt_concept_sets
    where tenant = ${tenant} and brand_id is not distinct from ${brandId} and status in ('decided', 'rejected') order by coalesce(decided_at, updated_at) desc limit 3`;
  const pick = (d: string) => rows.flatMap((r) => (r.concepts ?? []).filter((c) => c.decision === d)).slice(0, 8);
  const adopted = pick('adopted'), rejected = pick('rejected'); const notes = rows.map((r) => r.decision_note).filter((x): x is string => !!x).slice(0, 3);
  const team = await (await import('./mktTeam')).memoryText(tenant, 'adsetter', brandId, { notesOnly: true }).catch(() => ''); // #499-7 광고 세팅 담당에게 남긴 대표 메모
  if (!adopted.length && !rejected.length) return team;
  return [`[이전 결정 — 브랜드 기억]`, adopted.length && `채택: ${adopted.map((c) => `${c.role}·${c.situation} «${c.hook}»`).join(' / ')}`,
    rejected.length && `반려: ${rejected.map((c) => `«${c.hook}»`).join(' / ')}`, notes.length && `대표 메모: ${notes.join(' / ')}`, team].filter(Boolean).join('\n');
}

/** 역할×상황 기본 조합(AI 없음·한도): 상황을 돌아가며 n개 — 같은 상황이 몰리지 않게 */
function templateConcepts(input: Input, n: number) {
  const bySit = input.situations.map((s) => input.roles.map((r) => ({ s, r })));
  const pairs: { s: Situation; r: string }[] = [];
  for (let k = 0; pairs.length < n && k < input.roles.length; k++) for (const col of bySit) if (col[k] && pairs.length < n) pairs.push(col[k]);
  return pairs.map(({ s, r }, k) => { const offer = s.offer || '무료 상담';
    return { role: r, situation: s.name, pain: s.pain, offer, hook: `${s.name}, ${r}께 ${offer}`, headline: offer, primary: `${s.name} — ${s.pain || '고민이 있으신가요?'}\n${offer}로 먼저 확인해 보세요.\n양식에 남기시면 담당자가 연락드립니다.`,
      angle: `${r}의 '${s.name}' 고민을 첫 줄에서 바로 지목`, format: k % 2 ? 'video' : 'image' }; });
}

const FORMAT = { type: 'object', additionalProperties: false, required: ['concepts', 'changes'], properties: { changes: { type: 'string' }, concepts: { type: 'array', items: { type: 'object', additionalProperties: false,
  required: ['role', 'situation', 'pain', 'offer', 'hook', 'headline', 'primary', 'angle', 'format'], properties: { role: { type: 'string' }, situation: { type: 'string' }, pain: { type: 'string' }, offer: { type: 'string' },
    hook: { type: 'string' }, headline: { type: 'string' }, primary: { type: 'string' }, angle: { type: 'string' }, format: { type: 'string', enum: ['video', 'image'] } } } } } };
/** AI(없으면 기본 조합)로 컨셉 n개 → 정리·광고형 훅 채점·금지어. revise 면 AI 가 실패했을 때 null(기본 조합으로 고친 안을 만들지 않음) */
async function generate(tenant: string, actorId: string | null, product: string, input: Input, brandId: string | null, revise?: { note: string; prev: Concept[]; version: number }) {
  const m = await material(tenant, brandId);
  const Q = await import('./mktQuality'); const rules = await Q.qualityRules();
  const n = input.variantOf ? Math.min(6, input.count) : input.count;
  const mem = await memoryOf(tenant, brandId);
  let raw: any[] = []; let source: 'ai' | 'template' = 'template'; let changes: string | null = null;
  try {
    const o = await aiJson(tenant, actorId, `당신은 경력 30년의 퍼포먼스 마케터입니다. '상황 매트릭스'(구매자 역할 × 상황)로 광고 컨셉 후보를 만듭니다. JSON 만.
- 컨셉 ${n}개. [역할] × [상황] 표에서 가장 그럴듯한 조합부터 고르고, 같은 역할·상황 조합은 최대 2개(그때는 형식·각도가 달라야 함). role·situation 은 입력의 이름을 그대로 씁니다.
- 각 컨셉: pain(그 사람이 그 상황에서 겪는 고통 한 줄), offer(제안 — 입력의 제안 그대로, 없으면 무료 진단·체크리스트·비교표·시연처럼 비용이 들지 않는 것), hook(광고 첫 줄 40자 안 — 첫 2초에 대상·상황을 부르고 무엇을 주는지), headline(광고 제목 30자 안), primary(본문 2~3줄: 지목 → 제안 → 문제 한 줄 → 장점 → 행동 1개), angle(왜 이 사람에게 먹히는지 한 줄), format(video = 15초 세로 영상 · image = 정지 이미지 4:5).
- ${Q.MODE_GUIDE.ad}
- 숫자·실적·가격·기간은 [재료]에 있는 것만. 없으면 {{운영 단지 수}}처럼 비워 둡니다(지어내지 않음). 과장·최상급(최고·유일·1위·보장) 금지.
- 색·모델·단어 한두 개만 바꾼 변주는 같은 컨셉입니다 — 컨셉끼리 대상·상황·제안·각도가 달라야 합니다.
- [이전 결정]이 있으면 채택된 방향은 살리고 반려된 것과 비슷한 컨셉은 피합니다.${input.variantOf ? `
- [새 각도] 이긴 컨셉의 대상·상황은 그대로 두고 형식·각도(체크리스트형·전후 비교·고객 질문·현장 장면·숫자형 등)만 바꾼 새 컨셉을 만듭니다. 이긴 컨셉의 첫 줄과 비슷하면 안 됩니다.` : ''}${revise ? `
- 이전 안이 반려되었습니다. 반려 사유를 반영해 다시 만들고, changes 에 "반려 사유 → 반영한 점"을 2~3문장으로 씁니다. 반려가 아니면 changes 는 빈 문자열.` : `
- changes 는 빈 문자열.`}`,
      `[재료]\n${m.text}\n제품·서비스: ${product}\n[역할] ${input.roles.join(' / ')}\n[상황]\n${input.situations.map((s) => `- ${s.name}: 고통 ${s.pain || '(없음)'} · 제안 ${s.offer || '(없음)'}`).join('\n')}${input.note ? `\n메모: ${input.note}` : ''}${mem ? `\n${mem}` : ''}${input.variantOf ? `\n[새 각도 — 이긴 컨셉] ${input.roles[0]} · ${input.situations[0].name} «${input.variantOf.hook}»` : ''}${revise ? `\n\n[이전 안 v${revise.version}]\n${revise.prev.map((c) => `- ${c.role}·${c.situation} «${c.hook}»`).join('\n')}\n[반려 사유] ${revise.note}` : ''}`,
      FORMAT, 'marketing_concepts');
    if (Array.isArray(o?.concepts) && o.concepts.length) { raw = o.concepts; source = 'ai'; changes = clip(o.changes, 600) || null; }
  } catch { /* AI 실패·한도 → 기본 조합 */ }
  if (!raw.length) { if (revise) return null; raw = templateConcepts(input, n); }
  const concepts: Concept[] = raw.slice(0, 12).map((c: any, k: number) => {
    const situation = clip(c.situation, 40) || input.situations[k % input.situations.length].name; const sit = input.situations.find((s) => s.name === situation);
    const hook = clip(c.hook, 80); const headline = clip(c.headline, 60); const primary = String(c.primary ?? '').replace(/\r/g, '').trim().slice(0, 400);
    const s = hook ? Q.scoreHook(hook, rules, [], 'ad') : null;
    const banned = m.banned.filter((w) => w && [hook, headline, primary].some((t) => t.includes(w)));
    return { id: `c${k + 1}`, role: clip(c.role, 30) || input.roles[k % input.roles.length], situation, pain: clip(c.pain, 120) || sit?.pain || '', offer: clip(c.offer, 80) || sit?.offer || '',
      hook, headline, primary, angle: clip(c.angle, 200), format: c.format === 'video' ? 'video' : 'image',
      score: s ? { score: s.score, pass: s.pass && !banned.length, fails: [...s.fails, ...banned.map((w) => `금지어 '${w}'`)], notes: s.notes ?? [] } : null, decision: null };
  });
  return { concepts, source, changes };
}
function normInput(i: z.infer<typeof conceptSetInput>): Input {
  const sits = [...new Map(i.situations.map((s) => [s.name.replace(/\s+/g, '').toLowerCase(), s])).values()];
  return { roles: uniq(i.roles), situations: sits, ...(i.note ? { note: i.note } : {}), count: i.count };
}

async function notifyNew(tenant: string, id: string, n: number, product: string, brand: string | null, version: number) {
  await (await import('./spaceNotify')).notifySpace(db(), { tenant, space: 'marketing', approval: true, type: 'review_requested', title: `광고 컨셉 ${n}개${brand ? ` · ${brand}` : ''} — 1~4개를 채택해 주세요${version > 1 ? ` (v${version}, 반려 반영)` : ''}`,
    body: product, link: '/s/marketing/approvals?tab=concepts', entityType: 'mkt_concept_set', entityId: id, dedupeKey: `mktconcept:${id}`, push: version > 1 }).catch(() => {});
}
async function insertSet(tenant: string, actorId: string, brandId: string | null, product: string, input: Input, g: { concepts: Concept[]; source: 'ai' | 'template'; changes: string | null }, rev?: { version: number; thread: string; from: string }) {
  const sql = db();
  const [s] = await sql<{ id: string }[]>`insert into mkt_concept_sets (tenant, brand_id, product, input, concepts, source, created_by, version, thread_id, revised_from, revision_note)
    values (${tenant}, ${brandId}, ${product}, ${sql.json(input as never)}, ${sql.json(g.concepts as never)}, ${g.source}, ${actorId}, ${rev?.version ?? 1}, ${rev?.thread ?? null}, ${rev?.from ?? null}, ${rev ? g.changes : null}) returning id`;
  const [b] = brandId ? await sql<{ name: string }[]>`select name from mkt_brands where id = ${brandId}` : [];
  await notifyNew(tenant, s.id, g.concepts.length, product, b?.name ?? null, rev?.version ?? 1);
  return s.id;
}

/** 운영실·승인함에 보이는 모양: 채택한 컨셉의 제작 의뢰 상태까지 */
async function viewSets(tenant: string, where: 'pending' | 'recent', id?: string) {
  const sql = db();
  const sets = await sql<any[]>`select s.id, s.brand_id, b.name as brand, s.product, s.input, s.concepts, s.status, s.source, s.version, s.revision_note, s.decision_note, s.executed, s.created_by, cu.name as created_by_name,
      du.name as decided_by_name, s.decided_at, s.created_at from mkt_concept_sets s left join mkt_brands b on b.id = s.brand_id left join users cu on cu.id = s.created_by left join users du on du.id = s.decided_by
    where s.tenant = ${tenant} and ${id ? sql`s.id = ${id}` : where === 'pending' ? sql`s.status = 'pending'` : sql`s.status <> 'canceled'`} order by (s.status = 'pending') desc, s.created_at desc limit 20`;
  const ids = sets.flatMap((s) => (s.executed?.briefs ?? []).map((x: { briefId: string }) => x.briefId));
  const briefs = ids.length ? await sql<{ id: string; status: string; content_status: string | null }[]>`select b.id, b.status, c.status as content_status from mkt_briefs b left join mkt_contents c on c.id = b.content_id where b.id = any(${ids}::uuid[])` : [];
  const st = new Map(briefs.map((b) => [b.id, briefStatusLabel(b.status, b.content_status)]));
  return sets.map((s) => ({ ...s, briefs: (s.executed?.briefs ?? []).map((x: { conceptId: string; briefId: string }) => ({ ...x, status: st.get(x.briefId) ?? '취소' })) }));
}
export async function pendingConceptSets(tenant: string) { return viewSets(tenant, 'pending'); }
export async function conceptView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u);
  const brands = await db()<{ id: string; name: string }[]>`select id, name from mkt_brands where tenant = ${t} order by name`;
  return { sets: await viewSets(t, 'recent'), brands, canDecide: isAdmin(u), userId: u.id, maxRevisions: MAX_REVISIONS, aiEnabled: (await import('./ai/provider')).aiEnabled() };
}

/** [AI로 채우기]: 회사·브랜드 소개로 제품·역할·상황(고통·제안) 초안. AI 없으면 브랜드 주력 상품·말투 프로필의 타겟으로 */
export async function suggestConceptInput(u: SessionUser, i: z.infer<typeof conceptSuggestInput>) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const m = await material(t, i.brandId ?? null);
  const fallback = { product: clip(m.brand?.products || m.brand?.intro || m.co?.business || '', 120), roles: splitList(m.brand?.voice?.audience || m.co?.customers || '').slice(0, 5), situations: [] as Situation[], source: 'template' as 'ai' | 'template' };
  try {
    const o = await aiJson(t, u.id, `당신은 경력 30년의 퍼포먼스 마케터입니다. 회사·브랜드 정보를 보고 '상황 매트릭스' 입력 초안을 만듭니다. JSON 만.
- product: 광고할 제품·서비스 한 줄.
- roles: 구매자 역할 3~5개(결정권자·실무자·영향자 — 예: 입주자대표회의·관리사무소장·위탁관리사). 일반 소비자 대상이면 상황이 다른 고객 유형.
- situations: 3~5개. name(구매를 고민하게 되는 상황 — 예: 신축 입주 3~6개월 전·운영 중 인력 문제·재계약 시점), pain(그 상황의 고통 한 줄), offer(비용이 들지 않는 제안 — 무료 진단·체크리스트·비교표·시연·상담. 가격·할인은 재료에 있을 때만).
- 재료에 없는 숫자·실적은 쓰지 않습니다.`, `[재료]\n${m.text}`,
      { type: 'object', additionalProperties: false, required: ['product', 'roles', 'situations'], properties: { product: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } },
        situations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'pain', 'offer'], properties: { name: { type: 'string' }, pain: { type: 'string' }, offer: { type: 'string' } } } } } }, 'marketing_concepts');
    const roles = uniq((Array.isArray(o?.roles) ? o.roles : []).map((r: unknown) => clip(r, 30)).filter(Boolean)).slice(0, 6);
    const situations = (Array.isArray(o?.situations) ? o.situations : []).map((s: any) => ({ name: clip(s?.name, 40), pain: clip(s?.pain, 120), offer: clip(s?.offer, 80) })).filter((s: Situation) => s.name).slice(0, 6);
    if (roles.length || situations.length) return { product: clip(o.product, 120) || fallback.product, roles: roles.length ? roles : fallback.roles, situations, source: 'ai' as const };
  } catch { /* 기본값 */ }
  return fallback;
}

/** [컨셉 만들기](마케팅 공간 누구나): AI 컨셉 후보 → 승인 대기(운영실·승인함) + 승인자 알림 */
export async function createConceptSet(u: SessionUser, i: z.infer<typeof conceptSetInput>) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const input = normInput(i);
  const g = (await generate(t, u.id, i.product, input, i.brandId ?? null))!;
  const id = await insertSet(t, u.id, i.brandId ?? null, i.product, input, g);
  return { set: (await viewSets(t, 'recent', id))[0] };
}

async function loadSet(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [s] = await db()<any[]>`select * from mkt_concept_sets where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!s) throw notFound();
  return s as { id: string; tenant: string; brand_id: string | null; product: string; input: Input; concepts: Concept[]; status: string; version: number; thread_id: string | null; created_by: string | null };
}
/** 채택(대표·관리자): 1~4개 채택 → 컨셉마다 광고형 제작 의뢰(영상 = 릴스 15초 · 이미지 = 피드 4:5, 목적 문의) — 프롬프트는 응답 뒤 바로 작성. 반려: 사유 → AI 고친 안(최대 3판). 취소: 만든 사람·관리자 */
export async function actConceptSet(u: SessionUser, id: string, i: z.infer<typeof conceptAction>) {
  const s = await loadSet(u, id); const sql = db(); const t = s.tenant;
  if (i.action === 'cancel') {
    if (s.created_by !== u.id && !isAdmin(u)) throw forbidden('만든 사람이나 관리자만 취소합니다');
    if (s.status !== 'pending') throw badRequest('승인 대기 중인 것만 취소합니다');
    await sql`update mkt_concept_sets set status = 'canceled', updated_at = now() where id = ${id}`;
    return { status: 'canceled' };
  }
  if (!isAdmin(u)) throw forbidden('컨셉 채택·반려는 대표·관리자가 합니다');
  if (s.status !== 'pending') throw new HttpError(409, 'concept_decided', '이미 결정한 매트릭스입니다');
  if (i.action === 'reject') {
    const concepts = s.concepts.map((c) => ({ ...c, decision: 'rejected' as const }));
    const [ok] = await sql<{ id: string }[]>`update mkt_concept_sets set status = 'rejected', concepts = ${sql.json(concepts as never)}, decision_note = ${i.note}, decided_by = ${u.id}, decided_at = now(), updated_at = now() where id = ${id} and status = 'pending' returning id`;
    if (!ok) throw new HttpError(409, 'concept_decided', '이미 결정한 매트릭스입니다');
    await (await import('./mktTeam')).remember(t, 'adsetter', { brandId: s.brand_id, kind: 'reject', text: `${s.product} 컨셉 ${s.concepts.length}개 전부`, reason: i.note, sourceType: 'mkt_concept_set', sourceId: id, by: u.id }).catch(() => {}); // #499-7
    let revised: { id: string; version: number; changes: string | null } | null = null;
    if (s.version < MAX_REVISIONS) {
      const g = await generate(t, u.id, s.product, s.input, s.brand_id, { note: i.note, prev: s.concepts, version: s.version }).catch(() => null);
      if (g) revised = { id: await insertSet(t, u.id, s.brand_id, s.product, s.input, g, { version: s.version + 1, thread: s.thread_id ?? s.id, from: s.id }), version: s.version + 1, changes: g.changes };
    }
    return { status: 'rejected', revised };
  }
  const pick = new Set(i.conceptIds);
  const unknown = i.conceptIds.filter((x) => !s.concepts.some((c) => c.id === x));
  if (unknown.length) throw badRequest(`없는 컨셉입니다: ${unknown.join(', ')}`);
  const concepts = s.concepts.map((c) => ({ ...c, decision: pick.has(c.id) ? 'adopted' as const : 'rejected' as const }));
  const [ok] = await sql<{ id: string }[]>`update mkt_concept_sets set status = 'decided', concepts = ${sql.json(concepts as never)}, decision_note = ${i.note ?? null}, decided_by = ${u.id}, decided_at = now(), updated_at = now() where id = ${id} and status = 'pending' returning id`;
  if (!ok) throw new HttpError(409, 'concept_decided', '이미 결정한 매트릭스입니다');
  const briefs: { conceptId: string; briefId: string }[] = [];
  for (const c of concepts.filter((x) => x.decision === 'adopted')) {
    const kind = c.format === 'video' ? 'reels' : 'feed'; const spec = KIND_SPEC[kind];
    const [b] = await sql<{ id: string }[]>`insert into mkt_briefs (tenant, brand_id, channel, kind, purpose, message, refs, tone, quantity, due_date, status, created_by, mode)
      values (${t}, ${s.brand_id}, ${spec.channel}, ${kind}, 'inquiry', ${clip(`${c.hook} — ${c.role}·${c.situation} / 제안: ${c.offer}`, 300)},
        ${sql.json({ mediaIds: [], contentIds: [], links: [], conceptSetId: id, conceptId: c.id, concept: { role: c.role, situation: c.situation, pain: c.pain, offer: c.offer, hook: c.hook, headline: c.headline, primary: c.primary, angle: c.angle } } as never)},
        null, 1, null, 'queued', ${u.id}, 'ad') returning id`;
    briefs.push({ conceptId: c.id, briefId: b.id });
  }
  await sql`update mkt_concept_sets set executed = ${sql.json({ briefs } as never)} where id = ${id}`;
  { const T = await import('./mktTeam'); // #499-7 광고 세팅 담당 기억: 채택한 첫 줄·고르지 않은 수
    for (const c of concepts.filter((x) => x.decision === 'adopted')) await T.remember(t, 'adsetter', { brandId: s.brand_id, kind: 'adopt', text: `${c.role}·${c.situation} «${c.hook}»`, reason: i.note ?? null, sourceType: 'mkt_concept_set', sourceId: id, by: u.id }).catch(() => {}); }
  const { audit } = await import('./log'); await audit(sql as never, u.id, 'mkt.concepts_adopt', 'mkt_concept_set', id, { adopted: briefs.length, of: s.concepts.length }, null).catch(() => {});
  // 제작 의뢰 프롬프트(AI)는 응답 뒤에 — 의뢰마다 몇 초씩 걸려 채택 화면을 기다리게 하지 않음. 실패하면 '대기'로 남고 제작의뢰실 [프롬프트 다시]
  const write = async () => { const { writePrompt } = await import('./mktStudio'); for (const b of briefs) await writePrompt(t, b.briefId, u.id).catch(() => {}); };
  try { after(write); } catch { void write(); }
  return { status: 'decided', briefs };
}

/** [새 각도](채택한 컨셉): 대상·상황은 그대로, 형식·각도만 바꾼 컨셉 4~6개 → 승인 대기 */
export async function variantConceptSet(u: SessionUser, id: string, i: z.infer<typeof conceptVariantInput>) {
  const s = await loadSet(u, id);
  const c = s.concepts.find((x) => x.id === i.conceptId);
  if (!c) throw notFound();
  if (c.decision !== 'adopted') throw badRequest('채택한 컨셉에서만 새 각도를 만듭니다');
  const input: Input = { roles: [c.role], situations: [{ name: c.situation, pain: c.pain, offer: c.offer }], ...(s.input?.note ? { note: s.input.note } : {}), count: 5, variantOf: { setId: s.id, conceptId: c.id, hook: c.hook } };
  const g = (await generate(s.tenant, u.id, s.product, input, s.brand_id))!;
  const nid = await insertSet(s.tenant, u.id, s.brand_id, s.product, input, g);
  return { set: (await viewSets(s.tenant, 'recent', nid))[0] };
}
