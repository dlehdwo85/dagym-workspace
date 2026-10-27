// 186차(로컬 10/26 19:20 B1): 신규 공동주택 단지 — K-apt 단지 목록(data.go.kr 15057332, AptListService4) 매일 차이 + 기본정보(15058453, AptBasisInfoServiceV5) 사용승인일.
// · 전국 단지 목록(약 2만 곳)을 실행마다 시간 안에서 몇 쪽씩(1,000곳/쪽) 이어 읽는다 — 읽은 쪽 위치는 sales_src_rows(kapt_complex_scan).
// · 처음 한 바퀴는 '기준 목록'(그때 이미 있던 단지는 새 단지로 세지 않음). 그 뒤 목록에 처음 보이는 단지 = K-apt 에 새로 등록된 단지.
// · 새 단지는 기본정보로 사용승인일·세대수·관리방식·관리사무소 전화를, 상세정보로 부대·복리시설을 확인 → 사용승인 18개월 안(또는 1년 안 예정)이면
//   '준공·입주 시설'(operating_facility_prospects)에 한 줄 — 단지 코드로 묶어 K-apt 사업자선정 파생 줄과 같은 단지면 한 줄.
// · 부동산원 CSV(reb_recent_complexes, 연 1회)는 그대로. 기준 목록에 이미 있던 최근 준공 단지는 부동산원 파일·청약홈 입주 시기 목록이 맡는다.
// · 212차 #612 ①(대표 결정 10/25 '매주 진행'): 빈 칸 다시 확인 — K-apt 단지 코드가 있는 준공·입주 시설 줄에 관리사무소 전화·부대시설·세대수가
//   비었으면 단지마다 주 1회 기본·상세정보를 다시 읽어 빈 칸만 채운다(있는 값은 안 바꿈). 다시 읽은 때는 sales_src_rows(kapt_recheck).
import { db } from '../../db';
import { callDataGo, type DataGoStats } from './g2b';
import { kaptKey, portalErr } from './kapt';
import { RECENT_COMPLETION_DAYS } from './prospects';
import { addDaysYmd, regionFromAddress, todayKst, toYmd } from './files';
import { setSourceAsOf, upsertProspects } from './store';
import type { Collector, CollectorCtx, CollectorResult, SourceStat } from './types';

export const KAPT_LIST_SERVICE = '15057332';
export const KAPT_BASIS_SERVICE = '15058453';
const T = () => process.env.SALES_COLLECT_TEST_BASE?.replace(/\/$/, '');
const LIST_API = () => (T() ? `${T()}/aptlist` : process.env.KAPT_LIST_API_BASE?.trim() || 'https://apis.data.go.kr/1613000/AptListService4');
const BASIS_API = () => (T() ? `${T()}/aptbasis` : process.env.KAPT_BASIS_API_BASE?.trim() || 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV5');
const CODES = 'kapt_complex_codes', SCAN = 'kapt_complex_scan', RECHECK = 'kapt_recheck';
const PER_PAGE = 1000, UPCOMING_DAYS = 365, CHECKS_PER_RUN = 40, MAX_TRIES = 3, RECHECKS_PER_RUN = 20;
const str = (v: unknown) => { if (v == null) return null; const s = String(v).trim(); return s ? s : null; };
const int = (v: unknown) => { const t = String(v ?? '').replace(/,/g, '').trim(); if (!/^\d+(\.\d+)?$/.test(t)) return null; return Math.round(Number(t)); };
type ScanState = { page: number; per: number; total: number; scans: number; baseline_done: boolean; last_full_scan_day: string | null };

/** 기본정보(+상세정보의 부대·복리시설) → '준공·입주 시설' 한 줄. 사용승인일이 창(18개월 전 ~ 1년 뒤) 밖이거나 없으면 null */
export function newComplexPayload(code: string, b: Record<string, unknown>, d: Record<string, unknown> | null, today: string, observedAt: string): Record<string, unknown> | null {
  const usedate = toYmd(str(b.kaptUsedate) ?? undefined);
  if (!usedate || usedate < addDaysYmd(today, -RECENT_COMPLETION_DAYS) || usedate > addDaysYmd(today, UPCOMING_DAYS)) return null;
  const name = str(b.kaptName); if (!name) return null;
  const addr = str(b.kaptAddr), road = str(b.doroJuso), kind = str(b.codeAptNm), mgr = str(b.codeMgrNm), builder = str(b.kaptBcompany);
  const households = int(b.kaptdaCnt), dongs = int(b.kaptDongCnt);
  return {
    // K-apt 운영 시설 줄(operating_from_kapt)도 늘 '아파트' — 종류가 다르면 같은 단지가 두 줄이 되므로 맞추고, 주상복합 등 종류는 규모 메모에 남김
    facility_type: '아파트', name,
    region: regionFromAddress(addr ?? road ?? undefined), address: addr && road ? `${addr} (${road})` : addr ?? road,
    operating_status: usedate > today ? '입주예정' : '입주중', completion_date: usedate, household_count: households,
    scale_note: [kind, households != null ? `${households.toLocaleString('ko-KR')}세대` : null, dongs != null ? `${dongs}개 동` : null, mgr ? `관리 ${mgr}` : null, builder ? `시공 ${builder}` : null].filter(Boolean).join(' · ') || null,
    office_phone: str(b.kaptTel), amenities: d ? str(d.welfareFacility) : null,
    source_slug: 'kapt_new_complexes', source_name: '국토교통부 공동주택 단지 목록·기본정보(K-apt)', source_url: `https://www.data.go.kr/data/${KAPT_BASIS_SERVICE}/openapi.do`,
    source_external_id: code, facility_code: code, source_observed_at: observedAt,
  };
}

export const kaptNewComplexes: Collector = {
  slug: 'kapt_new_complexes', label: '신규 공동주택 단지(K-apt 단지 목록)', hourKst: 9, againKst: [11, 13, 15],
  source: `apis.data.go.kr/1613000 AptListService4 전체 단지 목록(${KAPT_LIST_SERVICE}) 매일 차이 + AptBasisInfoServiceV5 기본·상세정보(${KAPT_BASIS_SERVICE}) — 처음 한 바퀴는 기준 목록, 그 뒤 새로 등록된 단지 중 사용승인 18개월 안(1년 안 예정 포함)`,
  needs: ['KAPT_SERVICE_KEY(없으면 DATA_GO_KR_SERVICE_KEY)'], // 다른 K-apt 수집기와 같은 키 안내(키는 같고 서비스마다 활용신청)
  keyReady: async () => !!(await kaptKey()),
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const key = await kaptKey();
    if (!key) return { inserted: 0, updated: 0, unchanged: 0, errors: 0, providerMode: 'api', summary: `신규 공동주택 단지 · 키 없음(KAPT_SERVICE_KEY·DATA_GO_KR_SERVICE_KEY) — 공공데이터포털 ${KAPT_LIST_SERVICE}·${KAPT_BASIS_SERVICE} 활용신청 후 [지금 수집]` };
    const sql = db(); const t0 = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - t0);
    const today = todayKst(), at = new Date(ctx.now()).toISOString();
    const mask = (s: string) => s.split(key).join('***').split(encodeURIComponent(key)).join('***');
    const list: SourceStat = { label: `단지 목록(${KAPT_LIST_SERVICE})`, ok: true, calls: 0, received: 0, kept: 0 };
    const basis: SourceStat = { label: `기본정보(${KAPT_BASIS_SERVICE})`, ok: true, calls: 0, received: 0, kept: 0 };
    const errs: string[] = [];
    // 1) 단지 목록 이어 읽기 — 오늘 한 바퀴를 이미 다 읽었으면 목록은 내일
    const [s0] = await sql<{ row: any }[]>`select row from sales_src_rows where scope = 'global' and tbl = ${SCAN} and src_id = 'state'`;
    const st: ScanState = { page: 1, per: PER_PAGE, total: 0, scans: 0, baseline_done: false, last_full_scan_day: null, ...(s0?.row ?? {}) };
    const save = () => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', ${SCAN}, 'state', ${sql.json(st as never)}, 'workin')
      on conflict (scope, tbl, src_id) do update set row = excluded.row, synced_at = now()`;
    const scanToday = !(st.last_full_scan_day === today && st.page === 1);
    let pages = 0, fresh = 0, baselineJustDone = false;
    while (scanToday && left() > 20000) {
      const u = new URL(`${LIST_API()}/getTotalAptList4`);
      u.searchParams.set('serviceKey', key); u.searchParams.set('pageNo', String(st.page)); u.searchParams.set('numOfRows', String(PER_PAGE));
      const stats: DataGoStats = { calls: 0, codes: {}, total: 0, raw: 0 };
      let items: any[];
      try { list.calls++; items = await callDataGo(u, ctx.fetchImpl, key, Math.min(20000, left() - 15000), stats); }
      catch (e) { list.ok = false; list.error = portalErr(mask(e instanceof Error ? e.message : String(e)), KAPT_LIST_SERVICE); list.sent = stats.sent; list.head = stats.head; errs.push(`단지 목록 ${st.page}쪽: ${list.error}`); break; }
      pages++; list.received += items.length;
      if (stats.total) st.total = stats.total;
      if (st.page === 1 && items.length && items.length < PER_PAGE && st.total > items.length) st.per = items.length; // 원천이 한 쪽 줄 수를 줄여 주면 그 수로 쪽을 센다
      const seen = new Set<string>();
      const vals = items.flatMap((it) => { const code = str(it?.kaptCode); if (!code || seen.has(code)) return []; seen.add(code);
        return [{ scope: 'global', tbl: CODES, src_id: code, origin: 'workin',
          row: sql.json({ code, name: str(it.kaptName), bjd: str(it.bjdCode), sido: str(it.as1), sigungu: str(it.as2), dong: str(it.as3), first_seen_at: at, ...(st.baseline_done ? { fresh: true } : { baseline: true }) } as never) }]; });
      if (vals.length) {
        const ins = await sql<{ src_id: string }[]>`insert into sales_src_rows ${sql(vals as never)} on conflict (scope, tbl, src_id) do nothing returning src_id`;
        list.kept += ins.length; if (st.baseline_done) fresh += ins.length;
      }
      const done = !items.length || (st.total ? st.page * st.per >= st.total : items.length < st.per);
      if (done) { baselineJustDone = !st.baseline_done; st.page = 1; st.scans++; st.baseline_done = true; st.last_full_scan_day = today; await save(); await setSourceAsOf('kapt_new_complexes', today, '확인(매일)'); break; }
      st.page++; await save();
    }
    // 2) 새로 등록된 단지 기본정보 확인(한 번에 40곳·시간 안에서) — 활용신청이 안 됐으면 이번 실행은 멈춤, 한 단지만 문제면 3번까지 다시
    const todo = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = ${CODES} and row->>'fresh' = 'true' and row->>'checked_at' is null
      order by row->>'first_seen_at', src_id limit ${CHECKS_PER_RUN}`;
    const payloads: Record<string, unknown>[] = []; let checked = 0;
    const call = async (op: string, code: string) => {
      const u = new URL(`${BASIS_API()}/${op}`); u.searchParams.set('serviceKey', key); u.searchParams.set('kaptCode', code); basis.calls++;
      return ((await callDataGo(u, ctx.fetchImpl, key, Math.max(3000, Math.min(10000, left() - 2000))))[0] ?? null) as Record<string, unknown> | null;
    };
    const mark = (code: string, patch: Record<string, unknown>) => sql`update sales_src_rows set row = row || ${sql.json(patch as never)}::jsonb, synced_at = now() where scope = 'global' and tbl = ${CODES} and src_id = ${code}`;
    for (const r of todo) {
      if (left() < 4000) break;
      try {
        const b = await call('getAphusBassInfoV5', r.src_id); if (b) basis.received++;
        let p = b ? newComplexPayload(r.src_id, b, null, today, at) : null;
        if (p && b) { const d = await call('getAphusDtlInfoV5', r.src_id).catch(() => null); if (d) p = newComplexPayload(r.src_id, b, d, today, at) ?? p; payloads.push(p); basis.kept++; }
        await mark(r.src_id, { checked_at: at, usedate: b ? toYmd(str(b.kaptUsedate) ?? undefined) : null, households: b ? int(b.kaptdaCnt) : null, address: b ? str(b.kaptAddr) : null, recent: !!p });
        checked++;
      } catch (e) {
        // 원천 '자료 없음'(resultCode 03 NODATA)은 공통 처리에서 '활용신청 필요'로 바뀌어 오므로 바꾸기 전 원문으로 먼저 가른다
        const raw = mask(e instanceof Error ? e.message : String(e)); const msg = portalErr(raw, KAPT_BASIS_SERVICE);
        if (/NODATA|NO_DATA|데이터\s*없음/i.test(raw)) { await mark(r.src_id, { checked_at: at, usedate: null, recent: false, check_error: '기본정보 없음' }); checked++; continue; }
        if (/활용신청 필요/.test(msg)) { basis.ok = false; basis.error = msg; errs.push(`기본정보: ${msg}`); break; }
        const tries = Number(r.row?.tries ?? 0) + 1;
        await mark(r.src_id, { tries, check_error: msg.slice(0, 200), ...(tries >= MAX_TRIES ? { checked_at: at } : {}) });
        if (errs.length < 5) errs.push(`기본정보 ${r.src_id}: ${msg.slice(0, 160)}`);
      }
    }
    // 3) 준공·입주 시설 표에 쓰기(단지 코드로 묶음)
    const w = payloads.length ? await upsertProspects(payloads) : { inserted: 0, updated: 0, unchanged: 0, errors: 0, invalid: 0, errorLog: undefined as string | undefined };
    if (w.errorLog) errs.push(w.errorLog);
    // 4) 212차 #612 ①: 빈 칸 다시 확인(단지마다 주 1회, 한 번에 20곳·시간 안에서 — 최근 준공부터). 기본정보 활용신청이 막혔으면 안 함
    let rechecked = 0, refilled = 0;
    if (basis.ok && left() > 8000) {
      const weekAgo = new Date(ctx.now() - 7 * 864e5).toISOString();
      // 단지 코드: 줄의 facility_code, 없으면 같은 단지 키(dedupe_key '아파트|code:A…') — 수집 줄은 코드를 키에만 남김
      const gaps = await sql<{ src_id: string; row: any; code: string }[]>`with g as (select p.src_id, p.row,
          coalesce(nullif(p.row->>'facility_code', ''), substring(p.row->>'dedupe_key' from 'code:(A[0-9]{6,10})$')) as code
        from sales_src_rows p where p.scope = 'global' and p.tbl = 'operating_facility_prospects' and not p.gone
          and (coalesce(p.row->>'office_phone', '') = '' or coalesce(p.row->>'amenities', '') = '' or p.row->>'household_count' is null))
        select g.src_id, g.row, g.code from g where g.code ~ '^A[0-9]{6,10}$'
          and not exists (select 1 from sales_src_rows c where c.scope = 'global' and c.tbl = ${RECHECK} and c.src_id = g.code and c.row->>'at' > ${weekAgo})
        order by coalesce(g.row->>'completion_date', '') desc, g.src_id limit ${RECHECKS_PER_RUN}`;
      const seen = new Set<string>();
      for (const g of gaps) {
        const code = g.code; if (seen.has(code)) continue; seen.add(code);
        if (left() < 4000) break;
        let note: Record<string, unknown> = { at };
        try {
          const b = await call('getAphusBassInfoV5', code);
          const d = b ? await call('getAphusDtlInfoV5', code).catch(() => null) : null;
          const fill: Record<string, unknown> = {};
          const phone = b ? str(b.kaptTel) : null, households = b ? int(b.kaptdaCnt) : null, amen = d ? str(d.welfareFacility) : null;
          if (phone && !str(g.row.office_phone)) fill.office_phone = phone;
          if (amen && !str(g.row.amenities)) fill.amenities = amen;
          if (households != null && g.row.household_count == null) fill.household_count = households;
          if (Object.keys(fill).length) {
            await sql`update sales_src_rows set row = row || ${sql.json({ ...fill, updated_at: at } as never)}::jsonb, synced_at = now() where scope = 'global' and tbl = 'operating_facility_prospects' and src_id = ${g.src_id}`;
            refilled++;
          }
          note = { at, filled: Object.keys(fill) };
        } catch (e) {
          const raw = mask(e instanceof Error ? e.message : String(e)); const msg = portalErr(raw, KAPT_BASIS_SERVICE);
          if (/활용신청 필요/.test(msg) && !/NODATA|NO_DATA|데이터\s*없음/i.test(raw)) break;
          note = { at, error: msg.slice(0, 120) };
        }
        await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', ${RECHECK}, ${code}, ${sql.json(note as never)}, 'workin')
          on conflict (scope, tbl, src_id) do update set row = excluded.row, synced_at = now()`;
        rechecked++;
      }
    }
    const [{ n: pending }] = await sql<{ n: number }[]>`select count(*)::int as n from sales_src_rows where scope = 'global' and tbl = ${CODES} and row->>'fresh' = 'true' and row->>'checked_at' is null`;
    const n = (v: number) => v.toLocaleString('ko-KR');
    const listPart = !scanToday ? '단지 목록 오늘 한 바퀴 읽음'
      : baselineJustDone ? `기준 목록 완성(전국 ${n(st.total)}곳) — 다음 바퀴부터 새로 등록된 단지를 찾음`
      : !st.baseline_done ? `기준 목록 만드는 중 ${pages}쪽 읽음(${n(Math.min((st.page - 1) * st.per, st.total))}/${n(st.total)}곳, 처음 한 바퀴는 새 단지로 세지 않음)`
      : `단지 목록 ${pages}쪽 읽음(전국 ${n(st.total)}곳${st.page > 1 ? ` · 다음은 ${st.page}쪽부터` : ' · 한 바퀴 끝'})`;
    return {
      inserted: w.inserted, updated: w.updated, unchanged: w.unchanged, errors: errs.length + w.invalid, errorLog: errs.length ? errs.join('\n') : undefined, providerMode: 'api',
      sources: { apt_list: list, apt_basis: basis },
      summary: `${listPart} · 새로 등록된 단지 ${fresh}곳 · 기본정보 확인 ${checked}곳(남은 ${pending}) → 사용승인 18개월 안 ${payloads.length}곳(신규 ${w.inserted} · 갱신 ${w.updated})`
        + (rechecked ? ` · 빈 칸 다시 확인 ${rechecked}곳(채움 ${refilled})` : ''),
    };
  },
};
