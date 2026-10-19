import { db } from '../db';
import { assertSpace } from '../spaces';
import { badRequest, notFound } from '../errors';
import { tenantOf, type SessionUser } from '../types';

/**
 * V41 단계 2 영업 공간 화면(V39 B) — 옮긴 영업관리 원본(sales_src_rows)을 읽어 보여 줌. **전환일까지 읽기 전용**:
 * 원본(영업관리)이 아직 운영 중이고 매일 다시 가져오기가 덮어쓰므로, 고치는 것은 영업관리에서(전환 후 워크인 쓰기로 바꿈).
 * 칸 이름은 원본마다 다를 수 있어 후보를 차례로 시도(pick). 상세는 원본 칸 전부를 그대로 보여 줌.
 */
const pick = (o: any, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return null; };
const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const plus = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));

async function rows(scope: string, tbl: string, limit = 5000) {
  return (await db()<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = ${scope} and tbl = ${tbl} and not gone limit ${limit}`).map((r) => ({ ...r.row, __id: r.src_id }));
}
/** 전환 뒤(쓰기 열림): 리드는 정식 표(sales_leads)가 정본 — 원본 행 칸 이름으로 맞춰 돌려줌(화면 코드 그대로) */
/** date 칸: 운영 DB 연결은 date 를 'YYYY-MM-DD' 문자열로, 시험 DB 는 Date 로 줄 수 있음 — 둘 다(핫픽스 10/19: 문자열을 format 해 500) */
const ymdOf = (v: unknown) => (v == null || v === '' ? null : typeof v === 'string' ? v.slice(0, 10) : v instanceof Date && !Number.isNaN(v.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(v) : null);
async function formalLeads(tenant: string, id?: string) {
  const r = await db()<any[]>`select l.*, u.name as owner_name from sales_leads l left join users u on u.id = l.owner_id where l.tenant = ${tenant} ${id ? db()`and l.id = ${id}` : db()``} order by l.updated_at desc limit 5000`;
  return r.map((l) => ({ ...(l.src ?? {}), __id: l.id, __src_id: l.src_id, __owner: l.owner_name ?? '', __owner_id: l.owner_id, name: l.name, sales_status: l.status, priority: l.priority, facility_type: l.facility_type, region: l.region,
    next_contact_date: ymdOf(l.next_contact_date), contact_name: l.contact_name, phone: l.phone, expected_revenue: l.expected_revenue,
    memo: l.memo, updated_at: l.updated_at }));
}
async function userNames(tenant: string) {
  const m = await db()<{ src_user_id: string; name: string | null }[]>`select m.src_user_id, coalesce(u.name, m.name) as name from sales_user_map m left join users u on u.id = m.user_id where m.tenant = ${tenant}`;
  return new Map(m.map((x) => [x.src_user_id, x.name ?? '']));
}

/** 영업관리 11단계(원본 leads.sales_status) · 종결 단계 · 우선순위 한글 */
export const STAGES = ['신규리드', '1차연락완료', '미팅예정', '현장방문완료', '제안서작성중', '제안서발송완료', '견적협의', '계약검토', '계약완료', '보류', '실패'];
const CLOSED = new Set(['계약완료', '보류', '실패']);
const PRIORITY: Record<string, string> = { urgent: '긴급', high: '높음', medium: '보통', low: '낮음' };
/** 지역 칸에 단지명 같은 값(원본 데이터 오류)은 '지역 미정' 묶음으로 — 값은 고치지 않음 */
const regionOf = (v: unknown) => { const r = String(v ?? '').trim(); return !r || r.length > 8 || /\s/.test(r) ? '지역 미정' : r; };
const lead = (r: any, names: Map<string, string>) => ({
  id: r.__id, name: pick(r, 'name', 'company_name', 'facility_name', 'title', 'organization') ?? '(이름 없음)', status: pick(r, 'sales_status', 'status', 'stage'),
  priority: PRIORITY[String(pick(r, 'priority') ?? '').toLowerCase()] ?? pick(r, 'priority'),
  facility: pick(r, 'facility_type', 'type', 'category'), region: pick(r, 'region', 'sido', 'area'), next: day(pick(r, 'next_contact_date', 'next_contact_at', 'next_action_date')),
  owner: r.__owner !== undefined ? r.__owner || null : names.get(String(pick(r, 'owner_id', 'assigned_to', 'sales_owner_id', 'user_id') ?? '')) ?? null, ownerId: r.__owner_id ?? null, memo: r.__id && r.__owner !== undefined ? r.memo ?? null : undefined, revenue: pick(r, 'expected_revenue', 'expected_amount', 'estimated_revenue'),
  updated: day(pick(r, 'updated_at', 'created_at')), phone: pick(r, 'phone', 'contact_phone'), contact: pick(r, 'contact_name', 'manager_name'),
});
/** 영업관리 기준(SALES_SCREEN_INVENTORY 10/19): '오늘 등록'·'새 공고'는 원본 first_seen_at 하나만(KST 날짜). posted_date·created_at 은 쓰지 않음.
 * 옮긴 행은 원본 first_seen_at 을 그대로 가져오므로 옮긴 날로 바뀌지 않는다(값이 없으면 신규 판단에서 빠짐) */
const firstSeen = (r: any) => {
  const v = r?.first_seen_at;
  if (!v) return null;
  const d = new Date(String(v));
  return /T|\s\d{2}:/.test(String(v)) && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d) : String(v).slice(0, 10);
};
const notice = (r: any) => ({ id: r.__id, title: pick(r, 'title', 'notice_title', 'bid_name', 'name') ?? '(제목 없음)', agency: pick(r, 'issuer', 'agency', 'org_name', 'demand_agency', 'organization', 'buyer'),
  region: pick(r, 'region'), posted: firstSeen(r), noticeDate: day(pick(r, 'posted_date', 'posted_at', 'notice_date', 'published_at', 'bid_notice_date')), deadline: pick(r, 'deadline_at', 'close_at', 'deadline', 'bid_close_at', 'closing_date', 'end_date'),
  close: day(pick(r, 'deadline_at', 'close_at', 'deadline', 'bid_close_at', 'closing_date', 'end_date')), source: pick(r, 'source', 'source_code'), url: pick(r, 'source_url', 'url', 'detail_url', 'link'),
  attachments: (() => { const a = pick(r, 'attachment_urls'); return Array.isArray(a) ? a : typeof a === 'string' && a.startsWith('[') ? (() => { try { return JSON.parse(a); } catch { return []; } })() : a ? [a] : []; })(),
  fit: pick(r, 'fit_score'), status: pick(r, 'current_status', 'status'), amount: pick(r, 'amount', 'budget', 'estimated_price'), related: r.related === true || r.related === 'true' });

export async function salesView(u: SessionUser, view: string, q: { q?: string; id?: string; status?: string; tab?: string; day?: string }) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db();
  const [applied] = await sql<{ value: any }[]>`select value from app_settings where key = 'sales_migrate_applied'`;
  const { writesOpen } = await import('./cutover');
  const formal = await writesOpen(t);
  const meta = { readOnly: !formal, syncedAt: applied?.value?.tenant === t ? applied.value.at : null, imported: applied?.value?.tenant === t };
  const leadRows = () => (formal ? formalLeads(t) : rows(t, 'leads'));
  const names = await userNames(t);
  const term = (q.q ?? '').trim().toLowerCase();
  const hit = (o: any) => !term || JSON.stringify(o).toLowerCase().includes(term);

  const bidsOn = await (await import('./options')).salesBidsOn(t); // 입찰·공고 선택 기능
  if (view === 'bids' && !bidsOn) throw notFound('입찰·공고를 쓰지 않는 회사입니다');
  if (view === 'summary') {
    const L = (await leadRows()).map((r) => lead(r, names));
    const W = await rows(t, 'opportunity_work');
    const N = (await rows('global', 'procurement_notices', 20000)).map(notice).filter((n) => n.related);
    const live = L.filter((l) => !CLOSED.has(String(l.status))); // 종결(계약완료·보류·실패) 제외
    const due = live.filter((l) => l.next && l.next >= today() && l.next <= plus(7)).sort((a, b) => String(a.next).localeCompare(String(b.next)));
    const overdue = live.filter((l) => l.next && l.next < today()).sort((a, b) => String(b.next).localeCompare(String(a.next)));
    const cnt = L.reduce((m: Record<string, number>, l) => { const k = String(l.status ?? '미정'); m[k] = (m[k] ?? 0) + 1; return m; }, {});
    const statuses = [...STAGES.filter((k) => cnt[k]), ...Object.keys(cnt).filter((k) => !STAGES.includes(k))].map((k) => [k, cnt[k]]);
    return { ...meta, bidsOn, kpi: { leads: L.length, dueSoon: due.length, overdue: overdue.length, bidsWorking: W.filter((w) => !/완료|미참여|대상아님|done|closed/i.test(String(pick(w, 'status') ?? ''))).length,
      relatedNotices: N.length, newNotices7d: N.filter((n) => n.noticeDate && n.noticeDate >= plus(-7) && n.noticeDate <= today()).length /* 로컬 10/19: 원본 초기 적재(10/13 3,343건) 때문에 first_seen 7일은 부풀려짐 → 공고일 기준 */ }, due: due.slice(0, 10), overdueList: overdue.slice(0, 10), statuses,
      // 대표(10/19): 첫 화면 맨 위 '오늘' — 새 공고·새 영업 DB(신규단지·시설·협력사)·오늘 연락할 리드·오늘 마감 입찰
      today: await (async () => { const td = today();
        const db3 = await Promise.all((['building_sales_pipeline', 'operating_facility_prospects', 'vendor_registrations'] as const).map(async (tb) => (await rows('global', tb, 20000)).filter((r) => firstSeen(r) === td).length));
        return { date: td, newNotices: N.filter((n) => n.posted === td).length, newDb: { buildings: db3[0], facilities: db3[1], vendors: db3[2] }, contact: live.filter((l) => l.next === td).length, closing: N.filter((n) => n.close === td).length }; })() };
  }
  if (view === 'leads') {
    const L = (await leadRows()).map((r) => ({ ...lead(r, names), raw: r })).filter((l) => hit(l.raw) && (!q.status || String(l.status) === q.status) && (q.day !== 'today' || l.next === today()));
    return { ...meta, leads: L.map(({ raw: _, ...l }) => l).sort((a, b) => String(b.updated).localeCompare(String(a.updated))) };
  }
  if (view === 'lead') {
    if (!q.id) throw badRequest('id 가 필요합니다');
    if (formal) {
      if (!/^[0-9a-f-]{36}$/i.test(q.id)) throw notFound();
      const [r] = await formalLeads(t, q.id);
      if (!r) throw notFound();
      const srcId = r.__src_id as string | null;
      const lid = q.id;
      const recs = async (kind: string) => (await sql<any[]>`select id, data, occurred_at from sales_lead_records where tenant = ${t} and lead_id = ${lid} and kind = ${kind} order by occurred_at desc nulls last`).map((x) => ({ ...x.data, __id: x.id }));
      const relSrc = async (tbl: string) => (srcId ? (await rows(t, tbl)).filter((x) => String(pick(x, 'lead_id')) === srcId) : []);
      const log = await sql`select g.from_status, g.to_status, g.reason, g.changed_at, u.name as by from sales_status_log g left join users u on u.id = g.changed_by where g.lead_id = ${lid} order by g.changed_at desc limit 50`;
      const people = await sql`select id, name from users where tenant = ${t} and status = 'active' and not is_demo order by name`;
      const { src: _s, ...raw } = r;
      return { ...meta, lead: lead(r, names), raw: Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('__'))), activities: await recs('sales_activities'), timing: await recs('lead_opportunity_timing'),
        interests: await recs('lead_business_interests'), tasks: await relSrc('tasks'), proposals: await recs('proposals'), contracts: await recs('contracts'), work: await relSrc('opportunity_work'),
        statusLog: log, stages: STAGES, people, canAssign: ['owner', 'admin'].includes(u.role) };
    }
    const [r] = await sql<{ row: any }[]>`select row from sales_src_rows where scope = ${t} and tbl = 'leads' and src_id = ${q.id}`;
    if (!r) throw notFound();
    const rel = async (tbl: string) => (await rows(t, tbl)).filter((x) => String(pick(x, 'lead_id')) === q.id);
    return { ...meta, lead: lead({ ...r.row, __id: q.id }, names), raw: r.row, activities: await rel('sales_activities'), timing: await rel('lead_opportunity_timing'), interests: await rel('lead_business_interests'),
      tasks: await rel('tasks'), proposals: await rel('proposals'), contracts: await rel('contracts'), work: await rel('opportunity_work') };
  }
  if (view === 'pipeline') {
    const L = (await leadRows()).map((r) => lead(r, names));
    const cols = new Map<string, typeof L>();
    for (const l of L) { const k = String(l.status ?? '미정'); cols.set(k, [...(cols.get(k) ?? []), l]); }
    const order = [...STAGES, ...[...cols.keys()].filter((k) => !STAGES.includes(k))];
    return { ...meta, columns: order.map((status) => ({ status, items: cols.get(status) ?? [] })) };
  }
  if (view === 'deals') return { ...meta, proposals: (await rows(t, 'proposals')).filter(hit), contracts: (await rows(t, 'contracts')).filter(hit) };
  if (view === 'bids') {
    const tab = q.tab ?? 'open'; // 기본 = 진행 중(마감 전·공고중/정정), 마감 임박순
    const W = await rows(t, 'opportunity_work');
    const P = new Map((await rows(t, 'procurement_notices__progress', 20000)).map((p) => [String(p.id ?? p.__id), p]));
    const byNotice = new Map(W.map((w) => [String(pick(w, 'notice_id', 'procurement_notice_id') ?? ''), w]));
    let N = (await rows('global', 'procurement_notices', 20000)).filter((r) => r.related === true || r.related === 'true' || byNotice.has(String(r.id ?? r.__id)));
    const items = N.map((r) => { const id = String(r.id ?? r.__id); const w = byNotice.get(id); const p = P.get(id);
      return { ...notice(r), work: w ? pick(w, 'status') : null, classification: p?.classification ?? pick(r, 'classification'), judgment: p?.representative_judgment ?? pick(r, 'representative_judgment') }; })
      .filter((n) => hit(n) && (tab !== 'working' || n.work) && (tab !== 'open' || ((!n.close || n.close >= today()) && (!n.status || /공고중|정정/.test(String(n.status)))))
        && (tab !== 'today' || n.posted === today()) && (tab !== 'closing' || n.close === today()))
      .sort((a, b) => tab === 'open' ? String(a.deadline ?? '9999').localeCompare(String(b.deadline ?? '9999')) : String(b.posted).localeCompare(String(a.posted))).slice(0, 300);
    return { ...meta, tab, total: N.length, items };
  }
  if (view === 'hub') {
    const tab = q.tab ?? 'buildings';
    const dayOk = (r: any) => q.day !== 'today' || firstSeen(r) === today(); // 오늘 새 영업 DB
    if (tab === 'buildings') return { ...meta, tab, items: (await rows('global', 'building_sales_pipeline')).filter((r) => hit(r) && dayOk(r)).map((r) => ({ id: r.__id, name: pick(r, 'name', 'complex_name', 'project_name', 'house_name') ?? '(이름 없음)',
      address: pick(r, 'address', 'location'), households: pick(r, 'households', 'total_households', 'units'), start: day(pick(r, 'sales_start_date', 'start_date', 'notice_date')), status: pick(r, 'status', 'stage'), raw: r })) };
    if (tab === 'facilities') {
      const P = new Map((await rows(t, 'operating_facility_prospects__progress', 20000)).map((p) => [String(p.id ?? p.__id), p]));
      const items = (await rows('global', 'operating_facility_prospects', 20000)).filter((r) => hit(r) && dayOk(r)).map((r) => { const p = P.get(String(r.id ?? r.__id));
        return { id: r.__id, name: pick(r, 'name', 'facility_name', 'complex_name') ?? '(이름 없음)', address: pick(r, 'address', 'road_address'), score: Number(pick(r, 'score', 'priority_score') ?? 0) || null,
          lane: pick(r, 'facility_type', 'lane', 'category', 'kind'), region: pick(r, 'region'), operating: pick(r, 'operating_status'), date: day(pick(r, 'use_approval_date', 'completed_at', 'move_in_date')),
          contact: p?.contact_status ?? null, next: day(p?.next_action_date ?? null), raw: r }; })
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 300);
      return { ...meta, tab, items };
    }
    if (tab === 'vendors') {
      const P = new Map((await rows(t, 'vendor_registrations__progress')).map((p) => [String(p.id ?? p.__id), p]));
      return { ...meta, tab, items: (await rows('global', 'vendor_registrations')).filter((r) => hit(r) && dayOk(r)).map((r) => { const p = P.get(String(r.id ?? r.__id));
        return { id: r.__id, name: pick(r, 'company', 'company_name', 'name') ?? '(이름 없음)', division: pick(r, 'category', 'division', 'kind'), rank: pick(r, 'rank_label', 'rank'), notice: pick(r, 'notice_title', 'title', 'notice'),
          url: pick(r, 'url', 'notice_url'), status: p?.status ?? null, memo: p?.memo ?? null, next: day(p?.next_date ?? null), raw: r }; }) };
    }
    throw notFound();
  }
  if (view === 'regions') {
    const L = (await leadRows()).map((r) => lead(r, names));
    const m = new Map<string, { region: string; total: number; byStatus: Record<string, number> }>();
    for (const l of L) { const k = regionOf(l.region); const e = m.get(k) ?? { region: k, total: 0, byStatus: {} }; e.total++; e.byStatus[String(l.status ?? '미정')] = (e.byStatus[String(l.status ?? '미정')] ?? 0) + 1; m.set(k, e); }
    return { ...meta, regions: [...m.values()].sort((a, b) => (a.region === '지역 미정' ? 1 : b.region === '지역 미정' ? -1 : b.total - a.total)) };
  }
  throw notFound();
}
