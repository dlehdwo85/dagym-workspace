import { db } from '../db';
import { logError } from '../log';
import { sidoOf } from './sources';

/**
 * V41 단계 3: 청약홈 분양정보 조회 서비스(data.go.kr 15098547, odcloud) 신규단지 수집기 — 영업관리 세션(applyhome_supply)에서 이식.
 * - 세 종류: 아파트 / 오피스텔·도시형·민간임대·생활숙박 / 공공지원민간임대. 업종 중립으로 다 모으고, 회사별 대상은 데이터 설정(지역·검색어·제외어)에서 거른다.
 * - 기간: 매일 최근 30일, 처음 채우기는 days=365(플랫폼 운영 화면 [처음 채우기]).
 * - 영업 시작일 = 모집공고일(공식 값). 추정 날짜는 만들지 않음. 입주 예정월은 그 달 1일.
 * - 아파트 상세의 cond[RCRIT_PBLANC_DE::GTE] 날짜 형식은 문서에 없음 → YYYY-MM-DD 로 보내고 받은 뒤 기간을 다시 거른다(실 API 확인 필요).
 */
export const APPLYHOME_CODE = '15098547';
const KINDS = [
  { key: 'apt', label: '아파트', path: '/getAPTLttotPblancDetail' },
  { key: 'urbty', label: '오피스텔·도시형·민간임대·생활숙박', path: '/getUrbtyOfctlLttotPblancDetail' },
  { key: 'pblpvt', label: '공공지원민간임대', path: '/getPblPvtRentLttotPblancDetail' },
] as const;
const g = (o: any, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim(); } return null; };
const day = (s: string | null) => { const d = (s ?? '').replace(/[^0-9]/g, ''); return d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null; };
const month1 = (s: string | null) => { const d = (s ?? '').replace(/[^0-9]/g, ''); return d.length >= 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-01` : null; };
const seoulDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);

/** 원본 한 건 → 공용 영업기회 한 줄(알 수 없는 값은 비움) */
export function mapApplyhome(kind: (typeof KINDS)[number], it: any) {
  const no = g(it, 'PBLANC_NO', 'HOUSE_MANAGE_NO');
  const name = g(it, 'HOUSE_NM');
  if (!no || !name) return null;
  const households = Number(g(it, 'TOT_SUPLY_HSHLDCO', 'SUPLY_HSHLDCO') ?? '') || null;
  const notice = day(g(it, 'RCRIT_PBLANC_DE'));
  return {
    ext_id: `${kind.key}:${no}`,
    name,
    address: g(it, 'HSSPLY_ADRES'),
    category: [g(it, 'HOUSE_DTL_SECD_NM', 'HOUSE_SECD_NM') ?? kind.label, households ? `${households.toLocaleString('ko-KR')}세대` : null].filter(Boolean).join(' · '),
    status: '모집공고',
    opened_on: notice, // 영업 시작일 = 모집공고일(공식 값)
    detail: {
      kind: kind.label, households, notice,
      developer: g(it, 'BSNS_MBY_NM'), builder: g(it, 'CNSTRCT_ENTRPS_NM'),
      moveIn: month1(g(it, 'MVN_PREARNGE_YM')),
      receipt: [day(g(it, 'RCEPT_BGNDE', 'SUBSCRPT_RCEPT_BGNDE')), day(g(it, 'RCEPT_ENDDE', 'SUBSCRPT_RCEPT_ENDDE'))].filter(Boolean).join('~') || null,
      announce: day(g(it, 'PRZWNER_PRESNATN_DE')),
      contract: [day(g(it, 'CNTRCT_CNCLS_BGNDE')), day(g(it, 'CNTRCT_CNCLS_ENDDE'))].filter(Boolean).join('~') || null,
      inquiry: g(it, 'MDHS_TELNO'), url: g(it, 'PBLANC_URL', 'HMPG_ADRES'),
    },
  };
}

export async function collectApplyhome(opt: { days?: number; maxPages?: number; fetchImpl?: typeof fetch } = {}) {
  const sql = db();
  const [s] = await sql<{ endpoint: string | null }[]>`select endpoint from data_sources where code = ${APPLYHOME_CODE}`;
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!key) return { code: APPLYHOME_CODE, count: 0, error: 'DATA_GO_KR_SERVICE_KEY 없음' };
  const base = (s?.endpoint || 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1').replace(/\/$/, '');
  const days = Math.min(Math.max(opt.days ?? 30, 1), 400);
  const since = seoulDay(new Date(Date.now() - days * 864e5));
  let count = 0; const errors: string[] = []; const byKind: Record<string, number> = {};
  for (const kind of KINDS) {
    byKind[kind.key] = 0;
    try {
      for (let page = 1; page <= (opt.maxPages ?? 20); page++) {
        const u = new URL(base + kind.path);
        u.searchParams.set('page', String(page)); u.searchParams.set('perPage', '100'); u.searchParams.set('returnType', 'JSON');
        u.searchParams.set('cond[RCRIT_PBLANC_DE::GTE]', since);
        u.searchParams.set('serviceKey', key);
        const r = await (opt.fetchImpl ?? fetch)(u, { signal: AbortSignal.timeout(20_000) });
        const text = await r.text();
        let j: any; try { j = JSON.parse(text); } catch { throw new Error(`JSON 이 아닌 응답(${r.status}): ${text.slice(0, 120)}`); }
        if (!r.ok || (j?.code !== undefined && Number(j.code) < 0)) throw new Error(`HTTP ${r.status} ${j?.code ?? ''} ${String(j?.msg ?? j?.message ?? '').slice(0, 100)}`);
        const items: any[] = Array.isArray(j?.data) ? j.data : [];
        for (const it of items) {
          const m = mapApplyhome(kind, it);
          if (!m || (m.opened_on && m.opened_on < since)) continue; // 날짜 조건이 안 먹어도 기간 다시 거름
          await sql`insert into prospects (source_code, ext_id, name, address, sido, status, opened_on, category, detail, raw, base_date)
            values (${APPLYHOME_CODE}, ${m.ext_id}, ${m.name.slice(0, 300)}, ${m.address}, ${sidoOf(m.address)}, ${m.status}, ${m.opened_on}, ${m.category}, ${sql.json(m.detail as never)}, ${sql.json(it)}, current_date)
            on conflict (source_code, ext_id) do update set name = excluded.name, address = excluded.address, sido = excluded.sido, status = excluded.status,
              opened_on = coalesce(excluded.opened_on, prospects.opened_on), category = excluded.category, detail = excluded.detail, raw = excluded.raw, base_date = excluded.base_date, fetched_at = now()`;
          count++; byKind[kind.key]++;
        }
        const total = Number(j?.matchCount ?? j?.totalCount ?? 0);
        if (items.length < 100 || page * 100 >= total) break;
      }
    } catch (e: any) { errors.push(`${kind.label}: ${String(e?.message ?? e).slice(0, 200)}`); }
  }
  const error = errors.length ? errors.join(' / ').slice(0, 500) : null;
  await sql`update data_sources set last_run_at = now(), last_count = ${count}, last_error = ${error} where code = ${APPLYHOME_CODE}`;
  if (error) await logError('sales.applyhome', new Error(error)).catch(() => {});
  return { code: APPLYHOME_CODE, count, byKind, since, error };
}
