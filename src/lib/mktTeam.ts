import { after } from 'next/server';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { zUuid } from './api';
import { tenantOf, type SessionUser } from './types';
import { aiJson } from './mktOps';
import { ymd } from './mktGoals';

/**
 * #499-7 AI 마케팅팀(테크트리 3장 F — docs/handoff/TECHTREE_VIDEOS_2026-10-23.md). 지금 운영실(제안 → 승인) 위에 역할 이름·일정·기록·역할별 기억을 붙인다.
 * - 역할 7개: 기획·디자인·광고 리서처·광고 세팅·예산·응대·보고. 이미 돌던 일(광고 리서처 주간 분석·보고 담당 주간 제안·예산 점검·리드 5분 알림)은 그대로 이 화면에 묶고,
 *   새로 하는 일은 기획 담당(매일 07시 이후 브랜드별 '오늘 주제' 3안 → 대표 채택·반려)과 디자인 담당(채택 즉시 카드뉴스 초안 → 깨끗하면 그려서 승인 요청 / 릴스·피드는 제작의뢰실).
 * - 하나씩 켠다: 켜고 끄는 역할 = 기획(기본 꺼짐)·디자인·광고 리서처·보고(기본 켬 — 지금 돌던 그대로). 예산 담당은 안전 장치라 끌 수 없고, 광고 세팅·응대는 사람이 요청할 때·리드가 들어올 때만.
 * - 역할마다 기억을 따로: 채택·반려(사유)·수정 요청·대표 메모 → 그 역할의 AI 지시문에 넣음(기획 담당 주제, 디자인 담당 카드뉴스, 광고 리서처 공통 구조, 광고 세팅 컨셉, 보고 담당 분석 카드).
 * - 돈이 나가는 일은 지금 승인 규칙 그대로(디자인 담당은 승인 요청까지만, 영상 [생성]·광고 켜기·증액은 사람이).
 */
export type Role = 'planner' | 'designer' | 'researcher' | 'adsetter' | 'budget' | 'responder' | 'reporter';
type RoleDef = { name: string; schedule: string; job: string; owner: string; recipe: string[]; mode: 'toggle' | 'always' | 'request'; def: boolean; ai: boolean; note?: string; link: { href: string; label: string } };
export const ROLES: Record<Role, RoleDef> = {
  planner: { name: '기획 담당', schedule: '매일 07:00', job: '브랜드별 오늘 주제 3안 — 근거: 시즌·이달 목표·경쟁 광고·지난 결정', owner: '채택·반려(기록이 다음 주제의 재료)', mode: 'toggle', def: false, ai: true,
    recipe: ['브랜드 재료(소개·주력 상품·말투·금지어)', '오늘 날짜·이달 운영 목표·이번 주 주제', '최근 14일 주제(겹치지 않게)', '경쟁 광고 ★ 참고·공통 구조(구조만, 문장·업체 이름은 쓰지 않음)', '기획 담당 기억(채택·반려 사유·대표 메모)', '브랜드마다 3안 — 형식(카드뉴스·릴스·피드)·각도를 서로 다르게, 첫 문장 콘텐츠형 점수'],
    link: { href: '/s/marketing/team#ideas', label: '오늘 주제' } },
  designer: { name: '디자인 담당', schedule: '채택 즉시', job: '채택한 주제 → 카드뉴스 장별 문구·사진 계획 → 틀에 배치해 승인 요청 · 릴스·피드는 제작의뢰실 프롬프트', owner: '시안 승인(승인함)', mode: 'toggle', def: true, ai: true,
    recipe: ['채택한 주제·첫 문장·대상', '카드뉴스 장별 문구·표·사진 계획(6장 틀) — 숫자·가격은 재료에 있는 것만, 없으면 {{ }}', '채울 곳·금지어가 없으면 1080×1350 JPEG 로 그려 승인 요청(기본 틀)', '채울 곳이 있으면 초안으로 두고 카드뉴스 탭에서 채움', '릴스·피드는 제작의뢰실 의뢰 → 프롬프트 준비([생성]은 사람이)', '디자인 담당 기억(수정 요청·대표 메모)'],
    link: { href: '/s/marketing/automation?tab=cards', label: '카드뉴스' } },
  researcher: { name: '광고 리서처', schedule: '주 1회(월요일 09:00)', job: '경쟁 광고 보관함에 붙여 넣은 광고 → 대본·첫 문장 유형·공통 구조 → 우리 대본 3안', owner: '참고할 것 ★ 표시', mode: 'toggle', def: true, ai: true,
    recipe: ['링크·영상은 사람이 넣음(서버는 링크를 열지 않음)', '영상 음성 받아쓰기 → 첫 문장 유형 규칙 분류', '지난 7일 새 광고가 3개 이상이면 묶어서 공통 구조', '우리 브랜드 대본 3안(광고형 점수) → 제작의뢰실 링크', '광고 리서처 기억(대표 메모)'],
    link: { href: '/s/marketing/ops#adrefs', label: '경쟁 광고 보관함' } },
  adsetter: { name: '광고 세팅 담당', schedule: '요청 시', job: '상황 매트릭스 → 광고 컨셉 → 꺼진 상태 세팅안(메타 광고 초안·파워링크 세팅안)', owner: '[승인하고 시작]', mode: 'request', def: true, ai: true, note: '사람이 요청할 때만 일합니다',
    recipe: ['구매자 역할 × 상황(고통·제안)', '컨셉 후보 — 광고형 첫 줄 점수·자리표시·금지어 표시', '대표가 1~4개 채택 → 광고형 제작 의뢰', '메타 광고는 꺼진 채(PAUSED)로 만들고 승인 뒤 켬', '광고 세팅 담당 기억(채택·반려·대표 메모)'],
    link: { href: '/s/marketing/ops', label: '운영실 광고 컨셉' } },
  budget: { name: '예산 담당', schedule: '매시간 점검', job: '이달 예산 소진율 → 충전 필요 알림 · 매체 잔액 → 충전 카드 · 비용 기준 넘은 자동 세팅 광고는 일시정지 · 증액은 제안만', owner: '증액·충전 승인', mode: 'always', def: true, ai: false, note: '안전 장치라 끌 수 없습니다',
    recipe: ['승인된 이달 예산 vs 매체별 지출', '80% 넘거나 남은 날 대비 모자라면 채널마다 한 번 알림', '매체 잔액이 며칠 치 아래면 충전 카드', '월 상한·비용 기준을 넘은 광고는 자동 일시정지(켜기·증액은 사람이)'],
    link: { href: '/s/marketing/ops', label: '광고 예산' } },
  responder: { name: '응대 담당', schedule: '실시간', job: '리드 광고 신청 → 담당자에게 5분 안 첫 연락 알림·늦으면 다시 알림 · 댓글·DM 답 초안은 준비 중', owner: '[보내기]', mode: 'always', def: true, ai: false, note: '리드 광고 설정을 따릅니다 — 댓글·DM 답 초안은 메타 권한 심사 뒤',
    recipe: ['리드 광고 신청 → 영업 리드·담당 업무(이름·전화는 알림에 가림)', '5분 안에 첫 연락 기록이 없으면 담당·관리자에게 다시 알림', '보내는 것은 언제나 사람이 [보내기]'],
    link: { href: '/s/marketing/ad-ops', label: '리드 광고' } },
  reporter: { name: '보고 담당', schedule: '주 1회(월요일 09:00)', job: '광고비 → 클릭 → 문의·계약 숫자로 주간 운영 제안 + 분석·방향 카드', owner: '다음 주 방향 결정(승인함)', mode: 'toggle', def: true, ai: true,
    recipe: ['지난 7일 캠페인별 광고비·CPC·CTR', '단가 조정·소재 교체·잘 되는 매체·예산 페이스', '분석·방향 카드(대기 카드가 없을 때)', '승인하면 항목마다 담당 업무', '보고 담당 기억(채택·반려·대표 메모)'],
    link: { href: '/s/marketing/approvals?tab=proposals', label: '운영 제안' } },
};
const ROLE_KEYS = Object.keys(ROLES) as Role[];
const zRole = z.enum(ROLE_KEYS as [Role, ...Role[]]);
export const IDEA_FORMATS = { carousel: '카드뉴스', reels: '릴스 15초', feed: '피드 사진' } as const;
export const BASIS = { season: '시즌', goal: '이달 목표', competitor: '경쟁 광고', memory: '지난 결정', recent: '최근 게시' } as const;
type Format = keyof typeof IDEA_FORMATS;
const PATTERN_KEYS = ['vs', 'howto', 'types', 'checklist'] as const;
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const hourKst = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(d)) % 24;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const josa = (w: string, pair: '은는' | '을를') => { const c = w.trim().slice(-1).charCodeAt(0); return `${w}${c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? pair[0] : pair[1]}`; };

// ---------------- 켜기·기록·기억 ----------------
export async function roleOn(tenant: string, role: Role) {
  const d = ROLES[role]; if (d.mode !== 'toggle') return true;
  const [r] = await db()<{ enabled: boolean | null }[]>`select enabled from mkt_team_roles where tenant = ${tenant} and role = ${role}`;
  return r?.enabled ?? d.def;
}
/** 일한 때·결과(건너뜀 포함)를 역할에 남기고, 결과물이 있거나 실패면 기록 한 줄 */
export async function ran(tenant: string, role: Role, r: { status: 'done' | 'skipped' | 'error'; summary: string; title?: string; detail?: string | null; link?: string | null; log?: boolean }) {
  const sql = db();
  await sql`insert into mkt_team_roles (tenant, role, last_run_at, last_result) values (${tenant}, ${role}, now(), ${sql.json({ status: r.status, summary: r.summary.slice(0, 200) } as never)})
    on conflict (tenant, role) do update set last_run_at = now(), last_result = excluded.last_result`;
  if (r.log ?? r.status !== 'skipped') await sql`insert into mkt_team_log (tenant, role, status, title, detail, link) values (${tenant}, ${role}, ${r.status}, ${(r.title ?? r.summary).slice(0, 200)}, ${r.detail?.slice(0, 500) ?? null}, ${r.link ?? null})`;
}
export async function remember(tenant: string, role: Role, m: { brandId?: string | null; kind: 'adopt' | 'reject' | 'edit' | 'note'; text: string; reason?: string | null; sourceType?: string; sourceId?: string | null; by?: string | null }) {
  const text = clip(m.text, 1000); if (!text) return; // 187차 ④: 200 → 1,000자(긴 지침은 디자인 지침 칸)
  await db()`insert into mkt_team_memory (tenant, role, brand_id, kind, text, reason, source_type, source_id, created_by) values (${tenant}, ${role}, ${m.brandId ?? null}, ${m.kind}, ${text}, ${m.reason ? clip(m.reason, 1000) : null}, ${m.sourceType ?? null}, ${m.sourceId ?? null}, ${m.by ?? null})`;
}
/** 그 역할의 AI 지시문에 넣을 기억(대표 메모 먼저, 그다음 최근 결정) — 브랜드가 있으면 그 브랜드 것 + 회사 전체 것 */
export async function memoryText(tenant: string, role: Role, brandId: string | null, opts: { notesOnly?: boolean } = {}) {
  const sql = db();
  const rows = await sql<{ kind: string; text: string; reason: string | null }[]>`select kind, text, reason from mkt_team_memory where tenant = ${tenant} and role = ${role}
    and (${brandId}::uuid is null or brand_id is null or brand_id = ${brandId}) ${opts.notesOnly ? sql`and kind = 'note'` : sql`and true`} order by (kind = 'note') desc, created_at desc limit 14`.catch(() => []);
  if (!rows.length) return '';
  const L: Record<string, string> = { note: '대표 메모', adopt: '채택', reject: '반려', edit: '수정 요청' };
  return [`[${ROLES[role].name} 기억 — 대표 메모는 꼭 따르고, 반려한 방향은 피함]`, ...rows.map((r) => `- ${L[r.kind] ?? r.kind}: ${r.kind === 'note' || r.kind === 'edit' ? r.text : `«${r.text}»`}${r.reason ? ` — ${r.reason}` : ''}`)].join('\n');
}
/**
 * 187차 ④(대표 '디자인 담당 기억 — 브랜드별+공통 · 긴 지침 칸 · 모든 시안·제작의뢰 프롬프트에 · 노트에 반영 n개'): 디자인 담당 지시문 재료.
 * - 지침 = 대표가 적은 긴 글(회사 전체 + 그 브랜드, 각 4,000자 · 한 줄에 하나씩) — mkt_team_roles(designer).settings.guides {common, <brandId>}
 * - 기억 = 대표 메모 먼저, 그다음 최근 수정 요청·채택·반려(같은 말은 한 번) — 글자 예산 안에서. 브랜드 글 = 그 브랜드 것 + 회사 전체 것, 브랜드 없는 글 = 회사 전체 것만
 * - 자동 제작 원고·수정본·약한 첫 줄 다시 쓰기·카드뉴스·제작의뢰실이 같은 글을 받고, 실제로 넣은 개수를 그대로 돌려줌(지침 = 줄 수, 기억 = 항목 수)
 */
export const GUIDE_MAX = 4000;
export const DESIGN_MEMORY_BUDGET = 4000;
export type DesignBrief = { text: string; memory: number; guide: number };
const guideLines = (t: unknown) => String(t ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
export async function designGuides(tenant: string): Promise<Record<string, string>> {
  const [r] = await db()<{ g: Record<string, string> | null }[]>`select settings->'guides' as g from mkt_team_roles where tenant = ${tenant} and role = 'designer'`.catch(() => []);
  return r?.g && typeof r.g === 'object' ? r.g : {};
}
export async function designBrief(tenant: string, brandId: string | null): Promise<DesignBrief> {
  const g = await designGuides(tenant);
  const blocks = ([['회사 전체', g.common], ...(brandId ? [['이 브랜드', g[brandId]]] : [])] as [string, string | undefined][]).filter(([, t]) => guideLines(t).length > 0) as [string, string][];
  const rows = await db()<{ kind: string; text: string; reason: string | null }[]>`select kind, text, reason from mkt_team_memory where tenant = ${tenant} and role = 'designer'
    and (brand_id is null or brand_id = ${brandId}) order by (kind = 'note') desc, created_at desc limit 40`.catch(() => []);
  const L: Record<string, string> = { note: '대표 메모', adopt: '채택', reject: '반려', edit: '수정 요청' };
  const mem: string[] = []; const seen = new Set<string>(); let size = 0;
  for (const r of rows) {
    const key = `${r.kind}|${r.text.replace(/\s+/g, ' ').trim()}`; if (seen.has(key)) continue;
    const line = `- ${L[r.kind] ?? r.kind}: ${r.kind === 'note' || r.kind === 'edit' ? r.text : `«${r.text}»`}${r.reason ? ` — ${r.reason}` : ''}`;
    if (mem.length && size + line.length > DESIGN_MEMORY_BUDGET) break;
    seen.add(key); mem.push(line); size += line.length;
  }
  const parts: string[] = [];
  if (blocks.length) parts.push(`[디자인 지침 — 대표가 정한 기준. 글·시안 문구·제작 지시 모두 꼭 따름]\n${blocks.map(([k, t]) => `(${k})\n${t.trim()}`).join('\n')}`);
  if (mem.length) parts.push(`[디자인 담당 기억 — 대표 메모는 꼭 따르고, 반려한 방향은 피함]\n${mem.join('\n')}`);
  return { text: parts.join('\n'), memory: mem.length, guide: blocks.reduce((n, [, t]) => n + guideLines(t).length, 0) };
}
/** 버전 노트·카드에 붙이는 한 줄(넣은 것이 없으면 빈 문자열) */
export const designNote = (b?: { memory?: number; guide?: number } | null) => (b && (b.guide || b.memory) ? ` · 반영: ${[b.guide ? `디자인 지침 ${b.guide}개` : '', b.memory ? `디자인 기억 ${b.memory}개` : ''].filter(Boolean).join('·')}` : '');

// ---------------- 기획 담당: 오늘 주제 3안 ----------------
async function plannerBrands(t: string, only?: string | null) {
  const sql = db();
  const [r] = await sql<{ settings: { brandIds?: string[] } }[]>`select settings from mkt_team_roles where tenant = ${t} and role = 'planner'`;
  const pick = Array.isArray(r?.settings?.brandIds) ? r.settings.brandIds : [];
  const rows = await sql<{ id: string; name: string }[]>`select id, name from mkt_brands where tenant = ${t} and not test_mode order by coalesce(ad_priority, 999), name`;
  if (only) return rows.filter((b) => b.id === only);
  return (pick.length ? rows.filter((b) => pick.includes(b.id)) : rows).slice(0, 8);
}
const PLANNER_SYS = `당신은 경력 30년의 콘텐츠 기획자입니다(AI 마케팅팀 '기획 담당'). 브랜드 하나의 '오늘 올릴 주제' 3안을 냅니다. JSON 만.
- ideas: 정확히 3개 {title, hook, format, pattern, product, angle, basis}
- title: 주제(카드뉴스면 표지 질문) 30자 이내 · hook: 첫 문장 40자 이내 — 질문·공감·이야기로 시작(가격·할인·신청 같은 판매 문구로 시작하지 않음)
- format: carousel(카드뉴스) | reels(릴스 15초) | feed(사진 1장) — 3안은 형식이나 각도를 서로 다르게(같은 말 바꾸기 금지)
- pattern: carousel 이면 vs(A vs B) | howto(N가지 방법) | types(유형별 추천) | checklist(체크리스트), 아니면 빈 문자열
- product: 다룰 제품·서비스(재료의 주력 상품에서) · angle: 노리는 고객·상황 한 줄
- basis: 근거 1~3개 {kind: season(시즌·날짜) | goal(이달 목표·이번 주 주제) | competitor(경쟁 광고 구조) | memory(지난 결정) | recent(최근 게시와 겹치지 않게), text(한 줄)}
- 근거와 숫자는 [재료]에 있는 것만 씁니다. 숫자·실적·가격이 없으면 쓰지 않습니다. 과장·최상급 금지. 경쟁 광고는 구조만 빌리고 문장·업체 이름은 쓰지 않습니다.
- [기억]의 반려 사유와 비슷한 주제는 피하고, 채택한 방향은 살리되 그대로 반복하지 않습니다.`;
type Idea = { title: string; hook: string; format: Format; pattern: string | null; product: string; angle: string; basis: { kind: keyof typeof BASIS; text: string }[]; score: number };
async function planBrand(t: string, brand: { id: string; name: string }, day: string, actorId: string | null): Promise<{ ideas: Idea[]; skipped?: string }> {
  const sql = db(); const { material } = await import('./mktCarousel'); const G = await import('./mktGoals');
  const m = await material(t, brand.id);
  const goal = await G.goalFor(t, brand.id, day.slice(0, 7)).catch(() => null);
  const week = goal?.weekly ? G.weekOf(goal.weekly, day) : null;
  const recent = await sql<{ title: string }[]>`(select title from mkt_contents where tenant = ${t} and brand_id = ${brand.id} and not is_test and created_at > now() - interval '14 days' order by created_at desc limit 8)
    union all (select topic as title from mkt_carousels where tenant = ${t} and brand_id = ${brand.id} and created_at > now() - interval '14 days' order by created_at desc limit 5)
    union all (select title from mkt_team_ideas where tenant = ${t} and brand_id = ${brand.id} and status = 'adopted' and day > ${day}::date - 14 order by day desc limit 5)`;
  const stars = await sql<{ hook: string; hook_type: string | null }[]>`select hook, hook_type from mkt_ad_refs where tenant = ${t} and starred and hook is not null and (brand_id is null or brand_id = ${brand.id}) order by updated_at desc limit 5`;
  const [rep] = await sql<{ result: { structure?: string[]; common?: string[] } }[]>`select result from mkt_ad_ref_reports where tenant = ${t} and (brand_id is null or brand_id = ${brand.id}) order by created_at desc limit 1`;
  const mem = await memoryText(t, 'planner', brand.id);
  const dow = DOW[new Date(`${day}T00:00:00Z`).getUTCDay()];
  const user = [`[재료]\n${m.text}${m.banned.length ? `\n금지어(쓰지 않음): ${m.banned.join(', ')}` : ''}`,
    `오늘: ${day}(${dow}) — 업종 시즌은 날짜로 판단`, goal?.goals?.objectives?.length ? `이달 운영 목표: ${goal.goals.objectives.join(' / ')}` : '', week?.topic ? `이번 주 주제: ${week.topic}` : '',
    recent.length ? `최근 14일 주제(겹치지 않게): ${recent.map((r) => r.title).filter(Boolean).slice(0, 12).join(' · ')}` : '',
    stars.length || rep ? `[경쟁 광고 — 광고 리서처]${stars.length ? `\n참고(★) 첫 문장: ${stars.map((s) => `«${s.hook}»`).join(' / ')}` : ''}${rep?.result?.structure?.length ? `\n최근 공통 구조: ${rep.result.structure.join(' → ')}` : ''}` : '',
    mem].filter(Boolean).join('\n\n');
  const o = await aiJson(t, actorId, PLANNER_SYS, user, { type: 'object', additionalProperties: false, required: ['ideas'], properties: { ideas: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['title', 'hook', 'format', 'pattern', 'product', 'angle', 'basis'], properties: { title: { type: 'string' }, hook: { type: 'string' }, format: { type: 'string' }, pattern: { type: 'string' }, product: { type: 'string' }, angle: { type: 'string' },
      basis: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'text'], properties: { kind: { type: 'string' }, text: { type: 'string' } } } } } } } } }, 'marketing_team');
  if (!o) return { ideas: [], skipped: 'ai_off' };
  const Q = await import('./mktQuality'); const rules = await Q.qualityRules();
  const product0 = clip(String(m.brand?.products ?? '').split(/[\n,·/]/)[0], 120) || brand.name;
  const ideas: Idea[] = (Array.isArray(o.ideas) ? o.ideas : []).slice(0, 3).map((x: any) => {
    const format: Format = x?.format in IDEA_FORMATS ? x.format : 'carousel'; const hook = clip(x?.hook, 120);
    return { title: clip(x?.title, 80), hook, format, pattern: format === 'carousel' ? ((PATTERN_KEYS as readonly string[]).includes(x?.pattern) ? x.pattern : 'howto') : null,
      product: clip(x?.product, 120) || product0, angle: clip(x?.angle, 160),
      basis: (Array.isArray(x?.basis) ? x.basis : []).slice(0, 3).map((b: any) => ({ kind: (b?.kind in BASIS ? b.kind : 'season') as keyof typeof BASIS, text: clip(b?.text, 120) })).filter((b: { text: string }) => b.text),
      score: hook ? Q.scoreHook(hook, rules, [], 'content').score : 0 };
  }).filter((x: Idea) => x.title.length >= 2);
  return { ideas };
}
/** 한 브랜드 주제 3안 만들기(하루 한 번 표시 run_key 를 잡으면 정기 실행이 다시 만들지 않음) — 같은 브랜드의 대기 주제는 '지난 주제'로 넘김 */
async function planOne(t: string, brand: { id: string; name: string }, day: string, actorId: string | null, claimed: boolean) {
  const sql = db(); const key = `planner:${day}:${brand.id}`;
  let logId: string;
  if (claimed) {
    const [c] = await sql<{ id: string }[]>`insert into mkt_team_log (tenant, role, status, title, run_key) values (${t}, 'planner', 'working', ${`${brand.name} 오늘 주제`}, ${key}) on conflict (tenant, run_key) where run_key is not null do nothing returning id`;
    if (!c) return { brand: brand.name, skipped: 'done' as const, created: 0 };
    logId = c.id;
  } else {
    const [c] = await sql<{ id: string }[]>`insert into mkt_team_log (tenant, role, status, title, run_key) values (${t}, 'planner', 'working', ${`${brand.name} 오늘 주제(다시)`}, ${key}) on conflict (tenant, run_key) where run_key is not null do nothing returning id`;
    logId = c?.id ?? (await sql<{ id: string }[]>`insert into mkt_team_log (tenant, role, status, title) values (${t}, 'planner', 'working', ${`${brand.name} 오늘 주제(다시)`}) returning id`)[0].id;
  }
  try {
    const r = await planBrand(t, brand, day, actorId);
    if (!r.ideas.length) {
      const why = r.skipped === 'ai_off' ? 'AI 가 꺼져 있어 건너뜀' : 'AI 가 쓸 만한 주제를 내지 못함';
      await sql`update mkt_team_log set status = 'skipped', title = ${`${brand.name} 오늘 주제 — ${why}`} where id = ${logId}`;
      await ran(t, 'planner', { status: 'skipped', summary: `${brand.name}: ${why}`, log: false });
      return { brand: brand.name, skipped: r.skipped ?? 'empty', created: 0 };
    }
    await sql`update mkt_team_ideas set status = 'expired', updated_at = now() where tenant = ${t} and brand_id = ${brand.id} and status = 'pending'`;
    for (const x of r.ideas) await sql`insert into mkt_team_ideas (tenant, brand_id, day, title, hook, format, pattern, product, angle, basis, score)
      values (${t}, ${brand.id}, ${day}::date, ${x.title}, ${x.hook || null}, ${x.format}, ${x.pattern}, ${x.product}, ${x.angle || null}, ${sql.json(x.basis as never)}, ${x.score})`;
    const title = `${brand.name} 오늘 주제 ${r.ideas.length}개: ${r.ideas.map((x) => `«${x.title}»`).join(' ')}`.slice(0, 200);
    await sql`update mkt_team_log set status = 'done', title = ${title}, link = '/s/marketing/team#ideas' where id = ${logId}`;
    await ran(t, 'planner', { status: 'done', summary: `${brand.name} 주제 ${r.ideas.length}개`, log: false });
    return { brand: brand.name, created: r.ideas.length };
  } catch (e) {
    const msg = clip((e as Error)?.message ?? e, 200);
    await sql`update mkt_team_log set status = 'error', title = ${`${brand.name} 오늘 주제 — 실패`}, detail = ${msg} where id = ${logId}`;
    await ran(t, 'planner', { status: 'error', summary: `${brand.name}: ${msg}`, log: false });
    return { brand: brand.name, error: msg, created: 0 };
  }
}
async function notifyIdeas(t: string, day: string) {
  const sql = db();
  const [c] = await sql<{ n: number; b: number }[]>`select count(*)::int n, count(distinct brand_id)::int b from mkt_team_ideas where tenant = ${t} and day = ${day}::date and status = 'pending'`;
  if (!c.n) return;
  await (await import('./spaceNotify')).notifySpace(sql, { tenant: t, space: 'marketing', approval: true, type: 'review_requested', title: `기획 담당: 오늘 주제 ${c.n}개(브랜드 ${c.b}개) — 채택·반려해 주세요`,
    body: '채택하면 디자인 담당이 바로 카드뉴스 초안을 만듭니다', link: '/s/marketing/team#ideas', entityType: 'mkt_team_idea', dedupeKey: `team:planner:${t}:${day}` }).catch(() => {});
}
/** 정기(opsTick, 서울 07~21시): 기획 담당을 켠 회사만, 하루 한 번 브랜드마다 — 점검 한 번에 한 브랜드씩(점검 시간을 길게 잡지 않게). 마지막 브랜드까지 끝나면 승인자 알림 1번 */
export async function plannerTick(tenant: string, now = new Date()) {
  if (!(await roleOn(tenant, 'planner'))) return { skipped: 'off' };
  const start = Number(process.env.TEAM_PLANNER_HOUR ?? 7); // 시험 서버는 0(시각과 무관하게) — DUE_DIGEST_HOUR 와 같은 방식
  const h = hourKst(now); if (start > 0 && (h < start || h >= 22)) return { skipped: 'hour' };
  const day = ymd(now); const brands = await plannerBrands(tenant);
  if (!brands.length) return { skipped: 'no_brand' };
  const done = new Set((await db()<{ run_key: string }[]>`select run_key from mkt_team_log where tenant = ${tenant} and run_key like ${`planner:${day}:%`}`).map((r) => r.run_key.split(':')[2]));
  const next = brands.find((b) => !done.has(b.id));
  if (!next) return { skipped: 'done', day };
  const r = await planOne(tenant, next, day, null, true);
  if (brands.every((b) => b.id === next.id || done.has(b.id))) await notifyIdeas(tenant, day);
  return r;
}

// ---------------- 디자인 담당: 채택 즉시 ----------------
/** 채택한 주제 → 카드뉴스 초안(채울 곳·금지어 없으면 그려서 승인 요청) / 릴스·피드 = 제작의뢰실 의뢰 + 프롬프트. 결과는 주제 카드에 */
export async function designerMake(u: SessionUser, ideaId: string) {
  const sql = db(); const t = tenantOf(u);
  const [idea] = await sql<any[]>`update mkt_team_ideas set result_status = 'working', result_note = null, updated_at = now() where id = ${ideaId} and tenant = ${t} and status = 'adopted'
    and (result_status is null or result_status = 'error') returning *, (select name from mkt_brands where id = mkt_team_ideas.brand_id) as brand_name`;
  if (!idea) return { skipped: 'busy' };
  const finish = async (status: 'done' | 'draft' | 'error', type: string | null, id: string | null, note: string, link: string) => {
    await sql`update mkt_team_ideas set result_status = ${status}, result_type = ${type}, result_id = ${id}, result_note = ${note.slice(0, 300)}, updated_at = now() where id = ${ideaId}`;
    await ran(t, 'designer', { status: status === 'error' ? 'error' : 'done', summary: note, title: `${idea.brand_name ?? ''} «${idea.title}» — ${note}`.trim(), link });
    return { status, type, id, note };
  };
  try {
    if (idea.format === 'carousel') {
      const C = await import('./mktCarousel');
      const made = await C.createCarousel(u, { brandId: idea.brand_id, product: clip(idea.product || idea.title, 120), audience: clip(idea.angle, 60) || undefined, topic: clip(idea.title, 80), pattern: idea.pattern || 'howto',
        template: 'box', note: clip(`기획 담당 주제(대표 채택) — 첫 문장: ${idea.hook ?? ''}${idea.note ? ` · 대표 메모: ${idea.note}` : ''}`, 300) });
      const c = made.item.check;
      if (c.placeholders.length || c.banned.length || !made.item.caption?.trim())
        return finish('draft', 'carousel', made.item.id, `카드뉴스 초안 — ${c.placeholders.length ? `채울 곳 ${c.placeholders.length}곳` : ''}${c.banned.length ? ` 금지어 ${c.banned.join(',')}` : ''}${!made.item.caption?.trim() ? ' 본문 없음' : ''}`.trim() + ' — 카드뉴스 탭에서 고친 뒤 승인 요청', '/s/marketing/automation?tab=cards');
      try {
        const r = await C.renderCarousel(u, made.item.id, {});
        return finish('done', 'carousel', made.item.id, `카드뉴스 ${r.mediaIds.length}장을 그려 승인 대기로 보냈습니다`, '/s/marketing/approvals');
      } catch (e) { return finish('draft', 'carousel', made.item.id, `카드뉴스 초안 — 그리지 못함(${clip((e as Error)?.message ?? e, 120)}) — 카드뉴스 탭에서 다시`, '/s/marketing/automation?tab=cards'); }
    }
    const kind = idea.format === 'reels' ? 'reels' : 'feed'; const { KIND_SPEC, writePrompt } = await import('./mktStudio'); const spec = KIND_SPEC[kind];
    const [b] = await sql<{ id: string }[]>`insert into mkt_briefs (tenant, brand_id, channel, kind, purpose, message, refs, tone, quantity, due_date, status, created_by, mode)
      values (${t}, ${idea.brand_id}, ${spec.channel}, ${kind}, 'awareness', ${clip(`${idea.title}${idea.hook ? ` — ${idea.hook}` : ''}${idea.angle ? ` (${idea.angle})` : ''}`, 300)},
        ${sql.json({ mediaIds: [], contentIds: [], links: [], ideaId: idea.id } as never)}, null, 1, null, 'queued', ${u.id}, 'content') returning id`;
    await writePrompt(t, b.id, u.id).catch(() => {});
    const [st] = await sql<{ status: string }[]>`select status from mkt_briefs where id = ${b.id}`;
    return finish('done', 'brief', b.id, st?.status === 'ready' ? `제작의뢰실 ${spec.label} — 프롬프트 준비됨([생성]은 사람이)` : `제작의뢰실 ${spec.label} 의뢰 — 프롬프트는 제작의뢰실에서 [프롬프트 다시]`, '/s/marketing/automation?tab=studio');
  } catch (e) { return finish('error', null, null, `만들지 못함: ${clip((e as Error)?.message ?? e, 150)}`, '/s/marketing/team#ideas'); }
}
const queueDesigner = (u: SessionUser, id: string) => { const job = () => designerMake(u, id).then(() => undefined, () => undefined); try { after(job); } catch { void job(); } };

// ---------------- 주제 채택·반려 ----------------
export const ideaAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('adopt'), note: z.string().trim().max(200).optional() }),
  z.object({ action: z.literal('reject'), note: z.string().trim().max(200).optional() }),
  z.object({ action: z.literal('make') })]);
export async function actIdea(u: SessionUser, id: string, i: z.infer<typeof ideaAction>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('주제 채택·반려는 대표·관리자가 합니다');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('주제를 찾을 수 없습니다');
  const sql = db(); const t = tenantOf(u);
  const [idea] = await sql<any[]>`select * from mkt_team_ideas where id = ${id} and tenant = ${t}`;
  if (!idea) throw notFound('주제를 찾을 수 없습니다'); // 다른 회사 것은 없는 것처럼
  if (i.action === 'make') {
    if (idea.status !== 'adopted') throw badRequest('채택한 주제만 디자인 담당에게 맡깁니다');
    if (idea.result_status === 'working') throw new HttpError(409, 'idea_busy', '디자인 담당이 만드는 중입니다 — 잠시 뒤 새로고침');
    if (idea.result_status === 'done' || idea.result_status === 'draft') throw new HttpError(409, 'idea_made', '이미 만든 주제입니다 — 결과를 열어 보세요');
    queueDesigner(u, id);
    return { status: 'adopted', designer: 'queued' };
  }
  const st = i.action === 'adopt' ? 'adopted' : 'rejected';
  const [ok] = await sql<{ id: string }[]>`update mkt_team_ideas set status = ${st}, note = ${i.note || null}, decided_by = ${u.id}, decided_at = now(), updated_at = now() where id = ${id} and status = 'pending' returning id`;
  if (!ok) throw new HttpError(409, 'idea_decided', '이미 결정했거나 지난 주제입니다');
  await remember(t, 'planner', { brandId: idea.brand_id, kind: i.action === 'adopt' ? 'adopt' : 'reject', text: idea.title, reason: i.note, sourceType: 'mkt_team_idea', sourceId: id, by: u.id });
  let designer: 'queued' | 'off' | null = null;
  if (st === 'adopted') { designer = (await roleOn(t, 'designer')) ? 'queued' : 'off'; if (designer === 'queued') queueDesigner(u, id); }
  return { status: st, designer };
}

// ---------------- 관리자: 켜기·지금 일하기·브랜드·기억 ----------------
export const teamAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('toggle'), role: zRole, enabled: z.boolean() }),
  z.object({ action: z.literal('run'), role: z.enum(['planner', 'researcher', 'reporter']), brandId: zUuid.optional() }),
  z.object({ action: z.literal('brands'), brandIds: z.array(zUuid).max(20) }),
  z.object({ action: z.literal('remember'), role: zRole, text: z.string().trim().min(2, '기억시킬 말을 두 글자 이상 적어 주세요').max(1000, '기억은 1,000자까지입니다 — 긴 기준은 디자인 지침 칸에'), brandId: zUuid.nullable().optional() }),
  z.object({ action: z.literal('guide'), text: z.string().max(GUIDE_MAX, '디자인 지침은 4,000자까지입니다'), brandId: zUuid.nullable().optional() }), // 187차 ④ 비우면 지움
  z.object({ action: z.literal('forget'), id: zUuid })]);
export async function teamAct(u: SessionUser, i: z.infer<typeof teamAction>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('AI 마케팅팀 설정·실행은 대표·관리자가 합니다');
  const sql = db(); const t = tenantOf(u);
  const { audit } = await import('./log');
  if (i.action === 'toggle') {
    const d = ROLES[i.role];
    if (d.mode !== 'toggle') throw badRequest(`${josa(d.name, '은는')} 켜고 끄지 않습니다 — ${d.note ?? ''}`.trim());
    await sql`insert into mkt_team_roles (tenant, role, enabled, updated_by, updated_at) values (${t}, ${i.role}, ${i.enabled}, ${u.id}, now())
      on conflict (tenant, role) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()`;
    await audit(sql as never, u.id, 'mkt.team_toggle', 'mkt_team_role', null, { role: i.role, enabled: i.enabled }, null).catch(() => {});
    return { role: i.role, enabled: i.enabled };
  }
  if (i.action === 'brands') {
    const ok = i.brandIds.length ? await sql<{ id: string }[]>`select id from mkt_brands where tenant = ${t} and id = any(${i.brandIds}::uuid[])` : [];
    if (ok.length !== new Set(i.brandIds).size) throw notFound('브랜드를 찾을 수 없습니다');
    await sql`insert into mkt_team_roles (tenant, role, settings, updated_by, updated_at) values (${t}, 'planner', ${sql.json({ brandIds: ok.map((b) => b.id) } as never)}, ${u.id}, now())
      on conflict (tenant, role) do update set settings = mkt_team_roles.settings || excluded.settings, updated_by = excluded.updated_by, updated_at = now()`;
    return { brandIds: ok.map((b) => b.id) };
  }
  if (i.action === 'guide') {
    if (i.brandId) { const [b] = await sql`select id from mkt_brands where id = ${i.brandId} and tenant = ${t}`; if (!b) throw notFound('브랜드를 찾을 수 없습니다'); }
    const key = i.brandId ?? 'common'; const text = i.text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
    await sql`insert into mkt_team_roles (tenant, role, settings, updated_by, updated_at) values (${t}, 'designer', ${sql.json({ guides: text ? { [key]: text } : {} } as never)}, ${u.id}, now())
      on conflict (tenant, role) do update set settings = jsonb_set(mkt_team_roles.settings, '{guides}', case when ${text}::text = '' then coalesce(mkt_team_roles.settings->'guides', '{}'::jsonb) - ${key}::text
        else coalesce(mkt_team_roles.settings->'guides', '{}'::jsonb) || jsonb_build_object(${key}::text, ${text}::text) end), updated_by = excluded.updated_by, updated_at = now()`;
    await audit(sql as never, u.id, 'mkt.team_guide', 'mkt_team_role', null, { brandId: i.brandId ?? null, chars: text.length }, null).catch(() => {});
    return { brandId: i.brandId ?? null, chars: text.length, lines: guideLines(text).length };
  }
  if (i.action === 'remember') {
    if (!ROLES[i.role].ai) throw badRequest(`${josa(ROLES[i.role].name, '은는')} AI 를 쓰지 않아 기억이 없습니다`);
    if (i.brandId) { const [b] = await sql`select id from mkt_brands where id = ${i.brandId} and tenant = ${t}`; if (!b) throw notFound('브랜드를 찾을 수 없습니다'); }
    await remember(t, i.role, { brandId: i.brandId ?? null, kind: 'note', text: i.text, by: u.id });
    return { ok: true };
  }
  if (i.action === 'forget') {
    const [d] = await sql<{ id: string }[]>`delete from mkt_team_memory where id = ${i.id} and tenant = ${t} returning id`;
    if (!d) throw notFound('기억을 찾을 수 없습니다');
    return { ok: true };
  }
  // 지금 일하기(관리자) — 꺼져 있어도 한 번 시험해 볼 수 있음
  if (i.role === 'planner') {
    const day = ymd(new Date()); const brands = await plannerBrands(t, i.brandId ?? null);
    if (!brands.length) throw badRequest(i.brandId ? '브랜드를 찾을 수 없습니다' : '주제를 낼 브랜드가 없습니다 — 마케팅 › 브랜드를 먼저 만들어 주세요');
    const t0 = Date.now(); const out: Awaited<ReturnType<typeof planOne>>[] = []; const left: string[] = [];
    for (const b of brands) { if (Date.now() - t0 > 40_000) { left.push(b.name); continue; } out.push(await planOne(t, b, day, u.id, false)); }
    if (!i.brandId) await notifyIdeas(t, day);
    return { created: out.reduce((s, r) => s + r.created, 0), brands: out, left };
  }
  if (i.role === 'researcher') {
    const r: any = await (await import('./mktAdRefs')).adRefWeeklyNow(u);
    await noteResearcher(t, r);
    return r;
  }
  const r = await (await import('./mktOps')).weeklyProposal(t, u.id, { force: true });
  await noteReporter(t, r, null);
  return r;
}
/** opsTick 이 부르는 기록(보고·광고 리서처·예산) — 결과물이 있거나 실패일 때만 기록 줄, 건너뜀은 마지막 실행만 */
export async function noteReporter(t: string, weekly: any, proposals: any) {
  if (weekly?.created) await ran(t, 'reporter', { status: 'done', summary: `주간 운영 제안 ${weekly.items ?? 0}건`, title: `주간 운영 제안을 승인함에 올렸습니다(${weekly.items ?? 0}건)`, link: '/s/marketing/approvals?tab=proposals' });
  else if (weekly?.error) await ran(t, 'reporter', { status: 'error', summary: clip(weekly.error, 150), title: '주간 운영 제안 — 실패', detail: clip(weekly.error, 300) });
  if (proposals?.created) await ran(t, 'reporter', { status: 'done', summary: `분석·방향 카드 ${proposals.created}건`, title: `분석·방향 카드 ${proposals.created}건을 승인함에 올렸습니다`, link: '/s/marketing/approvals?tab=proposals' });
}
export async function noteResearcher(t: string, r: any) {
  if (r?.created) await ran(t, 'researcher', { status: 'done', summary: `주간 분석 ${r.week} — 광고 ${r.n}개`, title: `경쟁 광고 주간 분석(${r.week}) — 광고 ${r.n}개, 우리 대본 안`, link: '/s/marketing/ops#adrefs' });
  else if (r?.skipped === 'few') await ran(t, 'researcher', { status: 'skipped', summary: `지난 7일 새 광고 ${r.n ?? 0}개 — 3개부터 분석`, log: false });
  else if (r?.error) await ran(t, 'researcher', { status: 'error', summary: clip(r.error, 150), title: '경쟁 광고 주간 분석 — 실패', detail: clip(r.error, 300) });
}
export async function noteBudget(t: string, guard: any, recharge: any) {
  const alerts: any[] = Array.isArray(guard?.alerts) ? guard.alerts : [];
  const cards = Number(recharge?.created ?? recharge?.cards ?? 0) || 0;
  if (alerts.length || cards) await ran(t, 'budget', { status: 'done', summary: [alerts.length ? `충전 필요 알림 ${alerts.length}건` : '', cards ? `충전 카드 ${cards}건` : ''].filter(Boolean).join(' · '),
    title: alerts.length ? `충전 필요 알림: ${alerts.map((a) => `${a.provider} ${Math.round((a.rate ?? 0) * 100)}%`).join(', ')}` : `잔액 부족 — 충전 카드 ${cards}건`, link: '/s/marketing/ops' });
  else if (guard?.error || recharge?.error) await ran(t, 'budget', { status: 'error', summary: clip(guard?.error ?? recharge?.error, 150), title: '예산 점검 — 실패', detail: clip(guard?.error ?? recharge?.error, 300) });
  else await ran(t, 'budget', { status: 'skipped', summary: guard?.skipped === 'no_budget' ? '승인된 이달 예산 없음 — 잔액만 점검' : '이상 없음', log: false });
}

// ---------------- 보기 ----------------
function nextOf(role: Role, on: boolean, now: Date) {
  if (!on) return null;
  const h = hourKst(now); const today = ymd(now); const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = () => { const add = dow === 1 && h < 9 ? 0 : ((8 - dow) % 7 || 7); const d = new Date(Date.parse(`${today}T00:00:00Z`) + add * 864e5); return `${add === 0 ? '오늘' : '월요일'}(${d.getUTCMonth() + 1}/${d.getUTCDate()}) 09:00 이후`; };
  return ({ planner: h < 7 ? '오늘 07:00 이후' : '내일 07:00 이후', designer: '채택하면 바로', researcher: monday(), reporter: monday(), adsetter: '요청할 때', budget: '매시간', responder: '리드가 들어올 때' } as Record<Role, string>)[role];
}
/** 역할마다 요즘 숫자(카드 한두 줄) — 표가 없거나 실패하면 빈 줄 */
async function statsOf(t: string, today: string): Promise<Record<Role, string[]>> {
  const sql = db(); const out = Object.fromEntries(ROLE_KEYS.map((k) => [k, [] as string[]])) as Record<Role, string[]>;
  const safe = async (f: () => Promise<void>) => { try { await f(); } catch { /* 표 없음·실패 → 빈 줄 */ } };
  await safe(async () => {
    const [d] = await sql<{ n: number; a: number; r: number; p: number }[]>`select count(*)::int n, count(*) filter (where status = 'adopted')::int a, count(*) filter (where status = 'rejected')::int r, count(*) filter (where status = 'pending')::int p from mkt_team_ideas where tenant = ${t} and day = ${today}::date`;
    const [m] = await sql<{ a: number; d: number }[]>`select count(*) filter (where status = 'adopted')::int a, count(*) filter (where status in ('adopted', 'rejected'))::int d from mkt_team_ideas where tenant = ${t} and day > ${today}::date - 30`;
    out.planner.push(d.n ? `오늘 주제 ${d.n}개 · 채택 ${d.a} · 반려 ${d.r} · 대기 ${d.p}` : '오늘 주제 아직 없음');
    if (m.d) out.planner.push(`지난 30일 채택 ${m.a}/${m.d}(${Math.round((m.a / m.d) * 100)}%)`);
    const [g] = await sql<{ c: number; s: number; b: number; w: number }[]>`select count(*) filter (where result_type = 'carousel')::int c, count(*) filter (where result_type = 'carousel' and result_status = 'done')::int s, count(*) filter (where result_type = 'brief')::int b, count(*) filter (where result_status = 'working')::int w
      from mkt_team_ideas where tenant = ${t} and decided_at > now() - interval '30 days'`;
    out.designer.push(`지난 30일 카드뉴스 ${g.c}개(승인 요청 ${g.s}) · 제작 의뢰 ${g.b}개${g.w ? ` · 만드는 중 ${g.w}` : ''}`);
  });
  await safe(async () => {
    const [r] = await sql<{ n: number; s: number }[]>`select count(*)::int n, count(*) filter (where starred)::int s from mkt_ad_refs where tenant = ${t}`;
    const [rep] = await sql<{ at: string }[]>`select created_at as at from mkt_ad_ref_reports where tenant = ${t} order by created_at desc limit 1`;
    out.researcher.push(`보관함 ${r.n}개 · ★ 참고 ${r.s}개${rep ? ` · 마지막 분석 ${ymd(new Date(rep.at)).slice(5)}` : ''}`);
  });
  await safe(async () => {
    const [c] = await sql<{ p: number; m: number }[]>`select count(*) filter (where status = 'pending')::int p, count(*) filter (where created_at > now() - interval '30 days')::int m from mkt_concept_sets where tenant = ${t}`;
    const [a] = await sql<{ n: number }[]>`select count(*)::int n from mkt_ad_plans where tenant = ${t} and provider = 'meta' and status = 'created'`;
    out.adsetter.push(`상황 매트릭스 30일 ${c.m}개(채택 대기 ${c.p}) · 메타 광고 초안 대기 ${a.n}`);
  });
  await safe(async () => {
    const [b] = await sql<{ status: string; alerted: Record<string, string> | null }[]>`select status, alerted from mkt_ad_budgets where tenant = ${t} and month = ${today.slice(0, 7)}`;
    out.budget.push(b ? `이달 예산 ${b.status === 'approved' ? '승인됨' : '승인 대기'}${b.alerted && Object.keys(b.alerted).length ? ` · 충전 필요 알림 ${Object.keys(b.alerted).length}개 채널` : ''}` : '이달 예산 없음 — 운영실에서 계획');
  });
  await safe(async () => {
    const [l] = await sql<{ n: number; fast: number; late: number }[]>`select count(*)::int n, count(*) filter (where contacted_at is not null and contacted_at <= received_at + interval '5 minutes')::int fast,
      count(*) filter (where late_notified_at is not null)::int late from mkt_meta_leads where tenant = ${t} and not is_test and received_at > now() - interval '7 days'`;
    out.responder.push(l.n ? `지난 7일 리드 광고 신청 ${l.n}건 · 5분 안 첫 연락 ${l.fast}건 · 늦어서 다시 알림 ${l.late}건` : '지난 7일 리드 광고 신청 없음');
  });
  await safe(async () => {
    const [w] = await sql<{ at: string; status: string }[]>`select created_at as at, status from mkt_proposals where tenant = ${t} and kind = 'weekly' order by created_at desc limit 1`;
    const [p] = await sql<{ n: number }[]>`select count(*)::int n from mkt_proposals where tenant = ${t} and status = 'pending'`;
    out.reporter.push(`${w ? `마지막 주간 제안 ${ymd(new Date(w.at)).slice(5)}(${({ pending: '승인 대기', approved: '승인', rejected: '반려', done: '완료' } as Record<string, string>)[w.status] ?? w.status})` : '주간 제안 아직 없음'} · 승인 대기 카드 ${p.n}`);
  });
  return out;
}
/** 기록이 화면 밖 표에 있는 역할(광고 세팅·응대)은 그 표에서 최근 5줄 — 개인정보(이름·전화) 없이 */
async function derivedLogs(t: string) {
  const sql = db(); const out: Partial<Record<Role, { id: string; status: string; title: string; link: string | null; created_at: string }[]>> = {};
  try {
    const sets = await sql<{ id: string; product: string; status: string; n: number; created_at: string }[]>`select id, product, status, jsonb_array_length(concepts)::int n, created_at from mkt_concept_sets where tenant = ${t} order by created_at desc limit 5`;
    const S: Record<string, string> = { pending: '채택 대기', decided: '채택함', rejected: '반려', canceled: '취소' };
    out.adsetter = sets.map((s) => ({ id: s.id, status: 'done', title: `상황 매트릭스 «${s.product}» 컨셉 ${s.n}개 — ${S[s.status] ?? s.status}`, link: '/s/marketing/ops', created_at: s.created_at }));
  } catch { out.adsetter = []; }
  try {
    const leads = await sql<{ id: string; form_name: string | null; status: string; received_at: string; mins: number | null }[]>`select id, form_name, status, received_at, case when contacted_at is null then null else round(extract(epoch from contacted_at - received_at) / 60)::int end as mins
      from mkt_meta_leads where tenant = ${t} and not is_test order by received_at desc limit 5`;
    out.responder = leads.map((l) => ({ id: l.id, status: l.status === 'failed' ? 'error' : 'done', title: `리드 광고 신청${l.form_name ? ` «${l.form_name}»` : ''} — ${l.mins === null ? '첫 연락 기록 없음' : `${l.mins}분 만에 첫 연락`}`, link: '/s/sales/leads', created_at: l.received_at }));
  } catch { out.responder = []; }
  return out;
}
export async function teamView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u); const now = new Date(); const today = ymd(now);
  const rows = await sql<{ role: Role; enabled: boolean | null; settings: any; last_run_at: string | null; last_result: { status: string; summary: string } | null; updated_at: string }[]>`select role, enabled, settings, last_run_at, last_result, updated_at from mkt_team_roles where tenant = ${t}`;
  const byRole = new Map(rows.map((r) => [r.role, r]));
  const logs = await sql<{ id: string; role: Role; status: string; title: string; detail: string | null; link: string | null; created_at: string }[]>`select id, role, status, title, detail, link, created_at from (
      select l.*, row_number() over (partition by role order by created_at desc) rn from mkt_team_log l where tenant = ${t}) x where rn <= 5 order by created_at desc`;
  const mem = await sql<{ id: string; role: Role; brand_id: string | null; brand_name: string | null; kind: string; text: string; reason: string | null; created_by_name: string | null; created_at: string }[]>`
    select m.id, m.role, m.brand_id, b.name as brand_name, m.kind, m.text, m.reason, cu.name as created_by_name, m.created_at from mkt_team_memory m left join mkt_brands b on b.id = m.brand_id left join users cu on cu.id = m.created_by
    where m.tenant = ${t} order by (m.kind = 'note') desc, m.created_at desc limit 300`;
  const memCount = new Map((await sql<{ role: Role; n: number }[]>`select role, count(*)::int n from mkt_team_memory where tenant = ${t} group by role`).map((r) => [r.role, r.n]));
  const stats = await statsOf(t, today); const derived = await derivedLogs(t);
  const brands = await sql<{ id: string; name: string }[]>`select id, name from mkt_brands where tenant = ${t} and not test_mode order by coalesce(ad_priority, 999), name`;
  const pick: string[] = byRole.get('planner')?.settings?.brandIds ?? [];
  const roles = await Promise.all(ROLE_KEYS.map(async (k) => {
    const d = ROLES[k]; const r = byRole.get(k); const on = d.mode === 'toggle' ? (r?.enabled ?? d.def) : true;
    return { key: k, ...d, enabled: on, isDefault: d.mode === 'toggle' && (r?.enabled ?? null) === null, last: r?.last_run_at ? { at: r.last_run_at, ...(r.last_result ?? { status: 'done', summary: '' }) } : null, next: nextOf(k, on, now),
      stats: stats[k], records: derived[k] ?? logs.filter((l) => l.role === k), memory: mem.filter((m) => m.role === k).slice(0, 12), memoryCount: memCount.get(k) ?? 0, canRun: ['planner', 'researcher', 'reporter'].includes(k) };
  }));
  const ideas = await sql<any[]>`select i.id, i.brand_id, b.name as brand_name, i.day::text as day, i.title, i.hook, i.format, i.pattern, i.product, i.angle, i.basis, i.score, i.status, i.note, i.decided_at, du.name as decided_by_name,
      i.result_status, i.result_type, i.result_id, i.result_note, i.created_at
    from mkt_team_ideas i join mkt_brands b on b.id = i.brand_id left join users du on du.id = i.decided_by
    where i.tenant = ${t} and (i.day >= ${today}::date - 1 or i.status = 'pending' or i.result_status = 'working') order by i.day desc, coalesce(b.ad_priority, 999), b.name, i.created_at limit 60`;
  const resultLink = (x: any) => (x.result_type === 'brief' ? '/s/marketing/automation?tab=studio' : x.result_type === 'carousel' ? (x.result_status === 'done' ? '/s/marketing/approvals' : '/s/marketing/automation?tab=cards') : null);
  const Q = await import('./mktQuality'); const rules = await Q.qualityRules();
  const hookOf = (h: string | null) => (h ? Q.scoreHook(h, rules, [], 'content') : null); // 지금 채점 규칙으로 다시(규칙을 바꾸면 따라감)
  return { roles, ideas: ideas.map((x) => { const s = hookOf(x.hook); return { ...x, score: s?.score ?? null, pass: s?.pass ?? false, result_link: resultLink(x) }; }), today, brands: brands.map((b) => ({ ...b, planned: !pick.length || pick.includes(b.id) })), formats: IDEA_FORMATS, basis: BASIS,
    canDecide: isAdmin(u), aiEnabled: (await import('./ai/provider')).aiEnabled(), guides: (byRole.get('designer')?.settings?.guides ?? {}) as Record<string, string>, guideMax: GUIDE_MAX };
}
