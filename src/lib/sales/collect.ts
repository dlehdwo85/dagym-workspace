import { db } from '../db';
import { logError } from '../log';
import { sidoOf } from './sources';

/** V41 단계 3: 공공데이터 공통 수집기(행안부 인허가 16종 + 그 밖 API). 우리 키(DATA_GO_KR_SERVICE_KEY)로 하루 한 번 모아 공용 표에.
 * 원천별 주소(endpoint)·추가 인자(params)·칸 이름(field_map)은 data_sources 에 — 운영에서 실제 응답을 보고 플랫폼 운영자가 맞춘다.
 * field_map 이 없으면 행안부 인허가(신규 data.go.kr·옛 LOCALDATA) 흔한 칸 이름을 차례로 시도. */
const PICK: Record<string, string[]> = {
  id: ['MNG_NO', 'mngNo', 'mgtNo', 'MGT_NO', 'ykiho', 'id'],
  name: ['BPLC_NM', 'bplcNm', 'yadmNm', 'bizplc_nm', 'wkplNm', 'name'],
  address: ['ROAD_NM_ADDR', 'rdnWhlAddr', 'LOTNO_ADDR', 'siteWhlAddr', 'addr', 'address'],
  status: ['SALS_STTS_NM', 'trdStateNm', 'DTL_SALS_STTS_NM', 'dtlStateNm', 'status'],
  opened: ['LCPMT_YMD', 'apvPermYmd', 'estbDd', 'opened'],
  closed: ['CLSBIZ_YMD', 'dcbYmd', 'closed'],
  category: ['BZSTAT_SE_NM', 'uptaeNm', 'clCdNm', 'category'],
};
const get = (o: any, keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim(); } return null; };
const ymd = (s: string | null) => { const d = (s ?? '').replace(/[^0-9]/g, '').slice(0, 8); return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null; };
function itemsOf(j: any): any[] {
  const c = j?.response?.body?.items?.item ?? j?.response?.body?.items ?? j?.body?.items?.item ?? j?.body?.items ?? j?.items?.item ?? j?.items ?? j?.data ?? [];
  return Array.isArray(c) ? c : c && typeof c === 'object' ? [c] : [];
}

export async function collectSource(code: string, opt: { maxPages?: number; fetchImpl?: typeof fetch } = {}) {
  const sql = db();
  const [s] = await sql<any[]>`select code, endpoint, params, field_map from data_sources where code = ${code}`;
  if (!s?.endpoint) return { code, count: 0, error: '수집 주소(endpoint)가 아직 없습니다' };
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!key) return { code, count: 0, error: 'DATA_GO_KR_SERVICE_KEY 없음' };
  const fm = { ...PICK, ...Object.fromEntries(Object.entries(s.field_map ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v : [String(v)]])) } as Record<string, string[]>;
  const { maxPages = 3, ...params } = { ...(s.params ?? {}), ...(opt.maxPages ? { maxPages: opt.maxPages } : {}) } as Record<string, any>;
  let count = 0; let error: string | null = null;
  try {
    for (let page = 1; page <= Number(maxPages); page++) {
      const u = new URL(s.endpoint);
      u.searchParams.set('serviceKey', key); u.searchParams.set('pageNo', String(page)); u.searchParams.set('numOfRows', String(params.numOfRows ?? 100));
      if (!u.searchParams.has('type') && !params.noType) u.searchParams.set('type', 'json');
      for (const [k, v] of Object.entries(params)) if (!['numOfRows', 'noType'].includes(k)) u.searchParams.set(k, String(v));
      const r = await (opt.fetchImpl ?? fetch)(u, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      let j: any; try { j = JSON.parse(text); } catch { throw new Error(`JSON 이 아닌 응답: ${text.slice(0, 120)}`); }
      const items = itemsOf(j);
      for (const it of items) {
        const id = get(it, fm.id) ?? [get(it, fm.name), get(it, fm.address)].filter(Boolean).join('|');
        const name = get(it, fm.name);
        if (!id || !name) continue;
        const address = get(it, fm.address);
        await sql`insert into prospects (source_code, ext_id, name, address, sido, status, opened_on, closed_on, category, raw, base_date)
          values (${code}, ${id.slice(0, 200)}, ${name.slice(0, 300)}, ${address}, ${sidoOf(address)}, ${get(it, fm.status)}, ${ymd(get(it, fm.opened))}, ${ymd(get(it, fm.closed))}, ${get(it, fm.category)}, ${sql.json(it)}, current_date)
          on conflict (source_code, ext_id) do update set name = excluded.name, address = excluded.address, sido = excluded.sido, status = excluded.status,
            opened_on = coalesce(excluded.opened_on, prospects.opened_on), closed_on = excluded.closed_on, category = excluded.category, raw = excluded.raw, base_date = excluded.base_date, fetched_at = now()`;
        count++;
      }
      if (items.length < Number(params.numOfRows ?? 100)) break;
    }
  } catch (e: any) { error = String(e?.message ?? e).slice(0, 500); }
  await sql`update data_sources set last_run_at = now(), last_count = ${count}, last_error = ${error} where code = ${code}`;
  if (error) await logError('sales.collect', new Error(`${code}: ${error}`)).catch(() => {});
  return { code, count, error };
}

/** 정기 실행(tick): 수집을 켠 원천 중 오늘(서울) 아직 안 돈 것 하나씩 — 짧은 실행 시간 안에 끝나게 */
export async function collectDue() {
  if (!process.env.DATA_GO_KR_SERVICE_KEY) return null;
  const [s] = await db()<{ code: string }[]>`select code from data_sources where collect and endpoint is not null
    and (last_run_at is null or (last_run_at at time zone 'Asia/Seoul')::date < (now() at time zone 'Asia/Seoul')::date)
    and extract(hour from now() at time zone 'Asia/Seoul') >= 6 order by last_run_at nulls first limit 1`;
  return s ? collectSource(s.code) : null;
}
