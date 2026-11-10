// 388차(대표 11/10 "아직도 그 공고가 일정에 맞게 스케줄링되어 있지 않다 · 스케줄에는 공고에서 올라오는 현장설명회와 입찰 마감일자가 표기 ·
// 담당자 체크된 모든 인원에게"): 수집기(06·10·14·18시)를 기다리지 않고, 입찰 업무로 넘긴 열린 공고는 정기 실행(15~30분)마다 원천 상세를 다시 읽어
// 공고 줄의 입찰 마감·현장설명회를 바로잡는다 — 바로 뒤 bidTasksTick 이 업무 마감·회사 캘린더 일정을 옮기고, 새로 알게 된 현장설명회 일정을 만든다.
//   · K-apt 상세 '입찰서제출마감일'·현장설명(필수/임의/없음·일시) / KG2B 상세 '입찰마감일시'·현장설명회실시유무·현설일시(KG2B 값이 먼저 — 280차와 같은 규칙)
//   · 한 공고는 3시간에 한 번(마감 이틀 안이면 1시간에 한 번) · 한 번에 6건 · 25초 안 · 시험 서버(SALES_COLLECTORS_TICK=off)는 건너뜀
// 그리고 일정 참석자 = 업무의 담당자 전원(주 담당 + 함께 담당): 넘긴 뒤 담당자를 더하거나 빼도 입찰 일정 참석자를 맞추고, 새로 들어간 사람에게 알림.
import { db } from '../db';
import { krFetch, needsKr, relayOn } from '../krFetch';
import { notify } from '../notifications';
import { ts } from './collectors/procurement';
import { BID_STATUS } from './work';

const SRC = 'opportunity_work';
const viaKr = (f: typeof fetch): typeof fetch => ((u: any, init?: any) => (needsKr(String(u)) && relayOn() ? krFetch(String(u), init) : f(u, init))) as typeof fetch;
const kstDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const s0 = (v: unknown) => { const t = String(v ?? '').trim(); return t ? t : null; };
type Src = { deadline: string | null; briefingKind: string | null; briefingAt: string | null; from: string[] };

/** 한 공고 번호의 원천 상세에서 입찰 마감·현장설명 — 못 읽으면 오류 */
async function readSource(st: string, ext: string, f: typeof fetch): Promise<{ kg: Src | null; kapt: Src | null; errors: string[] }> {
  const errors: string[] = []; let kg: Src | null = null, kapt: Src | null = null;
  const K = await import('./collectors/kg2b');
  const code = K.kg2bCode(ext);
  if (code) {
    try {
      const res = await f(K.kg2bDetailUrl(code), { headers: { 'User-Agent': 'Mozilla/5.0 (WorkIn sales)' }, signal: AbortSignal.timeout(relayOn() ? 20000 : 8000), redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = K.parseKg2bDetail(await res.text());
      if (!d.noticeNo && !d.close) throw new Error('KG2B 상세 칸을 못 읽음');
      kg = { deadline: d.close, briefingKind: d.briefingKind, briefingAt: d.briefingAt, from: ['KG2B'] };
    } catch (e) { errors.push(`KG2B ${ext}: ${String((e as Error)?.message ?? e).slice(0, 80)}`); }
  }
  if (st === 'kapt_bid') {
    try {
      const { kaptSession } = await import('./files'); const { parseKaptBidDetail } = await import('./collectors/kapt');
      const s = await kaptSession(ext, f, 8000); if (s.status !== 200) throw new Error(`HTTP ${s.status}`);
      const d = parseKaptBidDetail(s.html);
      kapt = { deadline: d.deadline ?? null, briefingKind: d.terms?.briefingKind ?? null, briefingAt: d.terms?.briefingAt ?? null, from: ['K-apt'] };
    } catch (e) { errors.push(`K-apt ${ext}: ${String((e as Error)?.message ?? e).slice(0, 80)}`); }
  }
  return { kg, kapt, errors };
}

/** 공고 줄에 넣을 칸 — 바뀐 칸만. 마감은 KG2B(실제 입찰 사이트) → K-apt 상세 순 · 현장설명은 원천별 칸(kg2b_briefing_* / site_briefing_*) */
export function verifyPatch(row: Record<string, any>, src: { kg: Src | null; kapt: Src | null }) {
  const p: Record<string, unknown> = {};
  const close = ts(src.kg?.deadline) ?? ts(src.kapt?.deadline);
  if (close && ts(row.deadline_at) !== close) { p.deadline_at = close; p.deadline_fixed = { from: row.deadline_at ?? null, at: new Date().toISOString(), by: src.kg?.deadline ? 'KG2B' : 'K-apt' }; }
  if (src.kg?.briefingKind && src.kg.briefingKind !== row.kg2b_briefing_kind) p.kg2b_briefing_kind = src.kg.briefingKind;
  if (src.kg?.briefingAt && ts(src.kg.briefingAt) !== ts(row.kg2b_briefing_at)) p.kg2b_briefing_at = ts(src.kg.briefingAt);
  if (src.kapt?.briefingKind && src.kapt.briefingKind !== row.site_briefing_kind) p.site_briefing_kind = src.kapt.briefingKind;
  if (src.kapt?.briefingAt && ts(src.kapt.briefingAt) !== ts(row.site_briefing_at)) p.site_briefing_at = ts(src.kapt.briefingAt);
  return p;
}

/** 입찰 업무로 넘긴 열린 공고의 원천 일정을 다시 읽어 공고 줄을 바로잡음 */
export async function bidDatesVerifyTick(now = new Date(), fetchImpl: typeof fetch = fetch) {
  if (process.env.SALES_COLLECTORS_TICK === 'off') return { skipped: 'off' as const };
  const sql = db(); const started = Date.now(); const left = () => 25000 - (Date.now() - started);
  const soon = kstDay(new Date(now.getTime() + 2 * 864e5));
  const recs = await sql<{ tenant: string; src_id: string; ref_id: string; data: any; st: string; ext: string; dl: string | null }[]>`
    select w.tenant, w.src_id, w.ref_id, w.data, r.row->>'source_type' as st, r.row->>'source_external_id' as ext, r.row->>'deadline_at' as dl
    from sales_work_records w join sales_src_rows r on r.scope = 'global' and r.tbl = 'procurement_notices' and r.src_id = w.ref_id
    where w.src_tbl = ${SRC} and w.status = ${BID_STATUS} and w.data ? 'bid_task_id'
      and r.row->>'source_type' in ('kapt_bid', 'kg2b_bid') and coalesce(r.row->>'source_external_id', '') <> ''
      and (coalesce(r.row->>'deadline_at', '') = '' or left(r.row->>'deadline_at', 10) >= ${kstDay(new Date(now.getTime() - 864e5))})
    order by coalesce(r.row->>'deadline_at', '9999') asc limit 200`;
  // 마감 이틀 안이면 1시간, 아니면 3시간에 한 번
  const due = recs.filter((r) => { const at = Date.parse(String(r.data?.bid_verified_at ?? '')); const gap = r.dl && r.dl.slice(0, 10) <= soon ? 3600e3 : 3 * 3600e3; return !Number.isFinite(at) || now.getTime() - at >= gap; });
  const byNotice = new Map<string, typeof due>(); for (const r of due) { const k = `${r.st}|${r.ext}`; if (!byNotice.has(k)) byNotice.set(k, []); byNotice.get(k)!.push(r); }
  const out = { checked: 0, fixed: 0, errors: [] as string[] }; const f = viaKr(fetchImpl);
  for (const [k, group] of [...byNotice.entries()].slice(0, 6)) {
    if (left() < 9000) break;
    const [st, ext] = k.split('|');
    const src = await readSource(st, ext, f); out.errors.push(...src.errors);
    if (src.kg || src.kapt) {
      // 같은 번호의 줄(원본 복사·워크인 수집·KG2B 직접)을 모두 같은 값으로
      const rows = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices'
        and row->>'source_type' in ('kapt_bid', 'kg2b_bid') and row->>'source_external_id' = ${ext}`;
      let fixed = false;
      for (const r of rows) {
        const patch = verifyPatch(r.row, src); if (!Object.keys(patch).length) continue;
        await sql`update sales_src_rows set row = row || ${sql.json({ ...patch, dates_verified_at: now.toISOString() } as never)}::jsonb where scope = 'global' and tbl = 'procurement_notices' and src_id = ${r.src_id}`;
        fixed = true;
      }
      if (fixed) out.fixed++;
    }
    out.checked++;
    // 읽기를 시도한 때 — 원천이 막혀도 다음 차례까지 기다림(정기 실행마다 같은 공고만 붙잡지 않게)
    for (const g of group) await sql`update sales_work_records set data = data || ${sql.json({ bid_verified_at: now.toISOString(), ...(src.errors.length ? { bid_verify_error: src.errors.join(' · ').slice(0, 200) } : {}) } as never)}::jsonb
      where tenant = ${g.tenant} and src_tbl = ${SRC} and src_id = ${g.src_id}`;
  }
  if (out.errors.length) await (await import('../log')).logError('tick:bidDatesVerify', new Error(out.errors.slice(0, 5).join(' | '))).catch(() => {});
  return out.checked || out.errors.length ? { ...out, errors: out.errors.length } : { checked: 0 };
}

/** 입찰 일정 참석자 = 업무 담당자 전원(주 담당 + 함께 담당). 예전에 자동으로 넣은 사람 중 담당에서 빠진 사람만 빼고, 사람이 직접 더한 참석자는 그대로 */
export async function bidAttendeeSyncTick() {
  const sql = db();
  const recs = await sql<{ tenant: string; src_id: string; data: any }[]>`select tenant, src_id, data from sales_work_records
    where src_tbl = ${SRC} and status = ${BID_STATUS} and data ? 'bid_task_id' order by updated_at limit 300`;
  let synced = 0, added = 0;
  for (const rec of recs) {
    const d = rec.data ?? {}; const taskId = String(d.bid_task_id ?? ''); if (!/^[0-9a-f-]{36}$/i.test(taskId)) continue;
    const [t] = await sql<{ assignee_id: string | null; title: string; tenant: string }[]>`select t.assignee_id, t.title, u.tenant from tasks t join users u on u.id = t.created_by
      where t.id = ${taskId} and t.deleted_at is null and t.status <> 'done'`;
    if (!t || t.tenant !== rec.tenant) continue;
    const co = (await sql<{ user_id: string }[]>`select a.user_id from task_assignees a join users u on u.id = a.user_id and u.status = 'active' where a.task_id = ${taskId}`).map((x) => x.user_id);
    const now = [...new Set([...(t.assignee_id ? [t.assignee_id] : []), ...co])];
    const before: string[] = Array.isArray(d.assignees) ? d.assignees.filter((x: unknown): x is string => typeof x === 'string') : [];
    const evIds = Object.values(d.bid_events ?? {}).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x));
    const events = evIds.length ? await sql<{ id: string; title: string; start_at: Date; all_day: boolean; description: string | null }[]>`select id, title, start_at, all_day, description from events
      where id = any(${evIds}::uuid[]) and deleted_at is null and end_at >= now() - interval '1 day'` : [];
    let touched = false;
    if (now.length) for (const e of events) {
      const have = (await sql<{ user_id: string }[]>`select user_id from event_attendees where event_id = ${e.id}`).map((x) => x.user_id);
      const gone = before.filter((x) => !now.includes(x) && have.includes(x));
      const add = now.filter((x) => !have.includes(x));
      if (!gone.length && !add.length) continue;
      if (gone.length) await sql`delete from event_attendees where event_id = ${e.id} and user_id = any(${gone}::uuid[])`;
      for (const uid of add) await sql`insert into event_attendees (event_id, user_id) values (${e.id}, ${uid}) on conflict do nothing`;
      const names = (await sql<{ name: string }[]>`select name from users where id = any(${now}::uuid[]) order by array_position(${now}::uuid[], id)`).map((x) => x.name).join('·');
      const desc = String(e.description ?? '').replace(/^입찰 일정 — 담당 [^\n]*/, `입찰 일정 — 담당 ${names}`);
      await sql`update events set description = ${desc}, updated_at = now(), version = version + 1 where id = ${e.id}`;
      const when = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short', ...(e.all_day ? {} : { hour: '2-digit', minute: '2-digit', hour12: false }) }).format(e.start_at);
      if (add.length) await notify(sql, { userIds: add, type: 'event_changed', title: `일정 초대: ${e.title.slice(0, 80)}`, body: `입찰 업무 담당으로 일정에 들어갔습니다 · ${when}`,
        link: `/calendar?event=${e.id}`, entityType: 'event', entityId: e.id, push: true, dedupeKey: `bidev:${e.id}:${add.join(',')}` } as never).catch(() => {});
      added += add.length; touched = true;
    }
    // 새로 만드는 입찰 일정(현장설명회가 뒤에 알려진 경우)도 지금 담당자 전원으로
    if (now.length && (touched || now.length !== before.length || now.some((x) => !before.includes(x)))) {
      await sql`update sales_work_records set data = data || ${sql.json({ assignees: now } as never)}::jsonb where tenant = ${rec.tenant} and src_tbl = ${SRC} and src_id = ${rec.src_id}`;
      synced++;
    }
  }
  return synced || added ? { synced, added } : { synced: 0 };
}

