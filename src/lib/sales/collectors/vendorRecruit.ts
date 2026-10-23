// 협력사 모집 감시 — 시공사·시행사 공지 페이지(로그인 불필요)를 돌며 '협력업체 모집/등록' 글을 공고로 적재. 원본 vendor_recruit_watch 이식(10/21).
// 감시 페이지 목록은 app_settings 'sales_vendor_watch_pages' ([{company, url}]) — 원본 VENDOR_WATCH_PAGES 21곳은 로컬이 넣는다(기본값 비어 있음).
// #476 후속(로컬 10/23 14:20): 줄 = 게시일을 읽은 글만. 날짜 없는 줄(메뉴·고정 링크·안내문 조각·날짜를 못 읽은 제목)은 글로 쪼개지 않고
// 페이지별 '본 줄' 목록(app_settings 'sales_vendor_page_state')과 견줘, 처음 보는 줄이 생기면 '안내 페이지 바뀜' 1줄만 넣는다.
import { createHash } from 'node:crypto';
import { db } from '../../db';
import { decodeKoreanText } from './files';
import { text as htmlText } from './kapt';
import { upsertNotices } from './store';
import type { Collector, CollectorCtx, CollectorResult } from './types';
import { FRAGMENT_RE, PAGE_CHANGED, RECRUIT_EXCLUDE_RE, RECRUIT_RE, cleanRecruitTitle, isGenericLink, postedDateOf } from './vendorRules';

export { RECRUIT_RE, RECRUIT_EXCLUDE_RE, cleanRecruitTitle, postedDateOf } from './vendorRules';
export type WatchPage = { company: string; url: string; register_url?: string | null; encoding?: string };
export async function watchPages(): Promise<WatchPage[]> {
  if (process.env.SALES_COLLECT_TEST_BASE) return [{ company: '시험건설', url: `${process.env.SALES_COLLECT_TEST_BASE.replace(/\/$/, '')}/vendor/notice` }];
  const [s] = await db()<{ value: WatchPage[] }[]>`select value from app_settings where key = 'sales_vendor_watch_pages'`;
  return Array.isArray(s?.value) ? s.value.filter((p) => p && /^https?:\/\//.test(String(p.url))) : [];
}
const h8 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const kstToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const OLD_DAYS = 30;
const daysBefore = (today: string, n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
export type RecruitPost = { title: string; url: string; posted: string | null };
export type RecruitPage = { posts: RecruitPost[]; old: Set<string>; lines: string[] };
/** 페이지 HTML → 모집 글(제목·링크·게시일). 표 행·목록 항목은 줄 안 링크 글자를 제목으로, 나머지 글자에서 게시일 — #476 e: 30일 넘은 글·결과/종료 글 빼고 */
export function parseRecruit(html: string, base: string, today = kstToday()): RecruitPost[] {
  return parseRecruitPage(html, base, today).posts;
}
/** posts = 게시일을 읽은 최근 30일 글 · old = 30일 넘은 글 제목(예전에 쌓인 줄 숨김용) · lines = 날짜 없는 줄·페이지 조각(안내 페이지 바뀜 감시용) */
export function parseRecruitPage(html: string, base: string, today = kstToday()): RecruitPage {
  const out: RecruitPost[] = []; const seen = new Set<string>(); const old = new Set<string>(); const lines: string[] = []; const cutoff = daysBefore(today, OLD_DAYS);
  /** own = 링크 글자 안 날짜(대방건설처럼 게시판 줄 전체가 링크) · after = 줄 나머지/링크 뒤 글자 · loose = 표·목록 줄 밖 링크(메뉴·바닥 링크 뒤 글자의 날짜는 그 링크 날짜가 아님) */
  const add = (rawTitle: string, href: string | null, after: string, mode: 'first' | 'max', loose = false) => {
    const own = htmlText(rawTitle); const t = cleanRecruitTitle(own).slice(0, 200);
    if (!t || !RECRUIT_RE.test(t) || RECRUIT_EXCLUDE_RE.test(t) || seen.has(t)) return; seen.add(t);
    const inOwn = href ? postedDateOf(own, today, 'max', false) : null;
    const posted = inOwn ?? (loose && isGenericLink(t) ? null : postedDateOf(after, today, mode));
    if (!posted || FRAGMENT_RE.test(t)) { lines.push(t); return; }
    if (posted < cutoff) { old.add(t); return; }
    let url = base; if (href) { try { const u = new URL(href.replace(/&amp;/g, '&'), base); if (/^https?:$/.test(u.protocol)) url = u.toString(); } catch { url = base; } }
    out.push({ title: t, url, posted });
  };
  for (const m of html.matchAll(/<(tr|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const inner = m[2]; const a = inner.match(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/i); const row = htmlText(inner);
    if (a) add(a[2], a[1], row.replace(htmlText(a[2]), ' '), 'max'); else add(inner, null, row, 'max');
  }
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) add(m[2], m[1], htmlText(html.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 300)), 'first', true);
  return { posts: out.slice(0, 30), old, lines: lines.slice(0, 80) };
}

// ---------------- 안내 페이지 바뀜 감시 ----------------
// fails·restUntil: 로컬 10/23 '서희건설 시간 초과 반복' — 3번 연속 실패한 페이지는 3일 쉬고 다시(다른 페이지 시간을 잡아먹지 않게). seen 이 없으면 아직 기준 없음
type PageState = Record<string, { seen?: string[]; at?: string; changedAt?: string | null; fails?: number; restUntil?: string | null }>;
const FAIL_REST = 3, REST_DAYS = 3;
const kstMd = (iso: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(new Date(iso)).replace(/\.\s*/g, '/').replace(/\/$/, '');
const STATE_KEY = 'sales_vendor_page_state';
async function loadState(): Promise<PageState> {
  const [s] = await db()<{ value: PageState }[]>`select value from app_settings where key = ${STATE_KEY}`;
  return s?.value && typeof s.value === 'object' ? s.value : {};
}
async function saveState(s: PageState) {
  await db()`insert into app_settings (key, value) values (${STATE_KEY}, ${db().json(s as never)}) on conflict (key) do update set value = excluded.value, updated_at = now()`;
}
/** 처음 보는 줄 → '안내 페이지 바뀜' 1줄(게시일 = 바뀐 걸 본 날). 사라지기만 한 줄은 넣지 않음(모집 종료 등). 처음 감시하는 페이지는 기준만 저장 */
function pageChange(p: WatchPage, lines: string[], st: PageState[string] | undefined, today: string): { item: Record<string, unknown> | null; next: PageState[string]; baseline: boolean } {
  const at = new Date().toISOString();
  const seen = st?.seen;
  if (!seen) return { item: null, next: { seen: lines.slice(0, 200), at }, baseline: true };
  const added = lines.filter((l) => !seen.includes(l));
  if (!added.length) return { item: null, next: { ...st, at }, baseline: false };
  const best = added.find((l) => !FRAGMENT_RE.test(l) && !isGenericLink(l)) ?? added.find((l) => !FRAGMENT_RE.test(l)) ?? added[0];
  const item = { source_type: 'vendor_recruit', source_external_id: `${h8(p.company)}-chg-${h8([...added].sort().join('\n'))}`, source_url: p.url,
    title: `[${p.company}] 협력사 ${PAGE_CHANGED} — ${best.slice(0, 80)}${added.length > 1 ? ` 외 ${added.length - 1}줄` : ''}`, issuer: p.company, notice_type: '협력사 모집', notice_state: PAGE_CHANGED,
    register_url: p.register_url && /^https?:\/\//.test(p.register_url) ? p.register_url : null, posted_date: today, bid_category: '협력사 모집', task_scope: `새로 보인 줄 ${added.length}: ${added.slice(0, 5).join(' / ')}`.slice(0, 500) };
  return { item, next: { seen: [...new Set([...added, ...seen])].slice(0, 200), at, changedAt: at }, baseline: false };
}

/** 예전 방식(줄 전체 글자 → 제목에 조회수·작성자 꼬리, 게시일 = 수집일)·날짜 없는 줄로 쌓인 행 정리 — 같은 글이면 새 키로 옮기고(처음 본 날 유지),
 * 이번 게시판에서 게시일을 확인하지 못한 줄(꼬리·조각·메뉴·고정 링크·30일 넘은 글·결과 글)은 숨김. 회사 진행 기록이 걸린 줄은 남기되 게시일을 비움.
 * #476 후속 d: 협력사 모집 공용 분류 '즉시 검토' → '중장기 영업리드'. 원본 복사 줄(origin 'src')은 매일 차이분 가져오기가 되살리므로 건드리지 않음(화면·메일이 게시일을 믿지 않음) */
async function tidyOld(company: string, fresh: { ext: string; title: string; posted: string | null }[]) {
  const sql = db(); let moved = 0, hidden = 0, cleared = 0;
  const rows = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone and origin <> 'src' and row->>'source_type' = 'vendor_recruit' and row->>'issuer' = ${company}`;
  const have = new Set(rows.map((r) => String(r.row.source_external_id)));
  const byTitle = new Map(fresh.map((f) => [f.title, f])); const freshExt = new Set(fresh.map((f) => f.ext));
  for (const r of rows) {
    const ext = String(r.row.source_external_id); const patch: Record<string, unknown> = {};
    if (r.row.classification === '즉시 검토') patch.classification = '중장기 영업리드';
    const keep = freshExt.has(ext) || r.row.notice_state === PAGE_CHANGED || r.row.posted_checked === true;
    if (!keep) {
      const bare = String(r.row.title ?? '').replace(/^\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ').trim(); const f = byTitle.get(cleanRecruitTitle(bare));
      if (f && !have.has(f.ext)) {
        await sql`update sales_src_rows set row = row || ${sql.json({ ...patch, source_external_id: f.ext, title: `[${company}] ${f.title}`, posted_date: f.posted, posted_checked: true } as never)}::jsonb, synced_at = now() where scope = 'global' and tbl = 'procurement_notices' and src_id = ${r.src_id}`;
        have.add(f.ext); moved++; continue;
      }
      const ids = [r.src_id, String(r.row.id ?? r.src_id)];
      const [used] = await sql<{ n: number }[]>`select ((select count(*) from sales_work_records where ref_id = any(${ids}::text[])) + (select count(*) from sales_src_rows w where w.scope <> 'global' and w.tbl in ('opportunity_work', 'procurement_notices__progress') and (w.src_id = any(${ids}::text[]) or w.row->>'notice_id' = any(${ids}::text[]) or w.row->>'procurement_notice_id' = any(${ids}::text[]))))::int as n`;
      if (!used.n) { await sql`update sales_src_rows set gone = true, synced_at = now() where scope = 'global' and tbl = 'procurement_notices' and src_id = ${r.src_id}`; hidden++; continue; }
      if (r.row.posted_date) { patch.posted_date = null; cleared++; }
    }
    if (Object.keys(patch).length) await sql`update sales_src_rows set row = row || ${sql.json(patch as never)}::jsonb, synced_at = now() where scope = 'global' and tbl = 'procurement_notices' and src_id = ${r.src_id}`;
  }
  return { moved, hidden, cleared };
}
/** 이번에 게시판 날짜로 확인한 줄 표시 — 화면·메일은 이 표시(또는 안내 페이지 바뀜)가 있는 협력사 줄의 게시일만 믿음(vendorDateOk) */
async function markChecked(exts: string[]) {
  if (!exts.length) return;
  await db()`update sales_src_rows set row = row || ${db().json({ posted_checked: true } as never)}::jsonb where scope = 'global' and tbl = 'procurement_notices' and not gone and row->>'source_type' = 'vendor_recruit' and row->>'source_external_id' = any(${exts}) and (row->>'posted_checked') is distinct from 'true'`;
}
export const vendorRecruitWatch: Collector = {
  slug: 'vendor_recruit_watch', label: '협력사 모집 감시', hourKst: 7, source: '시공사·시행사 공지 페이지(app_settings sales_vendor_watch_pages) — 협력업체 모집·등록 글',
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const pages = await watchPages(); if (!pages.length) return { inserted: 0, updated: 0, unchanged: 0, errors: 0, summary: '감시 페이지 목록이 비어 있습니다(app_settings sales_vendor_watch_pages)', providerMode: 'web_scrape' };
    const started = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - started); const errors: string[] = []; const items: Record<string, unknown>[] = [];
    const state = await loadState(); const today = kstToday(); const checked: string[] = [];
    let posts = 0, moved = 0, hidden = 0, cleared = 0, changed = 0, baseline = 0; const resting: string[] = [];
    for (const p of pages) {
      if (left() < 6000) { errors.push(`시간 한도 근접 — ${p.company} 부터는 다음 실행에서`); break; }
      const st = state[p.url];
      if (st?.restUntil && st.restUntil > new Date().toISOString()) { resting.push(`${p.company}(${kstMd(st.restUntil)}까지)`); continue; }
      const fail = (msg: string) => { const n = (st?.fails ?? 0) + 1; const rest = n >= FAIL_REST ? new Date(Date.now() + REST_DAYS * 864e5).toISOString() : null;
        state[p.url] = { ...st, fails: n, restUntil: rest }; errors.push(`${p.company}: ${msg}${rest ? ` — ${n}번 연속 실패라 ${REST_DAYS}일 쉬고 다시 시도` : ''}`); };
      try { const res = await ctx.fetchImpl(p.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WorkIn-collector/1.0)' }, signal: AbortSignal.timeout(Math.min(10000, left() - 2000)) }); if (!res.ok) { fail(`HTTP ${res.status}`); continue; }
        const { text } = decodeKoreanText(new Uint8Array(await res.arrayBuffer()));
        const page = parseRecruitPage(text, p.url, today); const fresh = page.posts.map((r) => ({ ...r, ext: `${h8(p.company)}-${h8(r.title)}` }));
        for (const r of fresh) { posts++; checked.push(r.ext); items.push({ source_type: 'vendor_recruit', source_external_id: r.ext, source_url: r.url, title: `[${p.company}] ${r.title}`, issuer: p.company, notice_type: '협력사 모집', register_url: p.register_url && /^https?:\/\//.test(p.register_url) ? p.register_url : null, posted_date: r.posted, bid_category: '협력사 모집' }); }
        const pc = pageChange(p, page.lines, st, today); state[p.url] = { ...pc.next, fails: 0, restUntil: null }; if (pc.baseline) baseline++; if (pc.item) { items.push(pc.item); changed++; }
        const t = await tidyOld(p.company, fresh); moved += t.moved; hidden += t.hidden; cleared += t.cleared;
      } catch (e) { fail(e instanceof Error ? e.message : String(e)); }
    }
    const r = items.length ? await upsertNotices(items) : { inserted: 0, updated: 0, unchanged: 0, errors: 0, invalid: 0, errorLog: undefined as string | undefined }; if (r.errorLog) errors.push(r.errorLog);
    await markChecked(checked); await saveState(state);
    return { inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: r.errors + errors.length, errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'web_scrape',
      summary: `감시 ${pages.length}곳 · 모집 글 ${posts}건(최근 30일·게시일 있는 글) · ${PAGE_CHANGED} ${changed}` + (baseline ? `(처음 본 페이지 ${baseline}곳은 기준만 저장)` : '') + ` · 신규 ${r.inserted} · 변화없음 ${r.unchanged}`
        + (moved || hidden || cleared ? ` · 옛 줄 정리: 제목 고침 ${moved} · 숨김 ${hidden}${cleared ? ` · 게시일 지움 ${cleared}` : ''}` : '') + (resting.length ? ` · 쉬는 페이지 ${resting.length}: ${resting.join(', ')}` : '') };
  },
};
