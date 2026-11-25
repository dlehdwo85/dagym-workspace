/**
 * #1181 상업화 마감 3번(설계 docs/research/COMMERCIAL_DESIGN_2026-11-26.md A): 회사가 직접 넣는 수집 원천(게시판·RSS 주소).
 * - 회사당 10개 · 등록 때 주소 검사(내부 주소 막기·수집 금지 확인) · 하루 2번(09·15시 KST) 받기 + [지금 받기](하루 회사당 30번까지)
 * - 게시판: 표 줄·목록 항목 안 링크 글자 + 같은 줄의 게시일(최근 30일) → 글 · RSS/Atom: 항목 제목·링크·날짜
 * - 찾을 낱말이 있으면 제목에 그 낱말이 든 글만
 * - 회사 전용 표(sales_watch_items)에만 — 공용 공고 줄·다짐 목록과 섞이지 않음 · 고객에게는 상태만(원인 글은 운영자용)
 */
import { z } from 'zod';
import { db } from '../db';
import { audit } from '../log';
import { assertSpace } from '../spaces';
import { isAdmin } from '../access';
import { HttpError, badRequest, forbidden, notFound } from '../errors';
import { tenantOf, type SessionUser } from '../types';
import { assertPublicUrl, robotsBlocked, safeFetch } from '../safeFetch';
import { text as htmlText } from './collectors/kapt';
import { postedDateOf } from './collectors/vendorRules';

const MAX_SOURCES = 10; const DAILY_CHECKS = 30; const OLD_DAYS = 30;
const kstToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const daysBefore = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
const STATUS_LABEL: Record<string, string> = { new: '확인 전', ok: '연결됨', failed: '연결 안 됨', blocked: '사이트가 수집을 막음' };

export type WatchPost = { title: string; url: string; posted: string | null };
/** 게시판 HTML·RSS → 글. 날짜를 못 읽은 줄·30일 넘은 글은 뺌(RSS 는 날짜 없어도 넣음) */
export function parseWatch(body: string, base: string, today = kstToday()): WatchPost[] {
  const cutoff = daysBefore(today, OLD_DAYS); const out: WatchPost[] = []; const seen = new Set<string>();
  const abs = (h: string) => { try { const u = new URL(h.replace(/&amp;/g, '&').trim(), base); return /^https?:$/.test(u.protocol) ? u.toString() : base; } catch { return base; } };
  if (/<(rss|feed|rdf:RDF)\b/i.test(body.slice(0, 2000))) {
    for (const m of body.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
      const x = m[0]; const pick = (re: RegExp) => x.match(re)?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() ?? '';
      const title = htmlText(pick(/<title[^>]*>([\s\S]*?)<\/title>/i)).slice(0, 200);
      const link = pick(/<link[^>]*>([\s\S]*?)<\/link>/i) || (x.match(/<link[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1] ?? '');
      const dateRaw = pick(/<(?:pubDate|updated|published|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published|dc:date)>/i);
      const d = dateRaw ? new Date(dateRaw) : null; const posted = d && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d) : null;
      if (!title || seen.has(title) || (posted && posted < cutoff)) continue; seen.add(title);
      out.push({ title, url: abs(link || base), posted });
    }
    return out.slice(0, 50);
  }
  for (const m of body.matchAll(/<(tr|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const inner = m[2]; const a = inner.match(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/i); if (!a) continue;
    const title = htmlText(a[2]).replace(/\s+/g, ' ').trim().slice(0, 200); if (title.length < 4 || seen.has(title)) continue;
    const posted = postedDateOf(htmlText(inner).replace(htmlText(a[2]), ' '), today, 'max');
    if (!posted || posted < cutoff) continue; seen.add(title);
    out.push({ title, url: abs(a[1]), posted });
  }
  return out.slice(0, 50);
}

async function salesAdmin(u: SessionUser) { await assertSpace(u, 'sales'); if (!isAdmin(u) || u.isDemo) throw forbidden('대표·관리자만 바꿀 수 있습니다'); }

export async function watchView(u: SessionUser) {
  await assertSpace(u, 'sales');
  const sql = db(); const t = tenantOf(u);
  const sources = await sql<{ id: string; label: string; url: string; words: string[]; status: string; last_checked_at: Date | null; last_ok_at: Date | null; items: number }[]>`
    select s.id, s.label, s.url, s.words, s.status, s.last_checked_at, s.last_ok_at, (select count(*)::int from sales_watch_items i where i.source_id = s.id) as items
    from sales_watch_sources s where s.tenant = ${t} and s.deleted_at is null order by s.created_at`;
  const items = await sql<{ id: string; source_id: string; title: string; url: string; posted_date: string | null; first_seen_at: Date; task_id: string | null; label: string }[]>`
    select i.id, i.source_id, i.title, i.url, i.posted_date::text, i.first_seen_at, i.task_id, s.label from sales_watch_items i join sales_watch_sources s on s.id = i.source_id
    where i.tenant = ${t} and s.deleted_at is null and i.first_seen_at > now() - interval '30 days' order by i.first_seen_at desc, i.posted_date desc nulls last limit 100`;
  return { canEdit: isAdmin(u) && !u.isDemo, max: MAX_SOURCES, sources: sources.map((s) => ({ ...s, statusLabel: STATUS_LABEL[s.status] ?? s.status })), items };
}

export const watchInput = z.object({ label: z.string().trim().min(1).max(60), url: z.string().trim().min(8).max(500), words: z.array(z.string().trim().min(1).max(30)).max(10).optional() });
export async function addWatch(u: SessionUser, i: z.infer<typeof watchInput>, ip: string | null) {
  await salesAdmin(u);
  const sql = db(); const t = tenantOf(u);
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from sales_watch_sources where tenant = ${t} and deleted_at is null`;
  if (n >= MAX_SOURCES) throw badRequest(`수집 원천은 ${MAX_SOURCES}개까지 넣을 수 있습니다`);
  const url = (await assertPublicUrl(i.url)).toString();
  if (await robotsBlocked(url)) throw new HttpError(400, 'robots_blocked', '이 사이트는 자동 수집을 막아 두었습니다(robots.txt) — 등록할 수 없습니다');
  const [dup] = await sql`select 1 from sales_watch_sources where tenant = ${t} and url = ${url} and deleted_at is null`; if (dup) throw badRequest('이미 넣은 주소입니다');
  const [s] = await sql<{ id: string }[]>`insert into sales_watch_sources (tenant, label, url, words, created_by) values (${t}, ${i.label}, ${url}, ${(i.words ?? []).filter(Boolean)}, ${u.id}) returning id`;
  await audit(sql, u.id, 'sales.watch_add', 'sales_watch_source', s.id, { url }, ip);
  const first = await checkSource(s.id).catch(() => null); // 넣자마자 한 번 받아 봄(결과는 상태로)
  return { id: s.id, check: first };
}
export async function removeWatch(u: SessionUser, id: string, ip: string | null) {
  await salesAdmin(u);
  const r = await db()`update sales_watch_sources set deleted_at = now() where id = ${id} and tenant = ${tenantOf(u)} and deleted_at is null returning id`;
  if (!r.length) throw notFound();
  await audit(db(), u.id, 'sales.watch_remove', 'sales_watch_source', id, {}, ip);
  return { ok: true };
}
/** [지금 받기] — 회사당 하루 30번 */
export async function checkNow(u: SessionUser, id: string) {
  await salesAdmin(u);
  const sql = db(); const t = tenantOf(u);
  const [s] = await sql`select id from sales_watch_sources where id = ${id} and tenant = ${t} and deleted_at is null`; if (!s) throw notFound();
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from audit_logs where tenant = ${t} and action = 'sales.watch_check' and created_at > now() - interval '1 day'`.catch(() => [{ n: 0 }]);
  if (n >= DAILY_CHECKS) throw new HttpError(429, 'too_many', `[지금 받기]는 하루 ${DAILY_CHECKS}번까지입니다 — 하루 두 번(09·15시) 자동으로 받습니다`);
  await audit(sql, u.id, 'sales.watch_check', 'sales_watch_source', id, {}, null);
  return checkSource(id);
}

/** 한 원천 받기 → 새 글 저장 · 상태(3번 연속 실패 = 연결 안 됨) */
export async function checkSource(id: string): Promise<{ status: string; found: number; added: number }> {
  const sql = db();
  const [s] = await sql<{ id: string; tenant: string; url: string; words: string[]; fail_count: number }[]>`select id, tenant, url, words, fail_count from sales_watch_sources where id = ${id} and deleted_at is null`;
  if (!s) throw notFound();
  try {
    if (await robotsBlocked(s.url)) { await sql`update sales_watch_sources set status = 'blocked', last_checked_at = now(), last_error = 'robots.txt' where id = ${id}`; return { status: 'blocked', found: 0, added: 0 }; }
    const r = await safeFetch(s.url);
    if (r.status >= 400) throw new Error(`응답 ${r.status}`);
    const words = (s.words ?? []).map(norm).filter(Boolean);
    const posts = parseWatch(r.text, r.url).filter((p) => !words.length || words.some((w) => norm(p.title).includes(w)));
    let added = 0;
    for (const p of posts) {
      const x = await sql`insert into sales_watch_items (tenant, source_id, title, url, posted_date) values (${s.tenant}, ${id}, ${p.title}, ${p.url}, ${p.posted}) on conflict (source_id, url, title) do nothing returning id`;
      added += x.length;
    }
    await sql`update sales_watch_sources set status = 'ok', fail_count = 0, last_error = null, last_checked_at = now(), last_ok_at = now() where id = ${id}`;
    return { status: 'ok', found: posts.length, added };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 200); const fails = s.fail_count + 1;
    await sql`update sales_watch_sources set fail_count = ${fails}, status = ${fails >= 3 ? 'failed' : 'ok'}, last_error = ${msg}, last_checked_at = now() where id = ${id}`;
    return { status: fails >= 3 ? 'failed' : 'retry', found: 0, added: 0 };
  }
}

/** 정기: 09·15시(KST) 칸에 아직 안 받은 원천 — 한 번에 15곳·25초 안 */
export async function watchTick(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(now)) % 24;
  if (h !== 9 && h !== 15) return { skipped: 'not-slot' };
  const sql = db(); const started = Date.now();
  const due = await sql<{ id: string }[]>`select id from sales_watch_sources where deleted_at is null and status <> 'blocked' and (last_checked_at is null or last_checked_at < now() - interval '4 hours') order by last_checked_at nulls first limit 15`;
  let done = 0; for (const d of due) { if (Date.now() - started > 25_000) break; await checkSource(d.id).catch(() => null); done++; }
  return { done, due: due.length };
}

/** 글 → 업무(제목·원문 링크) — 영업 공간 사람 */
export async function watchToTask(u: SessionUser, itemId: string) {
  await assertSpace(u, 'sales');
  const sql = db(); const t = tenantOf(u);
  const [it] = await sql<{ id: string; title: string; url: string; task_id: string | null; label: string }[]>`select i.id, i.title, i.url, i.task_id, s.label from sales_watch_items i join sales_watch_sources s on s.id = i.source_id where i.id = ${itemId} and i.tenant = ${t}`;
  if (!it) throw notFound();
  if (it.task_id) return { taskId: it.task_id, already: true };
  const { createTask } = await import('../tasks');
  const task = await createTask(u, { title: it.title.slice(0, 200), description: `내 수집 원천 '${it.label}'에서 찾은 글\n${it.url}`, space: 'sales' } as never);
  const taskId = String(task.id);
  await sql`update sales_watch_items set task_id = ${taskId} where id = ${it.id}`;
  return { taskId, already: false };
}
