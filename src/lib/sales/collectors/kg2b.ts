// 279차 #828(대표 10/31 "입찰 공고문 KG2B에 있고 KAPT에는 공유만 되서 공고문을 못 갖고옴"): K-apt 에 'kg2b_번호'로 올라온 공고는 K-apt 상세에 첨부가 없고
// '해당 공고 가기'가 KG2B 상세(로그인 없이 열림 — 10/31 kg2b_142686 클라우드 확인)로 감 → KG2B 상세에서 현장설명·입찰 개시·개찰·참가 제한 지역·공고문 첨부를 읽어
// 공고 줄에 채움. 공고문이 생기면 참가자격 읽기(eligibilityTick)가 첨부 지문이 바뀐 것을 보고 다시 읽음. 담당자 칸(사람 이름·직함)은 저장하지 않음
import { db } from '../../db';
import type { SessionUser } from '../../types';

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
 * 마감 전 관련 K-apt 공고 중 kg2b_ 번호이고 KG2B 상세를 아직 안 읽은 것(또는 3일 전에 읽었는데 공고문이 없던 것)을 한 번에 max 건 — 같은 번호 줄(원본 복사·워크인 수집)을 함께 고침.
 * 저장은 칸 합치기만(updated_at 그대로 — 당일 메일 '변경'에 다시 안 오름)
 */
export async function readKg2bDetails(fetchImpl: typeof fetch, left: () => number, max = 10) {
  const sql = db(); const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const rows = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone
      and row->>'source_type' = 'kapt_bid' and row->>'source_external_id' ~ '^kg2b_[0-9]{3,12}$' and coalesce(row->>'related', 'false') = 'true'
      and coalesce(row->>'deadline_at', '') >= ${today} and coalesce(row->>'current_status', '') !~ '취소|낙찰|유찰'
      and (coalesce(row->>'kg2b_read_at', '') = '' or coalesce(row->>'kg2b_v', '') <> '2' or (row->>'kg2b_read_at' < ${new Date(Date.now() - 3 * 864e5).toISOString()} and coalesce(jsonb_array_length(case when jsonb_typeof(row->'attachment_urls') = 'array' then row->'attachment_urls' end), 0) = 0))
    order by row->>'deadline_at' asc limit ${max * 3}`;
  const by = new Map<string, { src_id: string; row: any }[]>();
  for (const r of rows) { const k = String(r.row.source_external_id); if (!by.has(k)) by.set(k, []); by.get(k)!.push(r); }
  const out = { read: 0, files: 0, attached: 0, errors: [] as string[] };
  for (const [ext, group] of [...by.entries()].slice(0, max)) {
    if (left() < 8000) break;
    const code = kg2bCode(ext)!;
    try {
      const res = await fetchImpl(kg2bDetailUrl(code), { headers: { 'User-Agent': 'Mozilla/5.0 (WorkIn sales)' }, signal: AbortSignal.timeout(8000), redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = parseKg2bDetail(await res.text());
      if (!d.noticeNo && !d.files.length && !d.close) throw new Error('KG2B 상세 칸을 못 읽음(화면이 바뀜?)');
      for (const g of group) {
        const { patch, added } = kg2bPatch(g.row, d);
        await sql`update sales_src_rows set row = row || ${sql.json(patch as never)}::jsonb, synced_at = now() where scope = 'global' and tbl = 'procurement_notices' and src_id = ${g.src_id}`;
        out.files += added;
      }
      out.read++;
      if (d.files.length && left() > 15000) out.attached += await attachToOpenTasks(group.map((g) => g.src_id)).catch(() => 0);
    } catch (e) { if (out.errors.length < 5) out.errors.push(`KG2B 상세 ${ext}: ${e instanceof Error ? e.message : String(e)}`); }
  }
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
