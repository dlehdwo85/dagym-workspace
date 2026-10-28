// 대표 10/24 추가 ②(로컬 #574): 같은 공고는 카드 한 장 — 입찰·공고 목록·영업 홈 숫자·당일 메일이 같은 기준.
// 운영 10/24 관련 공고 300건 중 같은 제목 4쌍: 나라장터 취소 공고가 원 공고와 다른 건으로 와서 원 공고가 '진행중'으로 남음(번호는 같고 차수만 다름),
// K-apt 같은 공고 두 번 게시(10/20·10/22, 마감 같음), 날짜까지 같은 완전 중복. 예전에는 원천 + 원천 번호 전체로만 묶어서 차수가 다르면 다른 공고였다.
import { sourceFiles } from './files';

const s = (v: unknown) => String(v ?? '').trim();
/** '대상 아님'으로 넘긴 공고는 모든 목록(전체 탭 포함)·숫자·당일 메일에서 빠지고 [대상 아님] 탭에만 — 미참여는 그대로 보임 */
export const SKIP_ONLY = /대상\s?아님|not[_\s-]?target/i;
const pick = (o: any, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return null; };
const DEADLINE = ['deadline_at', 'close_at', 'deadline', 'bid_close_at', 'closing_date', 'end_date'];
/** 서울 날짜(YYYY-MM-DD) — 시각이 붙은 값은 서울 기준으로 바꿈 */
const kday = (v: unknown) => {
  const t = s(v); const m = t.match(/^(\d{4})-?(\d{2})-?(\d{2})/); if (!m) return null;
  if (/[T\s]\d{2}:/.test(t)) { const d = new Date(t); if (!Number.isNaN(d.getTime())) return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d); }
  return `${m[1]}-${m[2]}-${m[3]}`;
};
const flat = (v: unknown) => s(v).replace(/[^0-9A-Za-z가-힣]/g, '').toLowerCase();

/** 같은 공고 번호: 나라장터·누리장터는 '번호-차수' — 정정·취소 공고마다 올라가는 차수를 뗀 번호 */
export function noKey(r: any): { key: string | null; ord: number } {
  const st = s(r?.source_type); const ext = s(r?.source_external_id);
  if (!ext) return { key: null, ord: 0 };
  const m = ['g2b_bid', 'nuri_bid'].includes(st) ? ext.match(/^(.*)-(\d{1,3})$/) : null;
  return { key: `${st}|${m ? m[1] : ext}`, ord: m ? Number(m[2]) : 0 };
}
/** 취소·정정·재공고·긴급 표시를 뺀 제목(띄어쓰기·기호 무시) */
const MARK = /[[(（【〔<]\s*(?:긴급|취소|정정|변경|재공고|재입찰|재게시)[^\])）】〕>]{0,12}[\])）】〕>]/g;
export const plainTitle = (t: unknown) => flat(s(t).replace(MARK, ' ').replace(/(?:취소|정정|변경|긴급|재)\s*공고/g, ' '));
/** 같은 원천 + 같은 제목 + 같은 기관 + 같은 마감일 — K-apt 재게시·완전 중복. 협력사 모집 글은 해마다 같은 제목이라 번호로만, 마감일이 없거나 제목이 짧으면 묶지 않음 */
export function titleKey(r: any): string | null {
  const st = s(r?.source_type); if (st === 'vendor_recruit') return null;
  const t = plainTitle(pick(r, 'title', 'notice_title', 'bid_name', 'name')); const close = kday(pick(r, ...DEADLINE));
  if (t.length < 6 || !close) return null;
  return `${st}|${t}|${flat(pick(r, 'issuer', 'agency', 'demand_agency', 'org_name', 'facility_name', 'complex_name'))}|${close}`;
}
export const noticeKeys = (r: any) => { const n = noKey(r).key; const t = titleKey(r); return [...(n ? [`n:${n}`] : []), ...(t ? [`t:${t}`] : [])]; };

/** 열쇠(번호·제목) 하나라도 같으면 한 묶음(이어진 것끼리 모두) */
export function groupNotices<T>(rows: T[]): T[][] {
  const up = rows.map((_, i) => i);
  const top = (i: number): number => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
  const first = new Map<string, number>();
  rows.forEach((r, i) => { for (const k of noticeKeys(r)) { const j = first.get(k); if (j === undefined) first.set(k, i); else { const a = top(j), b = top(i); if (a !== b) up[b] = a; } } });
  const out = new Map<number, T[]>();
  rows.forEach((r, i) => { const g = top(i); const l = out.get(g); if (l) l.push(r); else out.set(g, [r]); });
  return [...out.values()];
}

const idOf = (r: any) => String(r?.id ?? r?.__id);
/** 취소된 게시: 취소 공고이거나 원천 상태가 취소 */
export const isCancel = (r: any) => s(r?.notice_kind) === 'cancel' || /취소/.test(s(r?.current_status));
/** 게시일(공고일, 없으면 처음 본 날) → 차수 → 처음 본 시각 순 */
const postDay = (r: any) => kday(pick(r, 'posted_date', 'notice_date', 'posted_at', 'published_at', 'bid_notice_date')) ?? kday(r?.first_seen_at);
const order = (a: any, b: any) => s(postDay(a)).localeCompare(s(postDay(b))) || noKey(a).ord - noKey(b).ord || (Date.parse(s(a?.first_seen_at)) || 0) - (Date.parse(s(b?.first_seen_at)) || 0);

/** #751 후속(로컬 10/28 18:22 광명자이더샵포레나): 같은 원천·번호의 줄이 둘(원본 영업관리 복사 + 워크인 수집)인데 한 줄만 취소면 둘 다 취소 —
 *  예전엔 취소가 아닌 다른 줄이 '가장 나중 게시'로 잡혀 카드가 '진행중'으로 남았다 */
const rowKey = (r: any) => { const st = s(r?.source_type), ext = s(r?.source_external_id); return st && ext ? `${st}|${ext}` : null; };
const cancelOf = (rows: any[]) => { const c = new Set(rows.filter(isCancel).map(rowKey).filter(Boolean)); return (r: any) => isCancel(r) || (!!rowKey(r) && c.has(rowKey(r))); };
/** 196차(결정 15-35): 같은 공고 묶음(같은 번호·차수만 다름)에서 가장 나중 게시가 취소인가 — 입찰 업무 정기 점검(취소 연동) */
export const latestCancelled = (rows: any[]) => { const all = [...rows].sort(order); const c = cancelOf(all); return all.length > 0 && c(all[all.length - 1]); };
/** 같은 묶음에서 취소가 아닌 가장 나중 게시(정정 공고의 바뀐 날짜를 따라감) — 없으면 null */
export const latestLive = (rows: any[]) => { const all = [...rows].sort(order); const c = cancelOf(all); const live = all.filter((r) => !c(r)); return live[live.length - 1] ?? null; };

/** 카드에 붙는 묶음 정보 — 화면: '10/23 취소 공고' · '2회 게시(10/20 취소·10/22)' · '정정 10/22' */
export type NoticeHistory = { merged: number; cancelDay: string | null; cancelNotice: boolean; posts: { day: string | null; cancelled: boolean }[]; amendDay: string | null };

/**
 * 같은 공고 묶음마다 카드 한 줄. 카드(id·진행 기록) = 이 회사 진행 기록이 걸린 줄(여럿이면 가장 최근에 고친 줄) → 없으면 가장 최근 게시(취소 공고 아님).
 * 상태·마감은 가장 최근 게시 기준 — 맨 뒤 게시가 취소면 '취소'. 첨부는 묶음 전체. 한 줄짜리는 그대로.
 * workAt(id): 그 줄의 진행 기록을 고친 시각(ms, 모르면 1) · 분류만 있으면 0 · 기록 없음 null
 */
export function oneCardPerNotice(list: any[], workAt: (id: string) => number | null): any[] {
  const out: any[] = [];
  for (const g of groupNotices(list)) {
    if (g.length === 1) { out.push(g[0]); continue; }
    const all = [...g].sort(order); const latest = all[all.length - 1]; const cancelRow = cancelOf(all);
    const live = all.filter((r) => !cancelRow(r)); const lastLive = live[live.length - 1] ?? null;
    const linked = all.map((r, i) => ({ r, i, at: workAt(idOf(r)) })).filter((x) => x.at !== null).sort((a, b) => b.at! - a.at! || b.i - a.i);
    const rep = linked[0]?.r ?? lastLive ?? latest;
    const cancelled = cancelRow(latest);
    // 취소·정정 공고가 아닌 게시(재게시 포함)를 게시일마다 하나로 — 같은 게시가 두 줄(원본 복사 + 워크인 수집)이어도 1회, 그날 마지막 줄의 취소 여부
    const byDay = new Map<string | null, boolean>();
    for (const r of all) if (!['cancel', 'amend'].includes(s(r.notice_kind))) byDay.set(postDay(r), cancelRow(r));
    const posts = [...byDay].map(([day, cancelled]) => ({ day, cancelled }));
    const amend = [...all].reverse().find((r) => s(r.notice_kind) === 'amend');
    const history: NoticeHistory = { merged: g.length, cancelDay: cancelled ? postDay(latest) : null, cancelNotice: cancelled && s(latest.notice_kind) === 'cancel',
      posts: posts.length > 1 ? posts : [], amendDay: amend ? postDay(amend) : null };
    const files = sourceFiles(...g.flatMap((r) => [r.attachment_urls ?? r.attachments, r.notice_file_url])).map((x) => (x.name ? { name: x.name, url: x.url } : x.url));
    const deadline = pick(lastLive ?? rep, ...DEADLINE);
    out.push({ ...rep, current_status: cancelled ? '취소' : pick(lastLive, 'current_status', 'status') ?? rep.current_status, ...(deadline ? { deadline_at: deadline } : {}), attachment_urls: files, __history: history, __orig: rep, __firstDay: postDay(all[0]) });
  }
  return out;
}

// 137차(로컬 10/24 23:55 135차 ③ 화원): 사전규격 → 본 공고 = 같은 사업. 원천이 달라(g2b_prespec·g2b_bid) 위 같은 공고 묶음에는 안 들어가므로 따로 잇는다.
// 기준: 같은 발주·수요기관 + 표시를 뺀 같은 제목(8자 넘으면 한쪽이 다른 쪽을 품어도) + 사전규격이 본 공고보다 앞(120일 안).
// 둘 중 하나를 '대상 아님'으로 넘기면 다른 쪽도 모든 목록·숫자·당일 메일에서 빠짐 — 다른 쪽에 미검토 말고 진행 기록이 있으면 그대로.
export const isPrespec = (r: any) => /prespec/.test(s(r?.source_type)) || s(r?.notice_type) === '사전규격';
const NOT_BID = /vendor_recruit|onbid/;
const PROJECT_DAYS = 120;
const orgsOf = (r: any) => [...new Set([pick(r, 'issuer', 'agency', 'org_name'), pick(r, 'demand_agency')].map(flat).filter((x) => x.length >= 2))];
const projectTitle = (r: any) => plainTitle(pick(r, 'title', 'notice_title', 'bid_name', 'name')).replace(/사전규격(?:공개)?/g, '');
const sameTitle = (a: string, b: string) => a.length >= 6 && b.length >= 6 && (a === b || (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a))));
/** 사전규격 pre 가 본 공고 bid 의 같은 사업인가 — 날짜는 묶음의 첫 게시(oneCardPerNotice __firstDay) */
function leadsTo(pre: any, bid: any) {
  if (!isPrespec(pre) || isPrespec(bid) || NOT_BID.test(s(bid?.source_type))) return false;
  const a = s(pre?.__firstDay) || postDay(pre), b = s(bid?.__firstDay) || postDay(bid); if (!a || !b) return false;
  const gap = (Date.parse(b) - Date.parse(a)) / 864e5;
  return gap >= 0 && gap <= PROJECT_DAYS && sameTitle(projectTitle(pre), projectTitle(bid)) && orgsOf(pre).some((o) => orgsOf(bid).includes(o));
}
export const sameProject = (a: any, b: any) => a !== b && (leadsTo(a, b) || leadsTo(b, a));
/** 대상 아님 줄(카드)들 → 줄 하나를 주면 같은 사업으로 이어진 대상 아님 줄(없으면 null) */
export function projectSkipOf(skipped: any[]): (r: any) => any | null {
  const byOrg = new Map<string, any[]>();
  for (const x of skipped) for (const o of orgsOf(x)) byOrg.set(o, [...(byOrg.get(o) ?? []), x]);
  return (r) => { for (const o of orgsOf(r)) for (const x of byOrg.get(o) ?? []) if (sameProject(x, r)) return x; return null; };
}
/** 미검토(처음 상태·되돌리기 직후) 말고 진행 기록이 있음 — 이어진 쪽이 대상 아님이어도 그대로 보임 */
export const settledWork = (status: unknown) => { const x = s(status); return !!x && x !== '미검토' && !SKIP_ONLY.test(x); };
/**
 * 목록·숫자 공통: 카드마다 '대상 아님' 숨김 — 자기 진행 기록이 대상 아님(own) · 또는 같은 사업 카드가 대상 아님이라 함께 숨김(under: 카드 id → 그 대상 아님 카드).
 * [대상 아님] 탭은 한 장: 함께 숨긴 카드·이어진 대상 아님 사전규격은 본 카드(lead) 아래 linked 로
 */
export function skipLinks(cards: any[], statusOf: (id: string) => unknown) {
  const own = (r: any) => SKIP_ONLY.test(s(statusOf(idOf(r))));
  const owned = cards.filter(own); const via = projectSkipOf(owned);
  const under = new Map<string, any>();
  for (const r of cards) { if (own(r) || settledWork(statusOf(idOf(r)))) continue; const x = via(r); if (x) under.set(idOf(r), x); }
  // 둘 다 대상 아님이면 본 공고 쪽 한 장(사전규격을 그 아래로)
  for (const r of owned) if (isPrespec(r)) { const bid = owned.find((x) => !isPrespec(x) && sameProject(r, x)); if (bid) under.set(idOf(r), bid); }
  for (const [k, v] of under) { const up = under.get(idOf(v)); if (up) under.set(k, up); } // 함께 숨긴 카드 → 사전규격(본 공고 아래) → 본 공고
  const hidden = (r: any) => own(r) || under.has(idOf(r));
  const linked = (lead: any) => cards.filter((r) => under.get(idOf(r)) === lead);
  return { own, hidden, under, linked };
}
