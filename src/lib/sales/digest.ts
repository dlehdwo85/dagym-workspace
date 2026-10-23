// 당일 입찰 다이제스트(21라인 맞춤메일 역할) — 대표 10/21 08:45 ②③. 매일 회사 설정 시각(기본 08:00 KST) 그날 새로 들어온 공고(회사 맞춤 설정 통과분)를
// ① 메일(받는 사람 = 영업 담당·대표) ② 워크인 알림·앱 푸시 ③ 영업 홈 '오늘 새 공고' 카드로. 정정·취소는 별도 줄. 항목: 공고명·발주처·지역·추정가격·참가신청마감·입찰마감 D-day·출처·첨부·적합도.
import { z } from 'zod';
import { db } from '../db';
import { isAdmin } from '../access';
import { assertSpace } from '../spaces';
import { forbidden } from '../errors';
import { appUrl, sendMail } from '../mail';
import { notify } from '../notifications';
import { audit } from '../log';
import { zUuid } from '../api';
import { tenantOf, type SessionUser } from '../types';
import { matchFit } from './collectors/procurement';
import { vendorDateOk } from './collectors/vendorRules';
import { BID_COLLECTORS } from './collectors';

const SIDO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const words = z.array(z.string().trim().min(1).max(40)).max(50);
export const prefsInput = z.object({ keywords: words.optional(), excludes: words.optional(), regions: z.array(z.string().max(10)).max(17).optional(), issuers: words.optional(), itemCodes: z.array(z.string().trim().min(1).max(20)).max(50).optional(),
  amountMin: z.number().int().min(0).nullable().optional(), amountMax: z.number().int().min(0).nullable().optional(), digestEnabled: z.boolean().optional(), digestHour: z.number().int().min(0).max(23).optional(), digestMail: z.boolean().optional(), digestTo: z.array(zUuid).max(20).optional() });
export type Prefs = { keywords: string[]; excludes: string[]; regions: string[]; issuers: string[]; item_codes: string[]; amount_min: number | null; amount_max: number | null; digest_enabled: boolean; digest_hour: number; digest_mail: boolean; digest_to: string[] };
const DEF: Prefs = { keywords: [], excludes: [], regions: [], issuers: [], item_codes: [], amount_min: null, amount_max: null, digest_enabled: true, digest_hour: 8, digest_mail: true, digest_to: [] };
export async function prefsOf(tenant: string): Promise<Prefs> { const [p] = await db()<any[]>`select * from sales_bid_prefs where tenant = ${tenant}`; return p ? { ...DEF, ...p, amount_min: p.amount_min == null ? null : Number(p.amount_min), amount_max: p.amount_max == null ? null : Number(p.amount_max) } : { ...DEF }; }
export async function getPrefs(u: SessionUser) {
  await assertSpace(u, 'sales'); const t = tenantOf(u);
  const people = await db()<{ id: string; name: string; email: string; role: string }[]>`select u.id, u.name, u.email, u.role from users u where u.tenant = ${t} and u.status = 'active' and (u.role in ('owner', 'admin') or exists (select 1 from space_members m where m.user_id = u.id and m.spaces @> array['sales']::text[])) order by u.name`;
  const [last] = await db()<any[]>`select day, counts, items, mailed, notified, created_at from sales_digests where tenant = ${t} order by day desc limit 1`;
  return { prefs: await prefsOf(t), people, last: last ?? null, canEdit: isAdmin(u) };
}
export async function savePrefs(u: SessionUser, i: z.infer<typeof prefsInput>) {
  await assertSpace(u, 'sales'); if (!isAdmin(u)) throw forbidden('맞춤 설정은 관리자가 바꿉니다');
  const sql = db(); const t = tenantOf(u); const cur = await prefsOf(t);
  const n: Prefs = { keywords: i.keywords ?? cur.keywords, excludes: i.excludes ?? cur.excludes, regions: (i.regions ?? cur.regions).filter((r) => SIDO.includes(r)), issuers: i.issuers ?? cur.issuers, item_codes: i.itemCodes ?? cur.item_codes,
    amount_min: i.amountMin === undefined ? cur.amount_min : i.amountMin, amount_max: i.amountMax === undefined ? cur.amount_max : i.amountMax, digest_enabled: i.digestEnabled ?? cur.digest_enabled, digest_hour: i.digestHour ?? cur.digest_hour, digest_mail: i.digestMail ?? cur.digest_mail, digest_to: i.digestTo ?? cur.digest_to };
  await sql`insert into sales_bid_prefs (tenant, keywords, excludes, regions, issuers, item_codes, amount_min, amount_max, digest_enabled, digest_hour, digest_mail, digest_to, updated_by) values (${t}, ${n.keywords}, ${n.excludes}, ${n.regions}, ${n.issuers}, ${n.item_codes}, ${n.amount_min}, ${n.amount_max}, ${n.digest_enabled}, ${n.digest_hour}, ${n.digest_mail}, ${n.digest_to}::uuid[], ${u.id})
    on conflict (tenant) do update set keywords = excluded.keywords, excludes = excluded.excludes, regions = excluded.regions, issuers = excluded.issuers, item_codes = excluded.item_codes, amount_min = excluded.amount_min, amount_max = excluded.amount_max, digest_enabled = excluded.digest_enabled, digest_hour = excluded.digest_hour, digest_mail = excluded.digest_mail, digest_to = excluded.digest_to, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'sales_bid_prefs.save', 'tenant', null, { keywords: n.keywords.length, regions: n.regions }).catch(() => {});
  return prefsOf(t);
}
const kstDay = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const kstHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
const dayOf = (v: unknown) => { const s = String(v ?? ''); const m = s.match(/^(\d{4}-\d{2}-\d{2})/); if (!m) return null; if (/T|\s\d{2}:/.test(s)) { const d = new Date(s); return Number.isNaN(d.getTime()) ? m[1] : kstDay(d); } return m[1]; };
const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
export type DigestItem = { id: string; title: string; issuer: string | null; region: string | null; source: string; url: string; kind: string; fit: string | null; keywords: string[]; estimated: number | null; deadline: string | null; dday: number | null; participation: string | null; opening: string | null; attachments: number; why: string; seenAt?: string | null; late?: boolean };
/** #476 a: 지난 메일(그 전날까지의 마지막 다이제스트) 이후 처음 본 공고 — 그날 메일 뒤에 들어온 공고가 다음 날 메일에서 빠지지 않게. 3일 넘게 비었거나 처음이면 그날 0시(KST)부터 */
export async function digestSince(tenant: string, day: string): Promise<Date> {
  const start = new Date(`${day}T00:00:00+09:00`);
  const [prev] = await db()<{ created_at: Date }[]>`select created_at from sales_digests where tenant = ${tenant} and day < ${day} order by day desc limit 1`;
  const at = prev ? new Date(prev.created_at) : null;
  return at && at < start && start.getTime() - at.getTime() <= 3 * 864e5 ? at : start;
}
/** 회사 맞춤 필터: 우리 업종 적합(matchFit) 또는 관심 검색어 → 제외어·지역·발주처·금액으로 거름 */
export function passPrefs(r: any, p: Prefs): { ok: boolean; why: string } {
  const text = `${r.title ?? ''} ${r.bid_category ?? ''} ${r.task_scope ?? ''}`; const t = norm(text);
  if (p.excludes.some((w) => t.includes(norm(w)))) return { ok: false, why: '제외어' };
  const fit = r.fit_business ? String(r.fit_business) : matchFit(String(r.title ?? ''), r.bid_category, r.task_scope).fit;
  const kw = p.keywords.filter((w) => t.includes(norm(w)));
  if (!fit && !kw.length && r.source_type !== 'vendor_recruit') return { ok: false, why: '업종 무관' };
  if (p.regions.length) { const reg = String(r.region ?? r.region_restriction ?? ''); if (reg && !/전국/.test(reg) && !p.regions.some((s) => reg.includes(s))) return { ok: false, why: '지역' }; }
  if (p.issuers.length) { const iss = `${r.issuer ?? ''} ${r.demand_agency ?? ''}`; if (!p.issuers.some((w) => norm(iss).includes(norm(w)))) return { ok: false, why: '발주처' }; }
  if (p.item_codes.length) { const code = String(r.industry_code ?? r.item_code ?? ''); if (code && !p.item_codes.some((c) => code.includes(c))) return { ok: false, why: '물품코드' }; }
  const amt = r.estimated_amount ?? r.budget_amount; if (amt != null && amt !== '') { const n = Number(amt); if (p.amount_min != null && n < p.amount_min) return { ok: false, why: '금액 미만' }; if (p.amount_max != null && n > p.amount_max) return { ok: false, why: '금액 초과' }; }
  return { ok: true, why: [fit ? `적합 ${fit}` : null, kw.length ? `검색어 ${kw.join('·')}` : null, r.source_type === 'vendor_recruit' ? '협력사 모집' : null].filter(Boolean).join(' · ') };
}
const SRC: Record<string, string> = { kapt_bid: 'K-apt', g2b_bid: '나라장터', nuri_bid: '누리장터', g2b_prespec: '나라장터 사전규격', lh_bid: 'LH', lh_prespec: 'LH 사전규격', d2b_bid: '국방', onbid_lease: '온비드 임대', vendor_recruit: '협력사 모집' };
const SLUG_OF: Record<string, string> = { kapt_bid: 'kapt_bid_notices', g2b_bid: 'g2b_bid_notices', nuri_bid: 'g2b_bid_notices', g2b_prespec: 'g2b_prespec_awards', lh_bid: 'public_agency_bids', lh_prespec: 'public_agency_bids', d2b_bid: 'public_agency_bids', onbid_lease: 'public_agency_bids', vendor_recruit: 'vendor_recruit_watch' };
/** 지난 메일 이후(digestSince) 처음 본 공고 + 그 뒤 정정·취소로 바뀐 공고 → 회사 맞춤 통과분 */
export async function buildDigest(tenant: string, day = kstDay()) {
  const sql = db(); const p = await prefsOf(tenant);
  const off = new Set((await sql<{ slug: string }[]>`select slug from sales_collector_settings where tenant = ${tenant} and not enabled`).map((r) => r.slug));
  const since = await digestSince(tenant, day); const sinceMs = since.getTime(); const dayStart = Date.parse(`${day}T00:00:00+09:00`);
  // first_seen_at·updated_at 은 UTC ISO 문자열 — 하루 넓게 거르고(#148) 정확한 비교는 아래 시각으로
  const from = new Date(sinceMs - 864e5).toISOString().slice(0, 10);
  const rows = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where tbl = 'procurement_notices' and scope = 'global' and not gone and (row->>'first_seen_at' >= ${from} or row->>'updated_at' >= ${from}) limit 5000`;
  const items: DigestItem[] = []; const skipped: Record<string, number> = {};
  const at = (v: unknown) => { const t = Date.parse(String(v ?? '')); return Number.isNaN(t) ? null : t; };
  for (const { src_id, row: r } of rows) {
    const slug = SLUG_OF[String(r.source_type)] ?? ''; if (slug && off.has(slug)) continue;
    const seen = at(r.first_seen_at); const upd = at(r.updated_at);
    const isNew = seen != null && seen >= sinceMs; const kind = String(r.notice_kind ?? 'new'); const changedToday = upd != null && upd >= sinceMs && (kind === 'cancel' || kind === 'amend' || String(r.current_status ?? '') === '취소');
    if (!isNew && !changedToday) continue;
    if (r.source_type === 'vendor_recruit' && (!r.posted_date || !vendorDateOk(r))) { skipped['게시일 미상'] = (skipped['게시일 미상'] ?? 0) + 1; continue; } // #476 e·후속: 게시판 날짜로 확인 못 한 협력사 줄(조각·메뉴·예전 방식)은 메일·오늘 탭에서 뺌
    const f = passPrefs(r, p); if (!f.ok) { skipped[f.why] = (skipped[f.why] ?? 0) + 1; continue; }
    const deadline = dayOf(r.deadline_at); const dday = deadline ? Math.round((Date.parse(deadline) - Date.parse(day)) / 864e5) : null;
    if (dday != null && dday < 0) { skipped['마감 지남'] = (skipped['마감 지남'] ?? 0) + 1; continue; } // 첫 수집일에 과거 마감 공고가 '새 공고'로 섞이지 않게(로컬 10/21 10:55)
    items.push({ id: String(r.id ?? src_id), title: String(r.title ?? ''), issuer: r.issuer ?? r.demand_agency ?? null, region: r.region ?? null, source: SRC[String(r.source_type)] ?? String(r.source_type), url: String(r.source_url ?? ''), kind: String(r.current_status ?? '') === '취소' ? 'cancel' : isNew ? kind : kind,
      fit: r.fit_business ?? null, keywords: Array.isArray(r.matched_keywords) ? r.matched_keywords : [], estimated: r.estimated_amount != null ? Number(r.estimated_amount) : r.budget_amount != null ? Number(r.budget_amount) : null, deadline, dday, participation: dayOf(r.participation_deadline_at), opening: dayOf(r.opening_at), attachments: Array.isArray(r.attachment_urls) ? r.attachment_urls.length : 0, why: f.why, seenAt: r.first_seen_at ?? null, late: isNew && seen! < dayStart });
  }
  items.sort((a, b) => (a.kind === 'cancel' ? 1 : 0) - (b.kind === 'cancel' ? 1 : 0) || (a.dday ?? 999) - (b.dday ?? 999));
  const counts = { total: items.length, new: items.filter((i) => i.kind === 'new' || i.kind === 'urgent' || i.kind === 'rebid').length, amend: items.filter((i) => i.kind === 'amend').length, cancel: items.filter((i) => i.kind === 'cancel').length, skipped };
  return { day, since: since.toISOString(), items: items.slice(0, 200), counts, prefs: p };
}
const seenLabel = (v: string | null | undefined) => { if (!v) return ''; const d = new Date(v); if (Number.isNaN(d.getTime())) return ''; const p = Object.fromEntries(new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value])); return `${p.month}/${p.day} ${p.hour}:${p.minute}`; };
const won = (n: number | null) => (n == null ? '-' : n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${Math.round(n / 1e4).toLocaleString('ko-KR')}만원`);
export function digestText(company: string, d: Awaited<ReturnType<typeof buildDigest>>) {
  const line = (i: DigestItem, n: number) => `${n}. ${i.kind === 'cancel' ? '[취소] ' : i.kind === 'amend' ? '[정정] ' : i.kind === 'rebid' ? '[재공고] ' : i.kind === 'urgent' ? '[긴급] ' : ''}${i.late ? `[지난 메일 뒤 ${seenLabel(i.seenAt)} 수집] ` : ''}${i.title}\n   발주처 ${i.issuer ?? '-'} · 지역 ${i.region ?? '-'} · 추정 ${won(i.estimated)} · 입찰마감 ${i.deadline ?? '-'}${i.dday != null ? ` (D${i.dday >= 0 ? '-' : '+'}${Math.abs(i.dday)})` : ''}${i.participation ? ` · 참가신청 ${i.participation}` : ''}${i.opening ? ` · 개찰 ${i.opening}` : ''}\n   출처 ${i.source}${i.attachments ? ` · 첨부 ${i.attachments}` : ''} · 적합도 ${i.why}\n   ${i.url}`;
  const main = d.items.filter((i) => i.kind !== 'cancel' && i.kind !== 'amend'), amend = d.items.filter((i) => i.kind === 'amend'), cancel = d.items.filter((i) => i.kind === 'cancel');
  return [`[워크인 영업실] ${company} ${d.day} 당일 입찰 다이제스트 — 새 공고 ${d.counts.new}건 · 정정 ${d.counts.amend} · 취소 ${d.counts.cancel}`, '',
    main.length ? ['■ 새 공고(지난 메일 뒤 처음 본 공고)', ...main.map(line)].join('\n') : '■ 새 공고: 지난 메일 뒤 들어온 맞춤 공고가 없습니다', amend.length ? ['', '■ 정정 공고', ...amend.map(line)].join('\n') : '', cancel.length ? ['', '■ 취소 공고', ...cancel.map(line)].join('\n') : '', '',
    `전체 보기: ${appUrl()}/s/sales/bids?tab=today · 맞춤 설정: ${appUrl()}/s/sales/sources`, `걸러진 공고: ${Object.entries(d.counts.skipped).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}`].filter((x) => x !== '').join('\n');
}
/** 보내기(하루 1건, force 면 다시 만들어 덮어쓰고 다시 보냄). 받는 사람: digest_to 또는 영업 공간 대표·관리자 */
export async function sendDigest(tenant: string, opt: { force?: boolean; day?: string; actorId?: string | null } = {}) {
  const sql = db(); const day = opt.day ?? kstDay(); const p = await prefsOf(tenant);
  const [exists] = await sql<{ id: string }[]>`select id from sales_digests where tenant = ${tenant} and day = ${day}`;
  if (exists && !opt.force) return { sent: false, reason: 'already' };
  const d = await buildDigest(tenant, day);
  const [co] = await sql<{ name: string }[]>`select name from tenants where id = ${tenant}`;
  // #100: 받는 사람을 따로 안 정했으면 영업 담당 규칙(입찰) → 없으면 대표·관리자
  const rule = p.digest_to.length ? null : await (await import('../assignees')).resolveAssignee(sql, tenant, 'sales_source', 'bid').catch(() => null);
  const to = p.digest_to.length ? await sql<{ id: string; email: string }[]>`select id, email from users where id = any(${p.digest_to}::uuid[]) and tenant = ${tenant} and status = 'active'`
    : rule ? await sql<{ id: string; email: string }[]>`select id, email from users where id = ${rule.userId}`
    : await sql<{ id: string; email: string }[]>`select id, email from users where tenant = ${tenant} and status = 'active' and not is_demo and role in ('owner', 'admin') order by (role = 'owner') desc, created_at asc limit 1`; // #104: 담당 미지정이면 관리자 1명(대표 우선)에게만
  let mailed = 0, notified = 0; let mailError: string | null = null; let mailVia: string | null = null;
  if (d.items.length) {
    const text = digestText(co?.name ?? '', d);
    // 로컬 10/21 11:30: 회사 메일 경로(SMTP outbox → 워크인 발송)가 있으면 그쪽을 기본으로(한 통에 받는 사람 모두), 없으면 Resend(sendMail)
    if (p.digest_mail && to.length) {
      const subject = `[워크인 영업실] ${day} 당일 입찰 ${d.counts.total}건 — 새 공고 ${d.counts.new}`;
      const q = await (await import('../mailbox')).queueSystemMail(tenant, { to: to.map((u) => u.email), subject, text, createdBy: opt.actorId ?? to[0].id, fromName: `${co?.name ?? '워크인'} 영업실` }).catch((e) => { mailError ??= e instanceof Error ? e.message : String(e); return null; });
      if (q) { mailed = to.length; mailVia = q.channel; }
      else for (const u of to) { try { mailVia = await sendMail(u.email, subject, text); mailed++; } catch (e) { mailError ??= e instanceof Error ? e.message : String(e); /* 메일 경로 없음·실패면 알림만 — 사유는 기록 */ } }
    }
    notified = (await notify(sql, { userIds: to.map((u) => u.id), type: 'briefing', space: 'sales', title: `오늘 새 공고 ${d.counts.total}건 — ${d.items[0].title.slice(0, 40)}${d.items.length > 1 ? ' 외' : ''}`, body: d.items.slice(0, 3).map((i) => `${i.kind === 'cancel' ? '[취소] ' : i.kind === 'amend' ? '[정정] ' : ''}${i.title}${i.dday != null ? ` (D-${i.dday})` : ''}`).join('\n'), link: '/s/sales/bids?tab=today', push: true, dedupeKey: `salesdigest:${tenant}:${day}${opt.force ? `:${Date.now()}` : ''}` }).catch(() => [])).length;
  }
  await sql`insert into sales_digests (tenant, day, items, counts, mailed, notified) values (${tenant}, ${day}, ${sql.json(d.items as never)}, ${sql.json({ ...d.counts, mailError, mailVia, mailTo: to.length } as never)}, ${mailed}, ${notified}) on conflict (tenant, day) do update set items = excluded.items, counts = excluded.counts, mailed = excluded.mailed, notified = excluded.notified, created_at = now()`;
  if (opt.actorId) await audit(sql, opt.actorId, 'sales_digest.send', 'tenant', null, { day, total: d.counts.total, mailed, notified }).catch(() => {});
  return { sent: true, day, counts: { ...d.counts, mailError, mailVia, mailTo: to.length }, mailed, notified, mailError, mailVia, items: d.items.slice(0, 50) };
}
/** tick: 영업 공간 켠 회사마다 설정 시각 이후 하루 1번 */
export async function salesDigestTick() {
  const sql = db(); const hour = kstHour(); const day = kstDay(); let sent = 0;
  const tenants = await sql<{ id: string }[]>`select id from tenants where spaces @> array['sales']::text[] and coalesce(sales_bids, true)`;
  for (const t of tenants) {
    const p = await prefsOf(t.id); if (!p.digest_enabled || hour < p.digest_hour) continue;
    const [done] = await sql<{ id: string }[]>`select id from sales_digests where tenant = ${t.id} and day = ${day}`; if (done) continue;
    const r = await sendDigest(t.id, { day }).catch(() => null); if (r?.sent) sent++;
  }
  return { sent };
}
export async function sendDigestManual(u: SessionUser) { await assertSpace(u, 'sales'); if (!isAdmin(u)) throw forbidden('관리자만'); return sendDigest(tenantOf(u), { force: true, actorId: u.id }); }
export async function todayDigest(u: SessionUser) { await assertSpace(u, 'sales'); const t = tenantOf(u); const day = kstDay(); const [d] = await db()<any[]>`select day, items, counts, mailed, notified, created_at from sales_digests where tenant = ${t} and day = ${day}`; return d ?? { ...(await buildDigest(t, day)), preview: true }; }
export const BID_SOURCES = BID_COLLECTORS;
