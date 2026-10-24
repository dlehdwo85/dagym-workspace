/**
 * #543 공고 [원문] 주소(로컬 10/24): 차세대 나라장터는 옛 주소(…/ep/invitation/publish/bidInfoDtl.do · …/ep/preparation/prestd/preStdDtl.do)가
 * '요청하신 페이지를 찾을수 없습니다'(클라우드에서도 10/24 확인). 입찰공고는 새 형식으로 바꿈(로컬 확인 — 나라장터 로그인을 거쳐 그 공고로).
 * 바로 가는 상세 주소를 모르는 곳(온비드·국방전자조달·LH·누리장터 첫 화면 주소, 옛 사전규격 주소)은 [원문] 대신 '○○에서 공고번호 검색' 안내 + 번호 복사.
 * 서버(수집기·화면 데이터·당일 메일)와 화면이 같이 씀 — 서버 전용 모듈을 가져오지 않음
 */
export const g2bBidUrl = (no: string, ord: string) => `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${encodeURIComponent(no)}&bidPbancOrd=${encodeURIComponent(ord)}`;
const OLD_BID = /^https?:\/\/(?:www\.)?g2b\.go\.kr(?::\d+)?\/ep\/invitation\/publish\/bidInfoDtl\.do\?/i;
const OLD_PRESPEC = /^https?:\/\/(?:www\.)?g2b\.go\.kr(?::\d+)?\/ep\/preparation\/prestd\/preStdDtl\.do/i;
/** 옛 나라장터 입찰공고 주소 → 새 형식(그 밖의 주소는 그대로) */
export function fixG2bUrl(u: unknown): string | null {
  const s = typeof u === 'string' ? u.trim() : '';
  if (!s) return null;
  if (!OLD_BID.test(s)) return s;
  try { const q = new URL(s).searchParams; const no = q.get('bidno'); return no ? g2bBidUrl(no, q.get('bidseq') || '000') : s; } catch { return s; }
}
export type SearchHint = { site: string; home: string; label: string; no: string };
const HOMES: [RegExp, string, string][] = [
  [/(^|\.)onbid\.co\.kr$/i, '온비드', 'https://www.onbid.co.kr'],
  [/(^|\.)d2b\.go\.kr$/i, '국방전자조달', 'https://www.d2b.go.kr'],
  [/(^|\.)ebid\.lh\.or\.kr$/i, 'LH 전자조달', 'https://ebid.lh.or.kr'],
  [/(^|\.)nuri\.g2b\.go\.kr$/i, '누리장터', 'https://nuri.g2b.go.kr'],
];
/** 내부 키 → 공고번호: 방위사업청 시설 'F-'·LH 사전규격 'lhpre-' 앞붙임과 '-차수' 뒷붙임을 뗌(수집 때 공고번호를 따로 남긴 줄은 그것을 씀) */
const bareNo = (source: string, ext: string) => {
  const n = ext.replace(/^(F-|lhpre-)/, '');
  return /^(d2b_bid|lh_bid|nuri_bid)$/.test(source) ? n.replace(/-\d{1,3}$/, '') : n;
};
/** 바로 가는 상세 주소가 없으면(사이트 첫 화면·옛 사전규격 주소) 번호 검색 안내 — 번호를 모르면 null(그냥 링크) */
export function searchHint(r: { source?: unknown; url?: unknown; externalId?: unknown; noticeNo?: unknown }): SearchHint | null {
  const url = typeof r.url === 'string' ? r.url.trim() : '';
  const source = String(r.source ?? '');
  const no = String(r.noticeNo ?? '').trim() || bareNo(source, String(r.externalId ?? '').trim());
  if (!url || !no) return null;
  if (OLD_PRESPEC.test(url)) {
    let reg = no; try { reg = new URL(url).searchParams.get('preStdRegNo') || no; } catch { /* 번호는 키에서 */ }
    return { site: '나라장터', home: 'https://www.g2b.go.kr', label: '사전규격 등록번호', no: reg };
  }
  let u: URL; try { u = new URL(url); } catch { return null; }
  if (u.pathname.replace(/\/+$/, '') !== '' || u.search) return null; // 첫 화면 주소만
  const h = HOMES.find(([re]) => re.test(u.hostname));
  return h ? { site: h[1], home: h[2], label: '공고번호', no } : null;
}
