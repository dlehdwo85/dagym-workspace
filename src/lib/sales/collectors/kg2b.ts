// 279차 #828(대표 10/31 "입찰 공고문 KG2B에 있고 KAPT에는 공유만 되서 공고문을 못 갖고옴"): K-apt 에 'kg2b_번호'로 올라온 공고는 K-apt 상세에 첨부가 없고
// '해당 공고 가기'가 KG2B 상세(로그인 없이 열림 — 10/31 kg2b_142686 클라우드 확인)로 감 → KG2B 상세에서 현장설명·입찰 개시·개찰·참가 제한 지역·공고문 첨부를 읽어
// 공고 줄에 채움. 공고문이 생기면 참가자격 읽기(eligibilityTick)가 첨부 지문이 바뀐 것을 보고 다시 읽음. 담당자 칸(사람 이름·직함)은 저장하지 않음
import { db } from '../../db';
import type { SessionUser } from '../../types';
import { krFetch, needsKr, relayOn } from '../../krFetch';
import { aptContext, kg2bIssuerKind, matchFit } from './procurement';
import type { Collector, CollectorCtx, CollectorResult } from './types';
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
const kstToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
/** KG2B 상세를 읽을 줄 — 마감 전 관련 K-apt 'kg2b_번호' 공고 중 아직 안 읽었거나(판 2 전) 하루 전에 읽었는데 공고문이 없던 것. 읽기·점검(kg2bWhy)이 같은 조건 */
const dueCond = (sql: ReturnType<typeof db>, today: string) => sql`scope = 'global' and tbl = 'procurement_notices' and not gone
      and row->>'source_type' in ('kapt_bid', 'kg2b_bid') /* 383차: KG2B 직접 수집 줄도 */ and row->>'source_external_id' ~ '^kg2b_[0-9]{3,12}$' and coalesce(row->>'related', 'false') = 'true'
      and (coalesce(row->>'deadline_at', '') >= ${today} or (row->>'source_type' = 'kg2b_bid' and coalesce(row->>'deadline_at', '') = '')) and coalesce(row->>'current_status', '') !~ '취소|낙찰|유찰'
      and (coalesce(row->>'kg2b_read_at', '') = '' or coalesce(row->>'kg2b_v', '') <> '2' or (row->>'kg2b_read_at' < ${new Date(Date.now() - 1 * 864e5).toISOString()} and coalesce(jsonb_array_length(case when jsonb_typeof(row->'attachment_urls') = 'array' then row->'attachment_urls' end), 0) = 0))`;
export async function readKg2bDetails(fetchImpl: typeof fetch, left: () => number, max = 10) {
  const sql = db(); const today = kstToday();
  const rows = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where ${dueCond(sql, today)}
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

/** 377차(로컬 11/06 kg2b_142990 '8건에 안 들어감'): K-apt 수집(06·10·14·18시)은 남은 시간 안에서만 KG2B 상세를 읽어 밀린 공고가 남음 →
 *  정기 실행(15~30분)마다 5건씩 더 읽음(서울 중계, 20초 안). 시험 서버(SALES_COLLECTORS_TICK=off)는 건너뜀 */
export async function kg2bDetailTick() {
  if (process.env.SALES_COLLECTORS_TICK === 'off') return { skipped: 'off' as const };
  const started = Date.now(); const left = () => 20000 - (Date.now() - started);
  const r = await readKg2bDetails(fetch, left, 5);
  return r.read || r.errors.length ? r : { read: 0 };
}

/** 377차(로컬 11/06 kg2b_142686 '취소'·'진행중' 그대로 · kg2b_142990 상세 비어 있음): 한 공고 번호의 줄마다
 *  KG2B 상세를 읽을 차례인지·아닌 까닭·밀린 순서, 같은 번호 줄끼리 상태가 다른 까닭, '못 함' 기록 — 저장 안 함 */
export async function kg2bWhy(no: string) {
  const sql = db(); const today = kstToday(); const ext = no.trim();
  const rows = await sql<{ src_id: string; row: any; gone: boolean; origin: string | null; synced_at: Date }[]>`select src_id, row, gone, origin, synced_at from sales_src_rows
    where scope = 'global' and tbl = 'procurement_notices' and (row->>'source_external_id' = ${ext} or row->>'notice_no' = ${ext} or src_id = ${ext}) order by synced_at desc limit 20`;
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const nFiles = (r: any) => (Array.isArray(r.attachment_urls) ? r.attachment_urls.length : 0);
  const notDue = (x: { row: any; gone: boolean }) => {
    const r = x.row;
    if (x.gone) return '숨긴 줄(합쳐짐·사라짐) — 같은 번호의 보이는 줄을 읽음';
    if (r.source_type !== 'kapt_bid') return `원천이 K-apt 입찰공고가 아님(${r.source_type ?? '빈 값'})`;
    if (!/^kg2b_[0-9]{3,12}$/.test(String(r.source_external_id ?? ''))) return `공고 번호가 kg2b_숫자 꼴이 아님(${r.source_external_id ?? '빈 값'})`;
    if (String(r.related) !== 'true') return '관련 공고가 아님 — KG2B 상세는 관련 공고만 읽음(못 함 기록도 읽으려다 실패한 것만)';
    if (!r.deadline_at) return '마감일 칸이 비어 있음';
    if (String(r.deadline_at) < today) return `마감이 지남(${r.deadline_at})`;
    if (/취소|낙찰|유찰/.test(String(r.current_status ?? ''))) return `상태가 '${r.current_status}'`;
    if (r.kg2b_read_at && String(r.kg2b_v ?? '') === '2' && !(String(r.kg2b_read_at) < dayAgo && nFiles(r) === 0))
      return nFiles(r) ? `이미 읽음(${r.kg2b_read_at})` : `${r.kg2b_read_at} 에 읽었는데 공고문 없음 — 하루 뒤 다시`;
    return null;
  };
  const queue = await sql<{ ext: string }[]>`select row->>'source_external_id' as ext from sales_src_rows where ${dueCond(sql, today)} group by 1 order by min(row->>'deadline_at') asc`;
  const at = queue.findIndex((q) => q.ext === ext);
  const [skip] = await sql<any[]>`select reason, message, first_at, last_at, skips, done_at from ai_skips where tenant = 'global' and stage = 'kg2b_detail' and item_key = ${ext}`.catch(() => []);
  const items = rows.map((x) => { const r = x.row; return { id: x.src_id, origin: x.origin === 'workin' ? '워크인 수집' : '원본 영업관리 복사', gone: x.gone, mergedInto: r.merged_into ?? null,
    sourceType: r.source_type ?? null, sourceNo: r.source_external_id ?? null, noticeNo: r.notice_no ?? null, status: r.current_status ?? null, noticeState: r.notice_state ?? null, noticeKind: r.notice_kind ?? null,
    winner: r.winner_name ?? null, related: String(r.related) === 'true', deadlineAt: r.deadline_at ?? null, postedDate: r.posted_date ?? null,
    kg2bReadAt: r.kg2b_read_at ?? null, kg2bV: r.kg2b_v ?? null, files: nFiles(r), briefing: r.kg2b_briefing_kind ?? r.site_briefing_kind ?? null,
    kaptCancelAt: r.kapt_cancel_at ?? null, cancelDate: r.cancel_date ?? null, cancelSyncedAt: r.cancel_synced_at ?? null, cancelSyncedFrom: r.cancel_synced_from ?? null, syncedAt: x.synced_at,
    kg2bDetail: notDue(x) ?? `읽을 차례 — 밀린 ${queue.length}건 중 ${at + 1}번째(정기 실행 5건·K-apt 수집 10건씩)` }; });
  // 같은 번호 줄끼리 취소/진행이 다르면 — 취소 맞춤(mergeNoticeDuplicates)이 왜 안 옮겼는지
  const canceled = items.filter((i) => /취소/.test(String(i.status ?? '')));
  const cancel = !canceled.length || canceled.length === items.length ? null : items.filter((i) => !/취소/.test(String(i.status ?? ''))).map((i) => ({ id: i.id,
    why: /낙찰/.test(String(i.status ?? '')) || i.winner ? '낙찰·낙찰자가 있는 줄은 옮기지 않음'
      : !canceled.some((c) => c.sourceType === i.sourceType && c.sourceNo === i.sourceNo) ? `원천 종류·번호가 취소 줄과 다름(${i.sourceType}·${i.sourceNo} ↔ ${canceled.map((c) => `${c.sourceType}·${c.sourceNo}`).join(', ')})`
      : '다음 공고 수집(K-apt·나라장터) 뒤 맞춤 — 그 뒤에도 다르면 알려 주세요' }));
  return { no: ext, today, items, queue: { total: queue.length, position: at >= 0 ? at + 1 : null }, cancel,
    skip: skip ? { reason: skip.reason, message: skip.message, firstAt: skip.first_at, lastAt: skip.last_at, times: skip.skips, refilledAt: skip.done_at } : null };
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
  briefingAt: string | null; openingAt: string | null; posted: string | null; kinds: string[];
  /** 383차: 입찰 마감(한국 시각) — 목록 줄의 남은 시간 타이머 timerDownN("초") + 받은 때(분 단위로 맞춤, 11/07 kg2b 143124 상세 '입찰마감일시 2026-11-17 17:00'과 같음) */
  close: string | null };
const kstMin = (ms: number) => { const d = new Date(Math.round(ms / 60000) * 60000 + 9 * 3600e3); return `${d.toISOString().slice(0, 16)}:00+09:00`; };
const yy = (v: string | undefined) => { const m = /^(\d{2})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(v ?? '').trim()); return m ? `20${m[1]}-${m[2]}-${m[3]}T${(m[4] ?? '00').padStart(2, '0')}:${m[5] ?? '00'}:00+09:00` : null; };
/** KG2B 입찰 목록 한 장 — 줄: 번호 · 공고 종류 그림(전자·현설·재입찰…)+공고번호 · 공고명(goAction('view','코드'))+발주처 · 업종+지역 · 현설일+개찰일 */
export function parseKg2bList(html: string, at = Date.now()): { rows: Kg2bListRow[]; total: number | null; enc: string | null } {
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
    const left = Number(/timerDown\d*\(\s*["'](-?\d{1,9})["']/.exec(tr)?.[1] ?? NaN);
    rows.push({ code, noticeNo, title: text(a), issuer: text(p) || null, industry: text(ind.replace(/<h4[\s\S]*?<\/h4>/i, '')) || null, region: h4 ? text(h4) || null : null,
      briefingAt: yy(text(dates.replace(/<h5[\s\S]*?<\/h5>/i, ''))), openingAt: h5 ? yy(text(h5)) : null, posted: d ? `${d[1]}-${d[2]}-${d[3]}` : null,
      kinds: [...tr.matchAll(/<img[^>]*alt="([^"]+)"/gi)].map((m) => m[1]).slice(0, 4), close: Number.isFinite(left) && left > 0 ? kstMin(at + left * 1000) : null });
  }
  const total = /공고수\s*:\s*([\d,]+)\s*건/.exec(text(html))?.[1]; const f = html.indexOf('name="theForm"');
  const enc = f >= 0 ? /name="__encrypted"\s+value="([^"]+)"/.exec(html.slice(f))?.[1] ?? null : null;
  return { rows, total: total ? Number(total.replace(/,/g, '')) : null, enc };
}
/** 발주처 이름으로 건물 종류 짐작 — 383차: 판정 맥락(aptContext)도 써서 procurement 로 옮김 */
export { kg2bIssuerKind };
/** 383차: KG2B 진행 공고 목록 여러 장(한 장 10줄) — 첫 장 GET, 다음 장은 같은 화면 theForm(__encrypted) POST · 1.2초 간격 · 서울 중계. 미리 보기와 정기 수집이 같이 씀 */
export async function readKg2bList(fetchImpl0: typeof fetch, opts: { pages: number; days: number; budgetMs: number }) {
  const fetchImpl = viaKr(fetchImpl0);
  const { pages, days } = opts;
  const since = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() - days * 864e5));
  const url = `${kg2bBase()}/user/bid_list/bidAll`; const UA = 'Mozilla/5.0 (WorkIn sales)'; const t0 = Date.now();
  let cookie = ''; const keep = (r: Response) => { const sc = (r.headers as any).getSetCookie?.() as string[] | undefined; const c = (sc ?? []).map((x) => x.split(';')[0]).filter(Boolean); if (c.length) cookie = c.join('; '); };
  const all: Kg2bListRow[] = []; const seen = new Set<string>(); let total: number | null = null, enc: string | null = null, read = 0, stop = '', retried = false; const errors: string[] = [];
  for (let page = 1; page <= pages; page++) {
    if (page > 1) { if (!enc) { stop = '다음 장 열쇠(__encrypted) 없음'; break; } if (Date.now() - t0 > opts.budgetMs) { stop = `${Math.round(opts.budgetMs / 1000)}초 넘음`; break; } await new Promise((r) => setTimeout(r, 1200)); }
    try {
      const at = Date.now();
      const res = page === 1 ? await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000), redirect: 'follow' })
        : await fetchImpl(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: url, ...(cookie ? { Cookie: cookie } : {}) },
          body: new URLSearchParams({ method: 'bidAlllist', currentPage: String(page), tabkind: '', __encrypted: enc! }).toString(), signal: AbortSignal.timeout(12_000), redirect: 'follow' });
      keep(res); read++;
      if (!res.ok) { errors.push(`${page}장 HTTP ${res.status}`); break; }
      const p = parseKg2bList(await res.text(), at); total = total ?? p.total; enc = p.enc ?? enc;
      const fresh = p.rows.filter((r) => !seen.has(r.code)); fresh.forEach((r) => seen.add(r.code)); all.push(...fresh);
      if (!fresh.length) { stop = `${page}장에 새 줄 없음`; break; }
      if (fresh.every((r) => r.posted && r.posted < since)) { stop = `${page}장이 모두 ${days}일 전`; break; }
    } catch (e) {
      // 374차(로컬 11/06 02:40 운영 'fetch failed' 10.5초): 원인(코드·시스템 호출·주소)을 그대로 남기고 첫 장은 2초 뒤 한 번 더
      if (page === 1 && !retried) { retried = true; errors.push(`1장 ${fetchErr(e)} — 2초 뒤 다시`); await new Promise((r) => setTimeout(r, 2000)); page = 0; continue; }
      errors.push(`${page}장 ${fetchErr(e)}`); break;
    }
  }
  return { url, since, rows: all.filter((r) => !r.posted || r.posted >= since), total, read, stop: stop || (read >= pages ? `${pages}장까지(최대)` : ''), errors, ms: Date.now() - t0 };
}
/** 이미 있는 'kg2b_번호' 공고(어느 원천이든 — K-apt 가 공유한 줄 포함) → 원천 종류 */
async function knownKg2b(codes: string[]) {
  if (!codes.length) return new Map<string, string>();
  const rows = await db()<{ ext: string; st: string }[]>`select distinct on (row->>'source_external_id') row->>'source_external_id' as ext, row->>'source_type' as st from sales_src_rows
    where scope = 'global' and tbl = 'procurement_notices' and row->>'source_external_id' = any(${codes.map((c) => `kg2b_${c}`)})
    order by row->>'source_external_id', (row->>'source_type' = 'kapt_bid') desc`;
  return new Map(rows.map((r) => [r.ext, r.st]));
}
export async function previewKg2bList(opts: { pages?: number; days?: number } = {}, fetchImpl0: typeof fetch = fetch) {
  const pages = Math.min(Math.max(1, Math.floor(opts.pages ?? 8)), 20), days = Math.min(Math.max(1, Math.floor(opts.days ?? 14)), 30);
  const L = await readKg2bList(fetchImpl0, { pages, days, budgetMs: 40_000 });
  const inRange = L.rows; const known = await knownKg2b(inRange.map((r) => r.code));
  const have = new Set([...known.entries()].filter(([, st]) => st !== 'kg2b_bid').map(([k]) => k)); // 383차: 직접 수집(kg2b_bid)한 줄은 'K-apt 에 없던 몫'으로 셈
  const scored = inRange.map((r) => { const f = matchFit(r.title, null, null, aptContext({ source_type: 'kg2b_bid', issuer: r.issuer, title: r.title })); return { ...r, already: have.has(`kg2b_${r.code}`), saved: known.get(`kg2b_${r.code}`) === 'kg2b_bid', fit: f.fit, kind: kg2bIssuerKind(r.issuer, r.title) }; });
  const byKind: Record<string, { n: number; notInDb: number; related: number; relatedNew: number }> = {};
  const byDay: Record<string, number> = {};
  for (const r of scored) { const k = (byKind[r.kind] ??= { n: 0, notInDb: 0, related: 0, relatedNew: 0 }); k.n++; if (!r.already) k.notInDb++; if (r.fit) { k.related++; if (!r.already) k.relatedNew++; } if (r.posted) byDay[r.posted] = (byDay[r.posted] ?? 0) + 1; }
  const pick = (r: (typeof scored)[number]) => ({ code: r.code, noticeNo: r.noticeNo, title: r.title, issuer: r.issuer, industry: r.industry, region: r.region, posted: r.posted, openingAt: r.openingAt, close: r.close, kind: r.kind, fit: r.fit, already: r.already, saved: r.saved });
  const notIn = scored.filter((r) => !r.already);
  return { source: L.url, region: process.env.VERCEL_REGION ?? null, days, since: L.since, pagesRead: L.read, total: L.total, rows: scored.length, stop: L.stop, errors: L.errors, ms: L.ms,
    already: scored.length - notIn.length, notInDb: notIn.length, related: scored.filter((r) => r.fit).length, relatedNew: notIn.filter((r) => r.fit).length, byKind, byDay,
    examples: [...notIn.filter((r) => r.fit), ...notIn.filter((r) => !r.fit && r.kind !== '공동주택(추정)'), ...notIn.filter((r) => !r.fit && r.kind === '공동주택(추정)')].slice(0, 15).map(pick),
    alreadyExamples: scored.filter((r) => r.already).slice(0, 3).map(pick), saved: scored.filter((r) => r.saved).length };
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

// 383차 #1009·#1007(대표 11/07 "KG2B 수집 켜고 고객사도 확인할 수 있게" — KG2B 화면 아래 '허락 없이 링크·상업적 용도 불가' 문구를 알린 뒤 대표 결정 '켬·고객사 공개'):
// 373차 미리 보기를 정기 수집으로. KG2B 진행 공고 목록(로그인 없이 열림)을 서울 중계로 하루 4번(06·10·14·18시) 받아 K-apt 에 없는 공고만 'kg2b_bid' 로 적재
// (K-apt 가 'kg2b_번호'로 공유한 공고는 K-apt 줄이 맡음 — 나중에 K-apt 가 같은 번호를 올리면 그 줄을 K-apt 줄로 이어 씀, store.prevNotices).
// 관련 공고는 상세(입찰 마감·현장설명·개찰·공고서 첨부)를 읽어 공고서는 [첨부 받기]·업무 넘길 때 자동 첨부로 이어짐(#1018). 요청 간격 1.2초, 담당자 이름·전화는 저장 안 함
const kgHourNow = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
const KG_STATE = /취소|정정|재공고|재입찰|긴급/;
/** 목록 한 줄 → 공고 줄(상세를 읽으면 kg2bPatch 가 마감·첨부 등을 채움) */
export function kg2bListPayload(r: Kg2bListRow): Record<string, unknown> {
  const state = r.kinds.filter((k) => KG_STATE.test(k)).join(' ') || null;
  return { source_type: 'kg2b_bid', source_external_id: `kg2b_${r.code}`, source_url: kg2bDetailUrl(r.code), title: r.title, issuer: r.issuer, facility_name: r.issuer,
    posted_date: r.posted, deadline_at: r.close, opening_at: r.openingAt, site_briefing_at: r.briefingAt,
    // 업종('위탁(식당/어린이집/자판기/검침)등' 같은 넓은 묶음 이름)은 판정 분류로 쓰지 않음 — 예시 낱말(자판기·식당)이 제외 주제에 걸려 위탁운영 공고가 빠짐(383차 시험)
    region_restriction: r.region, industry_code: r.industry, bid_system: 'KG2B전자입찰', notice_no: r.noticeNo, notice_state: state };
}
export const kg2bBidNotices: Collector = {
  slug: 'kg2b_bid_notices', label: 'KG2B 입찰공고(직접)', hourKst: 6, againKst: [10, 14, 18],
  source: 'kg2b.com/user/bid_list/bidAll — 로그인 없이 열리는 진행 공고 목록(서울 중계, 1.2초 간격, 키 불필요). K-apt 에 없는 공고(집합건물·상가·산업단지 관리단 등)만 새로 받고 관련 공고는 상세·공고서까지 — 06시 8장·그 밖 5장(최근 3일)',
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const started = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - started); const errors: string[] = [];
    const full = ctx.params?.full === true || kgHourNow() < 10;
    const L = await readKg2bList(ctx.fetchImpl, { pages: full ? 8 : 5, days: Number(ctx.params?.days) > 0 ? Math.min(14, Number(ctx.params?.days)) : 3, budgetMs: Math.max(4000, Math.min(left() - 22_000, 30_000)) });
    errors.push(...L.errors);
    if (!L.rows.length) return { inserted: 0, updated: 0, unchanged: 0, errors: L.errors.length ? 1 : 0, errorLog: errors.join('\n') || undefined, providerMode: 'web_scrape', retry: L.errors.length > 0,
      summary: `KG2B 목록 ${L.read}장 · ${L.errors.length ? '불러오기 실패' : '최근 공고 0건'}${L.stop ? ` · ${L.stop}` : ''}`,
      sources: { kg2b: { label: 'KG2B 입찰 목록', ok: !L.errors.length, calls: L.read, received: 0, kept: 0, ...(L.errors.length ? { error: L.errors[0] } : {}) } } };
    const known = await knownKg2b(L.rows.map((r) => r.code));
    const kapt = L.rows.filter((r) => known.get(`kg2b_${r.code}`) === 'kapt_bid'); // K-apt 가 공유한 공고 — K-apt 줄이 맡음
    const mine = L.rows.filter((r) => known.get(`kg2b_${r.code}`) !== 'kapt_bid');
    const fresh = mine.filter((r) => !known.has(`kg2b_${r.code}`));
    const fitOf = (r: Kg2bListRow) => matchFit(r.title, null, null, aptContext({ source_type: 'kg2b_bid', issuer: r.issuer, title: r.title }));
    const rel = fresh.filter((r) => fitOf(r).fit);
    const { upsertNotices } = await import('./store');
    const w = await upsertNotices([...mine.filter((r) => fitOf(r).fit), ...mine.filter((r) => !fitOf(r).fit)].map(kg2bListPayload));
    if (w.errorLog) errors.push(w.errorLog);
    // 관련 공고 상세(마감·현설·개찰·공고서) — 새 줄 + 예전에 못 읽은 줄(K-apt 공유 공고와 같은 대기열, 마감 가까운 순)
    const kg = left() > 12_000 ? await readKg2bDetails(ctx.fetchImpl, left, 12).catch((e) => { errors.push(`KG2B 상세: ${fetchErr(e)}`); return null; }) : null;
    if (kg?.errors.length) errors.push(...kg.errors);
    const byKind: Record<string, number> = {}; for (const r of fresh) { const k = kg2bIssuerKind(r.issuer, r.title); byKind[k] = (byKind[k] ?? 0) + 1; }
    const kinds = Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join('·');
    return { inserted: w.inserted, updated: w.updated, unchanged: w.unchanged, errors: w.errors + w.invalid + (L.errors.length ? 1 : 0), errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'web_scrape',
      summary: `KG2B 목록 ${L.read}장 ${L.rows.length}건(최근 공고${L.stop ? ` · ${L.stop}` : ''}) · K-apt 에 이미 있음 ${kapt.length} · K-apt 에 없는 공고 ${mine.length}건(새로 ${fresh.length}${kinds ? `: ${kinds}` : ''} · 관련 ${rel.length})`
        + (kg?.read ? ` · KG2B 상세 ${kg.read}건(공고서 ${kg.files}${kg.attached ? `, 넘긴 업무 ${kg.attached}건에 붙임` : ''})` : '') + ` · 적재 신규 ${w.inserted} · 갱신 ${w.updated} · 변화없음 ${w.unchanged}`,
      sources: { kg2b: { label: 'KG2B 입찰 목록', ok: !L.errors.length, calls: L.read, received: L.rows.length, kept: mine.length, ...(L.total != null ? { total: L.total } : {}), ...(L.errors.length ? { error: L.errors[0] } : {}) } } };
  },
};
