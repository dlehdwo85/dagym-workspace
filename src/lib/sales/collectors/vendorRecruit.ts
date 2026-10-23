// 협력사 모집 감시 — 시공사·시행사 공지 페이지(로그인 불필요)를 돌며 '협력업체 모집/등록' 글을 공고로 적재. 원본 vendor_recruit_watch 이식(10/21).
// 감시 페이지 목록은 app_settings 'sales_vendor_watch_pages' ([{company, url}]) — 원본 VENDOR_WATCH_PAGES 21곳은 로컬이 넣는다(기본값 비어 있음).
import { createHash } from 'node:crypto';
import { db } from '../../db';
import { decodeKoreanText } from './files';
import { text as htmlText } from './kapt';
import { upsertNotices } from './store';
import type { Collector, CollectorCtx, CollectorResult } from './types';

export const RECRUIT_RE = /(협력\s*(업체|회사|사)|파트너사|신규\s*업체|업체\s*등록|정기\s*등록|우수\s*협력)[^<]{0,40}(모집|등록|공개|접수|신청|안내)/;
export type WatchPage = { company: string; url: string; register_url?: string | null; encoding?: string };
export async function watchPages(): Promise<WatchPage[]> {
  if (process.env.SALES_COLLECT_TEST_BASE) return [{ company: '시험건설', url: `${process.env.SALES_COLLECT_TEST_BASE.replace(/\/$/, '')}/vendor/notice` }];
  const [s] = await db()<{ value: WatchPage[] }[]>`select value from app_settings where key = 'sales_vendor_watch_pages'`;
  return Array.isArray(s?.value) ? s.value.filter((p) => p && /^https?:\/\//.test(String(p.url))) : [];
}
const h8 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const kstToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
/** #476 e: 결과 공지·종료 안내·평가 결과 글은 모집 글이 아님 */
export const RECRUIT_EXCLUDE_RE = /결과\s*(공지|공고|발표|안내)|(선정|평가|심사)\s*결과|(종료|마감)\s*(안내|공지)|모집\s*(종료|마감)|합격자/;
/** 게시판 줄 글자에서 제목만: 앞 번호·[공지] · 뒤 조회수·Hit·추천·작성자·날짜·새 글 표시를 지움 */
export function cleanRecruitTitle(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim(); let prev = '';
  while (t !== prev) {
    prev = t;
    t = t.replace(/^(?!(?:19|20)\d{2}\s)\d{1,6}\s+/, '').replace(/^\[?\s*(?:공지|알림|필독|NEW|new)\s*\]?\s+/, '')
      .replace(/\s+(?:(?:(?:조회수?|Hit|HIT|hit|추천)\s*[:：]?\s*)+[\d,]+|(?:작성자|글쓴이|등록일|작성일|첨부파일)(?=[\s:：]|$)).*$/, '')
      .replace(/\s+(?:관리자|운영자|담당자|admin|Admin|ADMIN)\s*$/, '')
      .replace(/\s+(?:20\d{2}|\d{2})[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}\.?\s*$/, '').replace(/\s+\d{1,2}[.\-/]\d{1,2}\s*$/, '')
      .replace(/\s+[\d,]+\s*$/, '').replace(/(?:\s+\[?|\s*\[)(?:N|NEW|new|새\s*글)\]?\s*$/, '').trim();
  }
  return t;
}
const ymdOk = (y: number, m: number, d: number) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; };
/** 게시일: 2026.10.20 · 26.10.20 · 10-20(올해, 미래면 작년). 오늘 뒤 날짜는 버림. 'first' = 링크 바로 뒤 글자에서 처음 나온 날짜, 'max' = 줄 안 가장 늦은 날짜 */
export function postedDateOf(text: string, today: string, mode: 'first' | 'max' = 'max'): string | null {
  const ds: string[] = []; const year = Number(today.slice(0, 4));
  for (const m of text.matchAll(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g)) { const d = ymdOk(+m[1], +m[2], +m[3]); if (d) ds.push(d); }
  if (!ds.length) for (const m of text.matchAll(/(?<![\d.])(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(?![\d])/g)) { const d = ymdOk(2000 + +m[1], +m[2], +m[3]); if (d) ds.push(d); }
  if (!ds.length) for (const m of text.matchAll(/(?<![\d.:])(\d{1,2})[.\-/](\d{1,2})(?![\d.:])/g)) { const d = ymdOk(year, +m[1], +m[2]); const d2 = d && d > today ? ymdOk(year - 1, +m[1], +m[2]) : d; if (d2) ds.push(d2); }
  const ok = ds.filter((d) => d <= today);
  return !ok.length ? null : mode === 'first' ? ok[0] : ok.sort().at(-1)!;
}
const OLD_DAYS = 30;
const daysBefore = (today: string, n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
export type RecruitPost = { title: string; url: string; posted: string | null };
/** 페이지 HTML → 모집 글(제목·링크·게시일). 표 행·목록 항목은 줄 안 링크 글자를 제목으로, 나머지 글자에서 게시일 — #476 e: 30일 넘은 글·결과/종료 글 빼고, 날짜를 못 읽으면 posted = null */
export function parseRecruit(html: string, base: string, today = kstToday()): RecruitPost[] {
  return parseRecruitPage(html, base, today).posts;
}
/** posts + old(30일 넘은 모집 글 제목 — 예전에 수집일로 쌓인 줄을 숨기는 데 씀) */
export function parseRecruitPage(html: string, base: string, today = kstToday()): { posts: RecruitPost[]; old: Set<string> } {
  const out: RecruitPost[] = []; const seen = new Set<string>(); const old = new Set<string>(); const cutoff = daysBefore(today, OLD_DAYS);
  const add = (rawTitle: string, href: string | null, dateText: string, mode: 'first' | 'max') => {
    const t = cleanRecruitTitle(htmlText(rawTitle)).slice(0, 200);
    if (!t || !RECRUIT_RE.test(t) || RECRUIT_EXCLUDE_RE.test(t) || seen.has(t)) return; seen.add(t);
    const posted = postedDateOf(dateText, today, mode);
    if (posted && posted < cutoff) { old.add(t); return; }
    let url = base; if (href) { try { const u = new URL(href.replace(/&amp;/g, '&'), base); if (/^https?:$/.test(u.protocol)) url = u.toString(); } catch { url = base; } }
    out.push({ title: t, url, posted });
  };
  for (const m of html.matchAll(/<(tr|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const inner = m[2]; const a = inner.match(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/i); const row = htmlText(inner);
    if (a) add(a[2], a[1], row.replace(htmlText(a[2]), ' '), 'max'); else add(inner, null, row, 'max');
  }
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) add(m[2], m[1], htmlText(html.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 300)), 'first');
  return { posts: out.slice(0, 30), old };
}
/** #476 e: 예전 방식(줄 전체 글자 → 제목에 조회수·작성자 꼬리, 게시일 = 수집일)으로 쌓인 줄 정리 — 같은 글이면 새 키로 옮기고(처음 본 날 유지),
 * 꼬리가 붙은 옛 줄·결과/종료 글·지금 게시판에서 30일 넘은 글은 숨김(회사 진행 기록이 걸린 줄은 그대로) */
async function tidyOld(company: string, fresh: { ext: string; title: string; posted: string | null }[], old: Set<string>) {
  const sql = db(); let moved = 0, hidden = 0;
  const rows = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone and row->>'source_type' = 'vendor_recruit' and row->>'issuer' = ${company}`;
  const have = new Set(rows.map((r) => String(r.row.source_external_id)));
  const byTitle = new Map(fresh.map((f) => [f.title, f]));
  for (const r of rows) {
    const ext = String(r.row.source_external_id); if (fresh.some((f) => f.ext === ext)) continue;
    const bare = String(r.row.title ?? '').replace(/^\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ').trim(); const clean = cleanRecruitTitle(bare);
    const f = byTitle.get(clean);
    if (f && !have.has(f.ext)) {
      await sql`update sales_src_rows set row = row || ${sql.json({ source_external_id: f.ext, title: `[${company}] ${f.title}`, posted_date: f.posted } as never)}::jsonb, synced_at = now() where scope = 'global' and tbl = 'procurement_notices' and src_id = ${r.src_id}`;
      have.add(f.ext); moved++; continue;
    }
    if (clean === bare && !RECRUIT_EXCLUDE_RE.test(bare) && !old.has(clean)) continue; // 깨끗한 제목 = 목록에서 밀려났을 뿐
    const ids = [r.src_id, String(r.row.id ?? r.src_id)];
    const [used] = await sql<{ n: number }[]>`select ((select count(*) from sales_work_records where ref_id = any(${ids}::text[])) + (select count(*) from sales_src_rows w where w.scope <> 'global' and w.tbl in ('opportunity_work', 'procurement_notices__progress') and (w.src_id = any(${ids}::text[]) or w.row->>'notice_id' = any(${ids}::text[]) or w.row->>'procurement_notice_id' = any(${ids}::text[]))))::int as n`;
    if (used.n) continue;
    await sql`update sales_src_rows set gone = true, synced_at = now() where scope = 'global' and tbl = 'procurement_notices' and src_id = ${r.src_id}`; hidden++;
  }
  return { moved, hidden };
}
export const vendorRecruitWatch: Collector = {
  slug: 'vendor_recruit_watch', label: '협력사 모집 감시', hourKst: 7, source: '시공사·시행사 공지 페이지(app_settings sales_vendor_watch_pages) — 협력업체 모집·등록 글',
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const pages = await watchPages(); if (!pages.length) return { inserted: 0, updated: 0, unchanged: 0, errors: 0, summary: '감시 페이지 목록이 비어 있습니다(app_settings sales_vendor_watch_pages)', providerMode: 'web_scrape' };
    const started = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - started); const errors: string[] = []; const items: Record<string, unknown>[] = [];
    let noDate = 0, moved = 0, hidden = 0;
    for (const p of pages) {
      if (left() < 6000) { errors.push(`시간 한도 근접 — ${p.company} 부터는 다음 실행에서`); break; }
      try { const res = await ctx.fetchImpl(p.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WorkIn-collector/1.0)' }, signal: AbortSignal.timeout(Math.min(10000, left() - 2000)) }); if (!res.ok) { errors.push(`${p.company}: HTTP ${res.status}`); continue; }
        const { text } = decodeKoreanText(new Uint8Array(await res.arrayBuffer()));
        const page = parseRecruitPage(text, p.url); const fresh = page.posts.map((r) => ({ ...r, ext: `${h8(p.company)}-${h8(r.title)}` }));
        for (const r of fresh) { if (!r.posted) noDate++; items.push({ source_type: 'vendor_recruit', source_external_id: r.ext, source_url: r.url, title: `[${p.company}] ${r.title}`, issuer: p.company, notice_type: '협력사 모집', register_url: p.register_url && /^https?:\/\//.test(p.register_url) ? p.register_url : null, posted_date: r.posted, bid_category: '협력사 모집' }); }
        const t = await tidyOld(p.company, fresh, page.old); moved += t.moved; hidden += t.hidden;
      } catch (e) { errors.push(`${p.company}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    const r = items.length ? await upsertNotices(items) : { inserted: 0, updated: 0, unchanged: 0, errors: 0, invalid: 0, errorLog: undefined as string | undefined }; if (r.errorLog) errors.push(r.errorLog);
    return { inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: r.errors + errors.length, errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'web_scrape',
      summary: `감시 ${pages.length}곳 · 모집 글 ${items.length}건(최근 30일, 날짜 미상 ${noDate}) · 신규 ${r.inserted} · 변화없음 ${r.unchanged}` + (moved || hidden ? ` · 옛 줄 정리: 제목 고침 ${moved} · 숨김 ${hidden}` : '') };
  },
};
