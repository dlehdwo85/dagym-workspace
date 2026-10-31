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
  if (/LIMITED_NUMBER|호출 ?(제한|한도)|한도 초과|\b429\b/i.test(text)) return { action: 'limit', service, link, todo: '오늘 호출 한도를 넘었습니다 — 내일 다시 받습니다(계속되면 포털에서 트래픽 증가 신청)' };
  if (/키 없음|키가 없|KEY\S* 미설정/.test(text)) return { action: 'key', service, link, todo: '인증키가 없습니다 — 플랫폼 운영 › 영업 수집기 설정에서 키를 넣어 주세요' };
  if (/활용신청|인증키 확인|SERVICE_KEY_IS_NOT_REGISTERED|SERVICE ACCESS DENIED|등록되지 않은 (서비스|인증)키|UNREGISTERED|NOT_REGISTERED|FORBIDDEN|EXPIRED/i.test(text)) return { action: 'apply', service, link, todo: `공공데이터포털 활용신청${service ? `(서비스 ${service})` : ''}이 필요합니다` };
  if (/주소 확인 필요|\b404\b|주소가 바뀌/.test(text)) return { action: 'url', service, link: null, todo: '원천 주소 확인이 필요합니다 — 플랫폼 운영 › 영업 수집기 설정에서 현재 주소로 바꿔 주세요' };
  if (/timeout|시간 초과|ECONN|fetch failed|HTTP ?5\d\d|응답하지 않|abort|socket/i.test(text)) return { action: 'retry', service, link: null, todo: '원천 서버가 응답하지 않았습니다 — 다음 수집 때 다시 받습니다(계속되면 원천 주소 확인)' };
  if (/응답 모양이 다름|non-json|결과코드|칸 이름|XML|JSON/i.test(text)) return { action: 'check', service, link: null, todo: '원천 응답 형식이 바뀐 것 같습니다 — 실행 기록의 원문을 보고 수집기를 손봐야 합니다(클라우드 요청)' };
  return { action: 'check', service, link: null, todo: '수집에 실패했습니다 — ‘자세히’의 원인을 보고 [지금 수집]으로 다시 받아 보세요' };
}
