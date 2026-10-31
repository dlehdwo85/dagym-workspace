import { db } from './db';
import { assertSpace } from './spaces';
import { tenantOf, type SessionUser } from './types';
import type { CardPage, VisualContent } from './mktAutoVisual';

/**
 * 295차 #835(대표 10/31 '레퍼런스를 하라고 분명 안내했는데 레퍼런스를 안 한 느낌 · 배경 단색에 글자 하나 툭'): 레퍼런스 대조표.
 * 승인 대기·수정 요청 글을 레퍼런스 기준(docs/handoff/MARKETING_REWORK_2026-10-25.md §2-1·BRAND_FEED_REFERENCE_2026-10-24.md)과 한 줄씩 나란히 —
 * 표지 = 사진·화면·도표 + 머리말(시리즈 라벨) · 사례형 장 수 · 사진 장 절반 이상 · 마지막 장 행동 권유 · 캡션 첫 줄 제목형 훅 · 해시태그는 끝에 묶음 · 사진 검사.
 * 블로그 = 표지 · 본문 사진 3장 이상 · 소제목(■) 2~3개 · 첫 줄 · 사진 검사. 영상은 제작 보류라 대조하지 않음. AI 호출 없음(저장된 시안 기록·사진 설명만 읽음).
 */
export type RefItem = { key: string; label: string; ok: boolean | null; detail: string };
export type RefRow = { id: string; brand: string; channel: string; kind: string | null; title: string; status: string; scheduledAt: string | null; items: RefItem[]; pass: number; total: number };

const VIDEO = ['reels', 'shorts', 'video'];
const HASH_ONLY = /^(?:#[^\s#]+\s*)+$/;

/** 캡션 첫 줄 = 제목형 훅(8~40자, 해시태그 줄 아님) */
export function hookOf(body: string): RefItem {
  const first = body.split('\n').map((l) => l.trim()).find((l) => l && !HASH_ONLY.test(l)) ?? '';
  const n = [...first].length;
  return { key: 'hook', label: '첫 줄 훅', ok: n >= 8 && n <= 40, detail: first ? `${n}자 — ${first.slice(0, 40)}` : '첫 줄 없음' };
}
/** 해시태그는 끝에 묶음(문장 사이에 섞이지 않게) */
export function tagsOf(body: string): RefItem {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  let k = lines.length; while (k > 0 && HASH_ONLY.test(lines[k - 1])) k--;
  const inline = lines.slice(0, k).filter((l) => /(^|\s)#[^\s#]+/.test(l)).length;
  const tail = lines.length - k;
  return { key: 'tags', label: '해시태그 끝에', ok: inline === 0, detail: inline ? `문장 사이 해시태그 ${inline}줄` : tail ? `끝에 ${tail}줄` : '해시태그 없음' };
}

/** 한 글의 대조 항목 — 저장된 시안 기록(quality.visual·pages·card)과 원고·붙은 파일 수로 */
export async function refItems(c: VisualContent & { quality?: any }, v: { body: string; media_ids: string[] }): Promise<RefItem[]> {
  const kind = c.kind ?? ''; const q = c.quality ?? {}; const vis = q.visual ?? null; const media = (v.media_ids ?? []).map(String); const body = v.body ?? '';
  if (VIDEO.includes(kind)) return [{ key: 'video', label: '영상', ok: null, detail: '영상 — 제작 보류라 대조하지 않음' }];
  const F = await import('./mktFeedTemplates'); const V = await import('./mktAutoVisual');
  const t = typeof vis?.template === 'string' ? vis.template : null;
  const label = t ? (F.FEED_TEMPLATES as Record<string, { label: string; need: string | null }>)[t]?.label ?? t : null;
  const need = t ? (F.FEED_TEMPLATES as Record<string, { need: string | null }>)[t]?.need ?? null : null;
  const coverVisual = !!vis && (!!vis.photoId || (Array.isArray(vis.photoIds) && vis.photoIds.length > 0) || ['screen', 'screen_wide'].includes(String(need)));
  const plain = !vis ? true : !!vis.plain || (t ? F.plainCover(t, { period: q.card?.period ?? '' }) && !coverVisual : !coverVisual);
  const items: RefItem[] = [{ key: 'cover', label: '표지 사진·화면·도표', ok: !!vis && !plain,
    detail: !vis ? '서버 시안 없음(사람이 붙인 시안이면 직접 확인)' : `${label ? `틀: ${label} · ` : ''}${plain ? '단색 바탕 + 글자' : vis.gen ? '사진(실사 참고 생성)' : coverVisual ? (['screen', 'screen_wide'].includes(String(need)) ? '앱 화면' : '실사') : '도표'}` }];
  const audit = vis ? await V.photoAudit(c, media, vis, Array.isArray(q.pages) ? q.pages : null, body).catch(() => null) : null;
  const auditItem: RefItem = { key: 'audit', label: '사진 검사', ok: audit ? audit.blur + audit.brand + audit.dup === 0 : null,
    detail: audit ? (audit.blur + audit.brand + audit.dup ? [audit.blur ? `흔들림 ${audit.blur}` : '', audit.brand ? `브랜드 밖 ${audit.brand}` : '', audit.dup ? `겹침 ${audit.dup}` : ''].filter(Boolean).join(' · ') : `실사 ${audit.total}장 문제 없음`) : '검사 못함' };
  if (c.channel === 'blog') {
    const photos = Math.max(0, media.length - 1);
    const { HEAD_LINE } = await import('./mktText'); const min = (await (await import('./mktQuality')).qualityRules().catch(() => null))?.blog?.minHeadings ?? 2;
    const heads = body.split('\n').filter((l) => HEAD_LINE.test(l.trim())).length; // 296차: 원고 규칙은 '■ 소제목' 4~6개(최소 = 회사 설정, 기본 2) — 위 상한 없음
    items.push({ key: 'photos', label: '본문 사진 3장+', ok: photos >= 3, detail: `${photos}장` },
      { key: 'heads', label: `소제목 ■ ${min}개+`, ok: heads >= min, detail: `${heads}개` }, hookOf(body), auditItem);
    return items;
  }
  const story = kind === 'story';
  const pages: CardPage[] = Array.isArray(q.pages) ? q.pages : [];
  const total = media.length;
  const kicker = String(q.card?.kicker ?? '').trim();
  const photoPages = pages.filter((p) => !!p.photoId).length + (coverVisual ? 1 : 0);
  const last = pages[pages.length - 1];
  items.push(
    { key: 'kicker', label: '표지 머리말', ok: !!kicker, detail: kicker || '머리말(시리즈 라벨) 없음' },
    story ? { key: 'count', label: '프레임 3~5', ok: total >= 3 && total <= 5, detail: `${total}프레임` } : { key: 'count', label: '장 수 4~8', ok: total >= 4 && total <= 8, detail: `${total}장` },
    { key: 'photoShare', label: '사진 장 절반 이상', ok: total > 0 && photoPages * 2 >= total, detail: `${photoPages}/${total}장${pages.some((p) => p.gen) ? ` (생성 ${pages.filter((p) => p.photoId && p.gen).length})` : ''}` },
    { key: 'cta', label: '마지막 장 행동', ok: story ? pages.length > 0 : last?.role === 'cta', detail: last ? `${last.role === 'cta' ? '행동 장' : last.role} — ${String(last.title ?? '').slice(0, 24)}` : '표지 뒤 장 없음' },
    hookOf(body), tagsOf(body), auditItem);
  return items;
}

/** 대조표 — 승인 대기·수정 요청(기본) 글 전부, 게시 예정 순 */
export async function refCheck(u: SessionUser, o: { status?: string[]; limit?: number } = {}): Promise<{ rows: RefRow[]; summary: { key: string; label: string; fail: number; of: number }[] }> {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const st = (o.status?.length ? o.status : ['pending', 'changes']).filter((x) => ['pending', 'changes', 'draft', 'approved'].includes(x));
  const rows = await sql<any[]>`select c.id, c.tenant, c.brand_id, c.title, c.channel, c.kind, c.created_by, c.is_test, c.current_version, c.status, c.quality, c.auto, c.scheduled_at,
      coalesce(b.name, '') as brand, v.body, v.media_ids
    from mkt_contents c left join mkt_brands b on b.id = c.brand_id
    join mkt_versions v on v.content_id = c.id and v.version = c.current_version
    where c.tenant = ${t} and c.status = any(${st}) and not coalesce(c.is_test, false)
    order by c.scheduled_at nulls last, c.created_at limit ${Math.min(o.limit ?? 100, 200)}`;
  const out: RefRow[] = [];
  for (const r of rows) {
    const items = await refItems(r, { body: r.body ?? '', media_ids: r.media_ids ?? [] });
    const judged = items.filter((i) => i.ok !== null);
    out.push({ id: r.id, brand: String(r.brand).replace(/^\s*\[시험\]\s*/, ''), channel: r.channel, kind: r.kind, title: r.title, status: r.status, scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
      items, pass: judged.filter((i) => i.ok).length, total: judged.length });
  }
  const keys = new Map<string, { label: string; fail: number; of: number }>();
  for (const r of out) for (const i of r.items) { if (i.ok === null) continue; const k = keys.get(i.key) ?? { label: i.label, fail: 0, of: 0 }; k.of++; if (!i.ok) k.fail++; keys.set(i.key, k); }
  return { rows: out, summary: [...keys.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.fail - a.fail) };
}
