// 185차(로컬 10/26 19:20 A4): 플랫폼 운영자 — 공고 번호·제목으로 영업 DB(공용 공고 줄)를 찾아 '왜 영업실 목록에 없나'를 한눈에.
// 운영 DB 를 직접 열지 않고 확인하는 길(로컬이 대표 크롬에서 주소를 열어 봄). 공용 표라 회사 구분 없음 — 플랫폼 운영자만.
import type { SessionUser } from '../types';
import { db } from '../db';
import { badRequest } from '../errors';
import { matchFit, onbidSale } from './collectors/procurement';
import { vendorDateOk } from './collectors/vendorRules';

type Row = Record<string, any>;
const clip = (v: unknown, n: number) => { const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null; };

/** 영업실 입찰·공고 목록(srcViews bids)이 이 줄을 빼는 이유 — 회사별 [대상 아님]·검색어 조건은 회사마다 달라 여기서는 '확인 필요'로만 */
export function hiddenReasons(r: Row, gone: boolean): string[] {
  const why: string[] = [];
  if (gone) why.push(r.merged_into ? `같은 공고의 다른 줄로 합쳐짐(남긴 줄 ${r.merged_into})` : '원천에서 사라짐 표시(gone)');
  const now = matchFit(String(r.title ?? ''), r.bid_category ?? null, r.task_scope ?? null, r.source_type === 'kapt_bid' ? '공동주택' : null);
  if (!(r.related === true || r.related === 'true')) {
    why.push(now.fit ? `저장된 판정은 '관련 아님' — 지금 규칙으로는 관련(${now.fit}: ${now.matched.join('·')}) → 다시 판정 대상`
      : r.refit_lowered_at ? `다시 판정이 '관련 아님'으로 내림 — ${r.refit_lowered_why ?? '지금 규칙으로 관련 아님'}` : '관련 아님(지금 규칙으로도 관련 낱말 없음 또는 제외 주제)');
  } else if (String(r.fit_business ?? '') !== String(now.fit ?? '')) {
    // 191차: 저장 판정과 지금 규칙이 다름 — 다시 판정(수집기 실행 때·플랫폼 [다시 판정])이 바로잡음
    why.push(`저장된 판정 '${r.fit_business ?? '없음'}' — 지금 규칙으로는 ${now.fit ? `'${now.fit}'` : "'관련 아님'"}${now.dropped?.length ? `(${now.dropped.map((x) => `${x.business} 아님: ${x.why}`).join(' · ')})` : ''} → 다시 판정 대상`);
  }
  if (String(r.source_type ?? '') === 'vendor_recruit' && !vendorDateOk(r)) why.push('협력사 모집 줄 — 게시판 날짜 확인 안 됨');
  if (onbidSale(r)) why.push('온비드 매각 공고(임대·사용허가만 영업 대상)');
  if (!why.length) why.push('목록에 보여야 하는 줄 — 안 보이면 회사별 [대상 아님] 처리·검색어·기간(3년) 조건 확인');
  return why;
}

/** no = 공고 번호(원천 번호·공고번호·줄 id — K-apt 아파트장터(A2P) 번호는 앞 'A' 를 빼고 넣어도 찾음) · q = 제목 낱말(2자 이상) — 사라진 줄·합쳐진 줄까지 최근 30줄.
 *  191차: listCheck = 조회한 사람 회사의 입찰 목록(전체 탭)에 이 줄이 들어가는지, 빠지면 어느 단계에서(srcViews 와 같은 계산) */
export async function lookupNotices(q: { no?: string | null; q?: string | null }, u?: SessionUser) {
  const no = String(q.no ?? '').trim().slice(0, 80); const term = String(q.q ?? '').trim().slice(0, 80);
  if (!no && term.length < 2) throw badRequest('공고 번호(no) 또는 제목 낱말(q, 2자 이상)을 넣어 주세요');
  const nos = no ? [...new Set([no, /^\d+$/.test(no) ? `A${no}` : null, /^A\d+$/i.test(no) ? no.slice(1) : null].filter((x): x is string => !!x))] : [];
  const sql = db(); const like = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const rows = await sql<{ src_id: string; row: any; gone: boolean; origin: string | null; synced_at: Date }[]>`select src_id, row, gone, origin, synced_at from sales_src_rows
    where scope = 'global' and tbl = 'procurement_notices'
      and (${nos.length ? sql`row->>'source_external_id' = any(${nos}::text[]) or row->>'notice_no' = any(${nos}::text[]) or src_id = any(${nos}::text[])` : sql`false`} ${like ? sql`or row->>'title' ilike ${like}` : sql``})
    order by synced_at desc limit 30`;
  // 191차: 목록 쪽 실제 결과 — 회사 영업 공간·입찰 기능이 꺼져 있으면 null
  const traced = u && rows.length ? await (await import('./srcViews')).salesView(u, 'bids', { tab: 'all', trace: rows.map((x) => x.src_id) }).then((v: any) => new Map<string, any>((v?.trace ?? []).map((t: any) => [t.id, t])), () => null) : null;
  return {
    items: rows.map(({ src_id, row: r, gone, origin, synced_at }) => ({
      id: src_id, origin: origin === 'workin' ? '워크인 수집' : '원본 영업관리 복사', gone, mergedInto: r.merged_into ?? null,
      sourceType: r.source_type ?? null, sourceNo: r.source_external_id ?? null, title: r.title ?? null, bidCategory: r.bid_category ?? null, body: clip(r.task_scope, 300),
      related: r.related === true || r.related === 'true', fitBusiness: r.fit_business ?? null, matchedKeywords: Array.isArray(r.matched_keywords) ? r.matched_keywords : [], classification: r.classification ?? null,
      postedDate: r.posted_date ?? null, deadlineAt: r.deadline_at ?? null, status: r.current_status ?? null,
      // 229차(로컬 10/28 13:55 '남원시 결과 줄에 낙찰률·참가 수 빠짐'): 낙찰 칸과 결과를 처음 안 때·마지막 고친 때 — 메일 결과 줄과 대조용
      award: r.winner_name || r.winner_amount || r.winner_rate || r.bidders ? { winner: r.winner_name ?? null, winnerBizNo: r.winner_biz_no ?? null, amount: r.winner_amount ?? null, rate: r.winner_rate ?? null,
        bidders: r.bidders ?? null, awardDate: r.award_date ?? null, resultAt: r.result_at ?? null } : null, updatedAt: r.updated_at ?? null,
      firstSeenAt: r.first_seen_at ?? r.created_at ?? null, lastSeenAt: r.last_seen_at ?? null, refitAt: r.refit_at ?? null, refoundAt: r.refound_at ?? null, syncedAt: synced_at,
      nowRule: (() => { const f = matchFit(String(r.title ?? ''), r.bid_category ?? null, r.task_scope ?? null, r.source_type === 'kapt_bid' ? '공동주택' : null); return { fit: f.fit, matched: f.matched, dropped: f.dropped ?? [] }; })(),
      refitLoweredAt: r.refit_lowered_at ?? null, refitLoweredWhy: r.refit_lowered_why ?? null, judgedAt: r.judged_at ?? null,
      reasons: hiddenReasons(r, gone),
      listCheck: traced ? (gone ? { listed: false, step: 'read', why: '사라짐·합쳐짐 줄은 목록에서 읽지 않음' } : traced.get(src_id) ?? null) : null,
    })),
  };
}
