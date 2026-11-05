// 279차 #828(대표 10/31 "입찰 공고문 KG2B에 있고 KAPT에는 공유만 되서 공고문을 못 갖고옴"): K-apt 에 'kg2b_번호'로 올라온 공고는 K-apt 상세에 첨부가 없고
// '해당 공고 가기'가 KG2B 상세(로그인 없이 열림 — 10/31 kg2b_142686 클라우드 확인)로 감 → KG2B 상세에서 현장설명·입찰 개시·개찰·참가 제한 지역·공고문 첨부를 읽어
// 공고 줄에 채움. 공고문이 생기면 참가자격 읽기(eligibilityTick)가 첨부 지문이 바뀐 것을 보고 다시 읽음. 담당자 칸(사람 이름·직함)은 저장하지 않음
import { db } from '../../db';
import type { SessionUser } from '../../types';
import { krFetch, needsKr, relayOn } from '../../krFetch';
/** 376차: KG2B 는 해외 IP 를 막음 → 서울 밖이면 서울 중계로(시험·서울 함수는 넘겨받은 fetch 그대로) */
const viaKr = (f: typeof fetch): typeof fetch => ((u: any, init?: any) => (needsKr(String(u)) && relayOn() ? krFetch(String(u), init) : f(u, init))) as typeof fetch;

const T = () => process.env.SALES_COLLECT_TEST_BASE?.replace(/\/$/, '');
export const kg2bBase = () => (T() ? `${T()}/kg2b` : 'https://www.kg2b.com');
export const kg2bCode = (ext: unknown) => /^kg2b_(\d{3,12})$/.exec(String(ext ?? '').trim())?.[1] ?? null;
export const kg2bDetailUrl = (code: string) => `${kg2bBase()}/user/bid_list/KaptBidView?bidcode=${encodeURIComponent(code)}`;
const unent = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const text = (h: string) => unent(h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
/** '2026-11-09 10:00' → '2026-11-09T10:00:00+09:00'(한국 시각) */
const kst = (v: string | undefined) => { const m = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(v ?? '').trim()); return m ? `${m[1]}T${(m[2] ?? '00').padStart(2, '0')}:${m[3] ?? '00'}:00+09:00` : null; };

export type Kg2bDetail = { noticeNo: string | null; bidStart: string | null; close: string | null; opening: string | null; openingPlace: string | null; region: string | null; industry: string | null;
  awardMethod: string | null; briefingKind: string | null; briefingAt: string | null; files: { name: string; url: string }[] };
/** KG2B 입찰 상세(KaptBidView) — 표의 th/td 짝 + 공고서 goLoad('경로','파일','bid','이름') → 내려받기 주소 */
export function parseKg2bDetail(html: string): Kg2bDetail {
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  const f: Record<string, string> = {};
  for (const m of body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) { const k = text(m[1]).replace(/\s/g, ''); if (k && !(k in f)) f[k] = text(m[2]); }
  const v = (k: string) => { const x = f[k]?.trim(); return x && x !== '-' ? x : null; };
  const files = [...html.matchAll(/goLoad\(\s*'([^']*)'\s*,\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g)].map(([, path, file, type, name]) => ({ name: unent(name).trim() || file,
    url: `${kg2bBase()}/common/util/download?file=${encodeURIComponent(file)}&filepath=${encodeURIComponent(path)}&type=${encodeURIComponent(type || 'bid')}&name=${encodeURIComponent(unent(name).trim() || file)}` }));
  const seen = new Set<string>();
  const b = v('현장설명회실시유무');
  return { noticeNo: v('공고번호'), bidStart: kst(v('입찰개시일시') ?? undefined), close: kst(v('입찰마감일시') ?? undefined), opening: kst(v('개찰일시') ?? undefined), openingPlace: v('개찰장소'), region: v('참가제한지역'),
    industry: v('업종')?.replace(/\/$/, '') ?? null, awardMethod: v('낙찰방법'),
    briefingKind: !b ? null : /없음|미실시|아니/.test(b) ? '없음' : /필수|의무/.test(b) ? '필수' : /임의|선택/.test(b) ? '임의' : b.slice(0, 20), briefingAt: kst(v('현설일시') ?? undefined),
    files: files.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true))) };
}

/** 공고 줄에 채울 칸 — 원래 값이 있으면 그대로(현장설명·지역·업종·낙찰 방법), 첨부는 합침, 개찰은 비었을 때만 */
export function kg2bPatch(row: Record<string, any>, d: Kg2bDetail, at = new Date().toISOString()) {
  const p: Record<string, unknown> = { kg2b_read_at: at, kg2b_url: kg2bDetailUrl(kg2bCode(row.source_external_id) ?? ''), kg2b_v: 2,
    // 280차(로컬 10/31 11:00 — K-apt '공고문 참조'보다 KG2B '현장설명회 없음'이 맞음): KG2B 값은 따로 두고 화면·메일이 먼저 씀(K-apt 다시 읽기가 덮어도 그대로)
    ...(d.briefingKind ? { kg2b_briefing_kind: d.briefingKind } : {}), ...(d.briefingAt ? { kg2b_briefing_at: d.briefingAt } : {}) };
  if (d.noticeNo) p.kg2b_notice_no = d.noticeNo;
  if (d.bidStart) p.bid_start_at = d.bidStart;
  if (d.opening && !row.opening_at) p.opening_at = d.opening;
  if (d.openingPlace) p.opening_place = d.openingPlace;
  if (d.region && !row.region_restriction) p.region_restriction = d.region;
  if (d.industry && !row.industry_code) p.industry_code = d.industry;
  if (d.awardMethod && !row.award_method) p.award_method = d.awardMethod;
  if (d.briefingKind && !row.site_briefing_kind) p.site_briefing_kind = d.briefingKind;
  if (d.briefingAt && !row.site_briefing_at) p.site_briefing_at = d.briefingAt;
  if (d.close && !row.deadline_at) p.deadline_at = d.close;
  const cur = Array.isArray(row.attachment_urls) ? row.attachment_urls : [];
  const urls = new Set(cur.map((x: any) => String(typeof x === 'string' ? x : x?.url ?? '')));
  const add = d.files.filter((x) => !urls.has(x.url));
  if (add.length) { p.attachment_urls = [...cur, ...add]; if (!row.notice_file_url) p.notice_file_url = add[0].url; }
  return { patch: p, added: add.length };
}

/**
 * 마감 전 관련 K-apt 공고 중 kg2b_ 번호이고 KG2B 상세를 아직 안 읽은 것(또는 하루 전에 읽었는데 공고문이 없던 것 — 350차 #938 ②: 매일 다시)을 한 번에 max 건 — 같은 번호 줄(원본 복사·워크인 수집)을 함께 고침.
 * 저장은 칸 합치기만(updated_at 그대로 — 당일 메일 '변경'에 다시 안 오름)
 */
export async function readKg2bDetails(fetchImpl: typeof fetch, left: () => number, max = 10) {
  const sql = db(); const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const rows = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone
      and row->>'source_type' = 'kapt_bid' and row->>'source_external_id' ~ '^kg2b_[0-9]{3,12}$' and coalesce(row->>'related', 'false') = 'true'
      and coalesce(row->>'deadline_at', '') >= ${today} and coalesce(row->>'current_status', '') !~ '취소|낙찰|유찰'
      and (coalesce(row->>'kg2b_read_at', '') = '' or coalesce(row->>'kg2b_v', '') <> '2' or (row->>'kg2b_read_at' < ${new Date(Date.now() - 1 * 864e5).toISOString()} and coalesce(jsonb_array_length(case when jsonb_typeof(row->'attachment_urls') = 'array' then row->'attachment_urls' end), 0) = 0))
    order by row->>'deadline_at' asc limit ${max * 3}`;
  const by = new Map<string, { src_id: string; row: any }[]>();
  for (const r of rows) { const k = String(r.row.source_external_id); if (!by.has(k)) by.set(k, []); by.get(k)!.push(r); }
  const out = { read: 0, files: 0, attached: 0, errors: [] as string[] };
  const done: string[] = [], missed: { key: string; title: string | null; err: { code: string; message: string } }[] = [];
  for (const [ext, group] of [...by.entries()].slice(0, max)) {
    if (left() < 8000) break;
    const code = kg2bCode(ext)!;
    try {
      const res = await viaKr(fetchImpl)(kg2bDetailUrl(code), { headers: { 'User-Agent': 'Mozilla/5.0 (WorkIn sales)' }, signal: AbortSignal.timeout(relayOn() ? 20000 : 8000), redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = parseKg2bDetail(await res.text());
      if (!d.noticeNo && !d.files.length && !d.close) throw new Error('KG2B 상세 칸을 못 읽음(화면이 바뀜?)');
      for (const g of group) {
        const { patch, added } = kg2bPatch(g.row, d);
        await sql`update sales_src_rows set row = row || ${sql.json(patch as never)}::jsonb, synced_at = now() where scope = 'global' and tbl = 'procurement_notices' and src_id = ${g.src_id}`;
        out.files += added;
      }
      out.read++; done.push(ext);
      if (d.files.length && left() > 15000) out.attached += await attachToOpenTasks(group.map((g) => g.src_id)).catch(() => 0);
    } catch (e) {
      const msg = fetchErr(e); if (out.errors.length < 5) out.errors.push(`KG2B 상세 ${ext}: ${msg}`);
      // 376차(로컬 11/06 "못 읽은 kg2b_ 공고는 #994 '못 함'으로 남겨 다시 채워 주세요"): 관리 › 운영 상태 '빠졌던 날'에 남고, 다음 실행이 다시 읽으면 '다시 채움'
      const http = /^HTTP (\d{3})/.exec(e instanceof Error ? e.message : ''); missed.push({ key: ext, title: group[0].row?.title ?? null, err: { code: http ? `http_${http[1]}` : /못 읽음/.test(msg) ? 'kg2b_parse' : 'kg2b_fetch', message: msg } });
    }
  }
  // 못 함·다시 채움 기록(공용 공고 = 'global') — 실패해도 수집은 그대로
  const { noteSkip, noteDone } = await import('../../ai/skips');
  for (const m of missed) await noteSkip(sql, 'global', 'kg2b_detail', m.key, m.title, m.err);
  await noteDone(sql, 'global', 'kg2b_detail', done);
  return out;
}

/**
 * 280차(로컬 10/31 11:00 — 이미 넘긴 업무 '[입찰] 천안푸르지오레이크사이드…' 첨부 0): KG2B 에서 공고문을 새로 찾으면 그 공고에서 넘어온 열린 입찰 업무에도 붙임
 * (#507 자동 첨부와 같은 길 — 자료실 '영업/공고/…'에 한 번 받아 두고 업무에 연결). 붙이는 사람 = 업무 요청자(없으면 담당). 한 번에 3건
 */
async function attachToOpenTasks(srcIds: string[]) {
  const sql = db();
  const tasks = await sql<{ id: string; ref: string; actor: string | null }[]>`select t.id, t.sales_ref->>'id' as ref, coalesce(t.requested_by, t.assignee_id) as actor from tasks t
    where t.deleted_at is null and t.status <> 'done' and t.sales_ref->>'kind' = 'bid' and t.sales_ref->>'id' = any(${srcIds}::text[])
      and not exists (select 1 from attachments a where a.task_id = t.id and a.source = 'sales_auto' and a.deleted_at is null) limit 3`;
  let n = 0;
  for (const t of tasks) {
    if (!t.actor) continue;
    const [r] = await sql<any[]>`select u.id, u.email, u.name, u.role, u.status, u.timezone, u.is_demo, u.platform_admin, u.tenant from users u where u.id = ${t.actor} and u.status = 'active'`;
    if (!r) continue;
    const u = { id: r.id, email: r.email, name: r.name, role: r.role, status: r.status, timezone: r.timezone, sessionId: '', isDemo: r.is_demo, platformAdmin: r.platform_admin, tenant: r.tenant } as SessionUser;
    const { attachSourceFiles } = await import('../autoAttach');
    const res = await attachSourceFiles(u, { kind: 'bid', id: t.ref, taskIds: [t.id] }).catch(() => null);
    if (res?.ok) n++;
  }
  return n;
}

// 373차 #996(대표 11/05 "KG2B 에서도 긁어 오고 있는가? 산업단지는 KG2B 에 올라오는 경우가 간혹 있음"): 지금은 K-apt 에 'kg2b_번호'로 공유된 공고만 KG2B 상세를 읽음 →
// K-apt 에 없는 KG2B 공고(집합건물·상가·지식산업센터·산업단지 관리단 등)를 놓침. KG2B 자체 입찰 목록(/user/bid_list/bidAll — 로그인 없이 열림, 11/05 클라우드 확인:
// 진행 공고 736건·한 장 10줄·74장, 다음 장은 같은 화면의 theForm(__encrypted) POST)을 받아 '이미 있음 / 새로 받을 것 / 관련 / 건물 종류'만 세는 미리 보기 — 저장 안 함.
// 실제 수집 켜기는 대표 결정 뒤(KG2B 화면 아래 '허락없이 링크하거나 상업적인 용도로 사용할 수 없습니다' 문구 — 고객사에 보여 주는 범위를 정해야 함). 요청 간격 1.2초.
export type Kg2bListRow = { code: string; noticeNo: string | null; title: string; issuer: string | null; industry: string | null; region: string | null;
  briefingAt: string | null; openingAt: string | null; posted: string | null; kinds: string[] };
const yy = (v: string | undefined) => { const m = /^(\d{2})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(v ?? '').trim()); return m ? `20${m[1]}-${m[2]}-${m[3]}T${(m[4] ?? '00').padStart(2, '0')}:${m[5] ?? '00'}:00+09:00` : null; };
/** KG2B 입찰 목록 한 장 — 줄: 번호 · 공고 종류 그림(전자·현설·재입찰…)+공고번호 · 공고명(goAction('view','코드'))+발주처 · 업종+지역 · 현설일+개찰일 */
export function parseKg2bList(html: string): { rows: Kg2bListRow[]; total: number | null; enc: string | null } {
  const rows: Kg2bListRow[] = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const code = /goAction\(\s*'view'\s*,\s*'(\d{3,12})'/.exec(tr)?.[1]; if (!code) continue;
    const td: string[] = [...(tr.replace(/<script[\s\S]*?<\/script>/gi, ' ').match(/<td[\s\S]*?<\/td>/gi) ?? [])];
    const cell = td.find((c) => c.includes(`'${code}'`)) ?? '';
    const a = /<a[^>]*>([\s\S]*?)<\/a>/i.exec(cell)?.[1] ?? ''; const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(cell)?.[1] ?? '';
    const i = td.indexOf(cell); const ind = td[i + 1] ?? '', dates = td[i + 2] ?? '';
    const noticeNo = /class="notinum"[^>]*>([\s\S]*?)<\/p>/i.exec(tr)?.[1] ? text(/class="notinum"[^>]*>([\s\S]*?)<\/p>/i.exec(tr)![1]) : null;
    const h4 = /<h4[^>]*>([\s\S]*?)<\/h4>/i.exec(ind)?.[1]; const h5 = /<h5[^>]*>([\s\S]*?)<\/h5>/i.exec(dates)?.[1];
    const d = /^(\d{4})(\d{2})(\d{2})/.exec(noticeNo ?? '');
    rows.push({ code, noticeNo, title: text(a), issuer: text(p) || null, industry: text(ind.replace(/<h4[\s\S]*?<\/h4>/i, '')) || null, region: h4 ? text(h4) || null : null,
      briefingAt: yy(text(dates.replace(/<h5[\s\S]*?<\/h5>/i, ''))), openingAt: h5 ? yy(text(h5)) : null, posted: d ? `${d[1]}-${d[2]}-${d[3]}` : null,
      kinds: [...tr.matchAll(/<img[^>]*alt="([^"]+)"/gi)].map((m) => m[1]).slice(0, 4) });
  }
  const total = /공고수\s*:\s*([\d,]+)\s*건/.exec(text(html))?.[1]; const f = html.indexOf('name="theForm"');
  const enc = f >= 0 ? /name="__encrypted"\s+value="([^"]+)"/.exec(html.slice(f))?.[1] ?? null : null;
  return { rows, total: total ? Number(total.replace(/,/g, '')) : null, enc };
}
/** 발주처 이름으로 건물 종류 짐작 — K-apt(공동주택)에 없는 쪽이 이번에 새로 얻는 몫 */
export function kg2bIssuerKind(issuer: string | null, title = ''): '산업단지·지식산업센터' | '집합건물·상가·오피스텔' | '공동주택(추정)' {
  // 제목의 '커뮤니티센터'·'상가 보수' 같은 말은 아파트 공고에도 흔함 → 건물 종류는 발주처 이름으로(없을 때만 제목), 산업단지만 제목도 봄
  const s = String(issuer ?? '').trim() || title;
  if (/산업단지|산단|지식산업센터|테크노(?:파크|밸리|타워)|벤처타운|아파트형\s*공장|공단/.test(`${s} ${title}`)) return '산업단지·지식산업센터';
  if (/관리단|빌딩|오피스텔|상가|타워|프라자|플라자|스퀘어|쇼핑몰|센터/i.test(s) && !/아파트|APT|입주자\s*대표/i.test(s)) return '집합건물·상가·오피스텔';
  return '공동주택(추정)';
}
export async function previewKg2bList(opts: { pages?: number; days?: number } = {}, fetchImpl0: typeof fetch = fetch) {
  const fetchImpl = viaKr(fetchImpl0);
  const pages = Math.min(Math.max(1, Math.floor(opts.pages ?? 8)), 20), days = Math.min(Math.max(1, Math.floor(opts.days ?? 14)), 30);
  const since = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() - days * 864e5));
  const url = `${kg2bBase()}/user/bid_list/bidAll`; const UA = 'Mozilla/5.0 (WorkIn sales)'; const t0 = Date.now();
  let cookie = ''; const keep = (r: Response) => { const sc = (r.headers as any).getSetCookie?.() as string[] | undefined; const c = (sc ?? []).map((x) => x.split(';')[0]).filter(Boolean); if (c.length) cookie = c.join('; '); };
  const all: Kg2bListRow[] = []; const seen = new Set<string>(); let total: number | null = null, enc: string | null = null, read = 0, stop = '', retried = false; const errors: string[] = [];
  for (let page = 1; page <= pages; page++) {
    if (page > 1) { if (!enc) { stop = '다음 장 열쇠(__encrypted) 없음'; break; } if (Date.now() - t0 > 40_000) { stop = '40초 넘음'; break; } await new Promise((r) => setTimeout(r, 1200)); }
    try {
      const res = page === 1 ? await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000), redirect: 'follow' })
        : await fetchImpl(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: url, ...(cookie ? { Cookie: cookie } : {}) },
          body: new URLSearchParams({ method: 'bidAlllist', currentPage: String(page), tabkind: '', __encrypted: enc! }).toString(), signal: AbortSignal.timeout(12_000), redirect: 'follow' });
      keep(res); read++;
      if (!res.ok) { errors.push(`${page}장 HTTP ${res.status}`); break; }
      const p = parseKg2bList(await res.text()); total = total ?? p.total; enc = p.enc ?? enc;
      const fresh = p.rows.filter((r) => !seen.has(r.code)); fresh.forEach((r) => seen.add(r.code)); all.push(...fresh);
      if (!fresh.length) { stop = `${page}장에 새 줄 없음`; break; }
      if (fresh.every((r) => r.posted && r.posted < since)) { stop = `${page}장이 모두 ${days}일 전`; break; }
    } catch (e) {
      // 374차(로컬 11/06 02:40 운영 'fetch failed' 10.5초): 원인(코드·시스템 호출·주소)을 그대로 남기고 첫 장은 2초 뒤 한 번 더
      if (page === 1 && !retried) { retried = true; errors.push(`1장 ${fetchErr(e)} — 2초 뒤 다시`); await new Promise((r) => setTimeout(r, 2000)); page = 0; continue; }
      errors.push(`${page}장 ${fetchErr(e)}`); break;
    }
  }
  const inRange = all.filter((r) => !r.posted || r.posted >= since);
  const have = new Set((await db()<{ ext: string }[]>`select row->>'source_external_id' as ext from sales_src_rows where scope = 'global' and tbl = 'procurement_notices'
    and row->>'source_external_id' = any(${inRange.map((r) => `kg2b_${r.code}`)})`).map((x) => x.ext));
  const { matchFit } = await import('./procurement');
  const scored = inRange.map((r) => { const f = matchFit(r.title, r.industry); return { ...r, already: have.has(`kg2b_${r.code}`), fit: f.fit, kind: kg2bIssuerKind(r.issuer, r.title) }; });
  const byKind: Record<string, { n: number; notInDb: number; related: number; relatedNew: number }> = {};
  const byDay: Record<string, number> = {};
  for (const r of scored) { const k = (byKind[r.kind] ??= { n: 0, notInDb: 0, related: 0, relatedNew: 0 }); k.n++; if (!r.already) k.notInDb++; if (r.fit) { k.related++; if (!r.already) k.relatedNew++; } if (r.posted) byDay[r.posted] = (byDay[r.posted] ?? 0) + 1; }
  const pick = (r: (typeof scored)[number]) => ({ code: r.code, noticeNo: r.noticeNo, title: r.title, issuer: r.issuer, industry: r.industry, region: r.region, posted: r.posted, openingAt: r.openingAt, kind: r.kind, fit: r.fit, already: r.already });
  const notIn = scored.filter((r) => !r.already);
  return { source: url, region: process.env.VERCEL_REGION ?? null, days, since, pagesRead: read, total, rows: scored.length, stop: stop || (read >= pages ? `${pages}장까지(최대)` : ''), errors, ms: Date.now() - t0,
    already: scored.length - notIn.length, notInDb: notIn.length, related: scored.filter((r) => r.fit).length, relatedNew: notIn.filter((r) => r.fit).length, byKind, byDay,
    examples: [...notIn.filter((r) => r.fit), ...notIn.filter((r) => !r.fit && r.kind !== '공동주택(추정)'), ...notIn.filter((r) => !r.fit && r.kind === '공동주택(추정)')].slice(0, 15).map(pick),
    alreadyExamples: scored.filter((r) => r.already).slice(0, 3).map(pick), saved: 0 };
}

/** 374차: fetch 실패 원인 한 줄 — 'fetch failed' 뒤에 숨은 cause(코드·errno·syscall·주소)까지 */
export function fetchErr(e: unknown): string {
  const x = e as any, c = x?.cause, cc = c?.cause;
  const parts = [x?.name, x?.message, c?.code, c?.errno, c?.syscall, c?.hostname ?? c?.address, c?.message, cc?.code, cc?.message].filter((v) => v != null && v !== '').map(String);
  return parts.filter((v, i) => parts.indexOf(v) === i).join(' · ').slice(0, 300) || String(e);
}
/** 374차(로컬 11/06 02:40 — 운영 서버에서 KG2B 첫 장 'fetch failed', 노트북 국내 회선은 열림): 이 서버에서 KG2B 까지 어디서 막히는지(이름 찾기·연결·첫 화면·목록)
 *  — 싱가포르(sin1, 기본)와 서울(icn1, /api/platform/kg2b) 두 곳에서 불러 비교. 저장 안 함 */
export async function kg2bProbe(fetchImpl: typeof fetch = fetch) {
  const base = new URL(kg2bBase()); const host = base.hostname; const port = Number(base.port) || (base.protocol === 'http:' ? 80 : 443);
  const timed = async <T extends object>(f: () => Promise<T>) => { const t = Date.now(); try { const v = await f(); return { ok: true, ms: Date.now() - t, ...v }; } catch (e) { return { ok: false, ms: Date.now() - t, error: fetchErr(e) }; } };
  const dns = await timed(async () => ({ addresses: (await (await import('node:dns/promises')).lookup(host, { all: true })).map((a) => a.address).slice(0, 4) }));
  const tcp = await timed(() => new Promise<{ port: number }>((resolve, reject) => import('node:net').then(({ connect }) => {
    const s = connect({ host, port, timeout: 8000 }); s.once('connect', () => { s.destroy(); resolve({ port }); });
    s.once('timeout', () => { s.destroy(); reject(new Error(`연결 8초 넘음(${host}:${port})`)); }); s.once('error', (e) => { s.destroy(); reject(e); }); }, reject)));
  const get = (path: string) => timed(async () => { const r = await fetchImpl(`${kg2bBase()}${path}`, { headers: { 'User-Agent': 'Mozilla/5.0 (WorkIn sales)' }, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
    const h = await r.text(); return { status: r.status, bytes: h.length, ...(path.includes('bidAll') ? { rows: parseKg2bList(h).rows.length } : {}) }; });
  const main = await get('/'); await new Promise((r) => setTimeout(r, 1200)); const list = await get('/user/bid_list/bidAll');
  // 376차: 서울 중계로 받으면 되는지(서울 밖에서만 — 정기 실행이 실제로 쓰는 길)
  const relay = relayOn() ? await timed(async () => { const r = await krFetch(`${kg2bBase()}/user/bid_list/bidAll`, { headers: { 'User-Agent': 'Mozilla/5.0 (WorkIn sales)' } });
    const h = await r.text(); return { status: r.status, via: r.headers.get('x-kr-relay'), rows: parseKg2bList(h).rows.length }; }) : null;
  return { region: process.env.VERCEL_REGION ?? null, host, port, dns, tcp, main, list, relay, at: new Date().toISOString() };
}
