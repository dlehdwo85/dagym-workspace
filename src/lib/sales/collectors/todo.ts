// #629(대표 10/25 21:20 "오류 잡아야 함, 고객에게 이런 게 보이면 안 됨"): 영업 홈·수집기 칸 빨간 띠와 관리자 알림의 첫 줄은 오류 원문 대신 '할 일' 한 문장.
// 영문 오류 코드·HTTP 코드·연속 실패 수는 error/reason 으로 따로 두고 화면에서는 접힘 '자세히'. 고객사 쪽은 customerScope(#602)가 '오늘 새 공고를 받지 못했습니다' 한 줄로 바꾼다.
// DB·외부 호출 없음 — 서버(collectorAlerts)·화면(Collectors.tsx)·시험이 같이 쓴다.
export type CollectorTodo = { todo: string; action: 'apply' | 'key' | 'url' | 'limit' | 'retry' | 'check'; service: string | null; link: string | null };

/** 공공데이터포털 서비스 화면(활용신청 단추가 있는 곳) */
export const portalUrl = (n: string) => `https://www.data.go.kr/data/${n}/openapi.do`;

/** 수집기(원천)별 공공데이터포털 서비스 번호 — 오류 원문에 번호가 없을 때 [신청 방법] 링크용. 각 수집기 코드에 적힌 번호와 같다(원천이 여럿인 수집기는 'slug/원천' 키) */
export const PORTAL_SERVICES: Record<string, string> = {
  kapt_sa_sun: '15059177', // 국토교통부 공동주택 입찰결과공지(사업자선정 결과)
  kapt_bid_notices: '15058166', // 국토교통부 공동주택 입찰공고(공식 API)
  tourist_hotels_localdata: '15155090', // 행안부 관광숙박업 조회
  kstartup_support: '15125364', // 창업진흥원 K-Startup 사업공고
  kapt_new_complexes: '15057332', 'kapt_new_complexes/apt_list': '15057332', 'kapt_new_complexes/apt_basis': '15058453', // 186차 국토교통부 공동주택 단지 목록·기본정보
  // 390차(대표 11/13 영업 홈 '수자원공사·마사회 — 활용신청이 필요합니다'에 번호·[신청 방법]이 없었음): 공공기관 입찰 수집기 원천별(publicAgency.ts 주석의 번호)
  'public_agency_bids/lh_bid': '15159012', 'public_agency_bids/lh_prespec': '15159011', 'public_agency_bids/d2b_bid': '15158416', 'public_agency_bids/d2b_fclty': '15158416',
  'public_agency_bids/onbid_lease': '15157216', 'public_agency_bids/kwater_servc': '15101635', 'public_agency_bids/kwater_cntrwk': '15101635', 'public_agency_bids/kwater_gds': '15101635',
  'public_agency_bids/kra_bid': '15058158',
};

const SERVICE_IN_TEXT = /서비스 (\d{6,9})\)/;
/**
 * 오류 원문(원천 자체의 오류 → 없으면 실행 요약·오류 기록 hint) → 할 일 문장 + 종류 + 서비스 번호·[신청 방법] 링크.
 * 분류는 원천 자체의 오류(error)로만 하고 hint 는 서비스 번호를 찾을 때만 — 원천이 여럿인 실행의 요약에는 다른 원천의 사정이 섞여 있다.
 */
export function collectorTodo(i: { slug: string; source: string | null; error: string | null; hint?: string | null; reason: string }): CollectorTodo {
  const own = i.error ?? ''; const hint = i.hint ?? '';
  const text = own || hint;
  const service = own.match(SERVICE_IN_TEXT)?.[1] ?? PORTAL_SERVICES[`${i.slug}/${i.source ?? ''}`] ?? PORTAL_SERVICES[i.slug] ?? hint.match(SERVICE_IN_TEXT)?.[1] ?? null;
  const link = service ? portalUrl(service) : null;
  if (!text) return { action: 'retry', service: null, link: null, todo: /마지막 성공|최근 성공 없음/.test(i.reason) ? '최근에 받은 게 없습니다 — [지금 수집]으로 다시 받아 보고, 계속되면 수집기 켜짐·예약 시각을 확인해 주세요' : '수집에 실패했습니다 — [지금 수집]으로 다시 받아 보세요' };
  if (/^원천 시스템 점검 중/.test(i.reason)) return { action: 'retry', service, link: null, todo: '원천 시스템 점검 중입니다 — 끝나면 자동으로 최근 14일을 다시 받습니다(따로 할 일 없음)' }; // 279차(나라장터 10/30~11/1 점검)
  // 390차(대표 11/13 영업 홈 'LH 사전규격 — 오늘 호출 한도'): 웹페이지 응답 오류 문장 자체에 '원천 중단·호출 한도 초과·차단 가능'이 들어 있어
  // 원천이 오류 화면(HTML)을 돌려준 경우까지 호출 한도로 잘못 분류했음 → 그 안내 문구는 빼고 봄
  const plain = text.replace(/원천 중단·호출 한도 초과·차단 가능/g, ' ');
  if (/LIMITED_NUMBER|호출 ?(제한|한도)|한도 초과|\b429\b/i.test(plain)) return { action: 'limit', service, link, todo: '오늘 호출 한도를 넘었습니다 — 내일 다시 받습니다(계속되면 포털에서 트래픽 증가 신청)' };
  if (/키 없음|키가 없|KEY\S* 미설정/.test(text)) return { action: 'key', service, link, todo: '인증키가 없습니다 — 플랫폼 운영 › 영업 수집기 설정에서 키를 넣어 주세요' };
  if (/활용신청|인증키 확인|SERVICE_KEY_IS_NOT_REGISTERED|SERVICE ACCESS DENIED|등록되지 않은 (서비스|인증)키|UNREGISTERED|NOT_REGISTERED|FORBIDDEN|EXPIRED/i.test(text)) return { action: 'apply', service, link, todo: `공공데이터포털 활용신청${service ? `(서비스 ${service})` : ''}이 필요합니다` };
  if (/웹페이지\(HTML\) 응답/.test(text)) return { action: 'retry', service, link: null, todo: '원천이 자료 대신 웹페이지(오류 화면)를 돌려줬습니다 — 원천 쪽 장애일 수 있어 다음 수집 때 다시 받습니다(이틀 넘게 계속되면 클라우드 요청)' };
  if (/주소 확인 필요|\b404\b|주소가 바뀌/.test(text)) return { action: 'url', service, link: null, todo: '원천 주소 확인이 필요합니다 — 플랫폼 운영 › 영업 수집기 설정에서 현재 주소로 바꿔 주세요' };
  // 390차: '요청 실패 (TypeError)'(연결 끊김 — LH 입찰공고)가 여기 안 걸려 '수집에 실패했습니다'로만 보였음
  if (/timeout|시간 초과|ECONN|fetch failed|요청 실패|HTTP ?5\d\d|응답하지 않|abort|socket|서울 중계/i.test(text)) return { action: 'retry', service, link: null, todo: '원천 서버가 응답하지 않았습니다 — 자동으로 다시 받습니다(이틀 넘게 계속되면 원천 주소 확인)' };
  // 390차: 공공데이터포털 결과 코드 — 10·11 = 요청 칸(날짜 형식 등)이 명세와 다름 · 01·02·04·05·99 = 원천 시스템 내부 오류 · 03 = 자료 없음
  if (/\b(10|11)\b\s*(INVALID_REQUEST_PARAMETER|NO_MANDATORY_REQUEST_PARAMETERS)|INVALID_REQUEST_PARAMETER|NO_MANDATORY_REQUEST_PARAMETERS/i.test(text)) return { action: 'check', service, link: null, todo: '원천이 요청 형식(날짜 등 입력 칸)을 받지 않았습니다 — 원천 명세가 바뀐 것 같아 수집기를 손봐야 합니다(클라우드 요청)' };
  if (/APPLICATION_ERROR|DB_ERROR|HTTP_ERROR|SERVICETIME_OUT|UNKNOWN_ERROR|(?:응답 오류|결과코드) \(?(?:HTTP \d+\)?:? )?(0[1245]|99)\b/i.test(text)) return { action: 'retry', service, link: null, todo: '원천 시스템 내부 오류 응답입니다 — 원천 쪽 장애라 다음 수집 때 다시 받습니다(이틀 넘게 계속되면 클라우드 요청)' };
  if (/NODATA_ERROR/i.test(text)) return { action: 'check', service, link: null, todo: '원천이 받을 자료가 없다고 답했습니다 — 조회 기간·조건이 맞는지 수집기를 확인해야 합니다(클라우드 요청)' };
  if (/응답 모양이 다름|non-json|결과코드|칸 이름|XML|JSON/i.test(text)) return { action: 'check', service, link: null, todo: '원천 응답 형식이 바뀐 것 같습니다 — 실행 기록의 원문을 보고 수집기를 손봐야 합니다(클라우드 요청)' };
  return { action: 'check', service, link: null, todo: '수집에 실패했습니다 — ‘자세히’의 원인을 보고 [지금 수집]으로 다시 받아 보세요' };
}
