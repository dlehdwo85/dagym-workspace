// 협력사 모집 감시 — 시공사·시행사 공지 페이지(로그인 불필요)를 돌며 '협력업체 모집/등록' 글을 공고로 적재. 원본 vendor_recruit_watch 이식(10/21).
// 감시 페이지 목록은 app_settings 'sales_vendor_watch_pages' ([{company, url}]) — 원본 VENDOR_WATCH_PAGES 21곳은 로컬이 넣는다(기본값 비어 있음).
import { createHash } from 'node:crypto';
import { db } from '../../db';
import { decodeKoreanText } from './files';
import { text as htmlText } from './kapt';
import { upsertNotices } from './store';
import type { Collector, CollectorCtx, CollectorResult } from './types';

export const RECRUIT_RE = /(협력\s*(업체|회사|사)|파트너사|신규\s*업체|업체\s*등록|정기\s*등록|우수\s*협력)[^<]{0,40}(모집|등록|공개|접수|신청|안내)/;
export type WatchPage = { company: string; url: string; encoding?: string };
export async function watchPages(): Promise<WatchPage[]> {
  if (process.env.SALES_COLLECT_TEST_BASE) return [{ company: '시험건설', url: `${process.env.SALES_COLLECT_TEST_BASE.replace(/\/$/, '')}/vendor/notice` }];
  const [s] = await db()<{ value: WatchPage[] }[]>`select value from app_settings where key = 'sales_vendor_watch_pages'`;
  return Array.isArray(s?.value) ? s.value.filter((p) => p && /^https?:\/\//.test(String(p.url))) : [];
}
const h8 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
/** 페이지 HTML → 모집 글 후보(제목·링크). 표 행·목록 항목·링크 텍스트를 검사 */
export function parseRecruit(html: string, base: string): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = []; const seen = new Set<string>();
  const add = (title: string, href: string | null) => { const t = htmlText(title).slice(0, 200); if (!t || !RECRUIT_RE.test(t.replace(/\s+/g, ' ')) || seen.has(t)) return; seen.add(t); let url = base; if (href) { try { url = new URL(href.replace(/&amp;/g, '&'), base).toString(); } catch { url = base; } } out.push({ title: t, url }); };
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) add(m[2], m[1]);
  for (const m of html.matchAll(/<(?:tr|li)\b[^>]*>([\s\S]*?)<\/(?:tr|li)>/gi)) { const href = m[1].match(/href="([^"]*)"/i)?.[1] ?? null; add(m[1], href); }
  return out.slice(0, 30);
}
export const vendorRecruitWatch: Collector = {
  slug: 'vendor_recruit_watch', label: '협력사 모집 감시', hourKst: 7, source: '시공사·시행사 공지 페이지(app_settings sales_vendor_watch_pages) — 협력업체 모집·등록 글',
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const pages = await watchPages(); if (!pages.length) return { inserted: 0, updated: 0, unchanged: 0, errors: 0, summary: '감시 페이지 목록이 비어 있습니다(app_settings sales_vendor_watch_pages)', providerMode: 'web_scrape' };
    const started = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - started); const errors: string[] = []; const items: Record<string, unknown>[] = []; const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    for (const p of pages) {
      if (left() < 6000) { errors.push(`시간 한도 근접 — ${p.company} 부터는 다음 실행에서`); break; }
      try { const res = await ctx.fetchImpl(p.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WorkIn-collector/1.0)' }, signal: AbortSignal.timeout(Math.min(10000, left() - 2000)) }); if (!res.ok) { errors.push(`${p.company}: HTTP ${res.status}`); continue; }
        const { text } = decodeKoreanText(new Uint8Array(await res.arrayBuffer()));
        for (const r of parseRecruit(text, p.url)) items.push({ source_type: 'vendor_recruit', source_external_id: `${h8(p.company)}-${h8(r.title)}`, source_url: r.url, title: `[${p.company}] ${r.title}`, issuer: p.company, notice_type: '협력사 모집', posted_date: today, bid_category: '협력사 모집' });
      } catch (e) { errors.push(`${p.company}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    const r = items.length ? await upsertNotices(items) : { inserted: 0, updated: 0, unchanged: 0, errors: 0, invalid: 0, errorLog: undefined as string | undefined }; if (r.errorLog) errors.push(r.errorLog);
    return { inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: r.errors + errors.length, errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'web_scrape', summary: `감시 ${pages.length}곳 · 모집 글 ${items.length}건 · 신규 ${r.inserted} · 변화없음 ${r.unchanged}` };
  },
};
