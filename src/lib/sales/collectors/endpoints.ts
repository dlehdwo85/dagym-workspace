// 기관별 data.go.kr 호출 주소 — 기본값은 공공데이터포털 명세·실측(2026-10-21 키 없이 호출해 '등록되지 않은 키' 응답 = 주소 존재, '서비스 없음' = 주소 틀림) 기준.
// 운영에서 다르면 플랫폼 운영 › 영업 수집기 설정(app_settings 'sales_collector_endpoints')으로 바꾼다.
// #522(로컬 10/24): LH 입찰·사전규격·국방·온비드 옛 기본값은 모두 '서비스 없음'이었다 → 각 서비스 페이지 swagger 명세의 주소로(10/24 키 없이 호출해 'SERVICE_KEY_IS_NULL' = 주소 있음 확인).
//  LH 입찰 15159012 · LH 사전규격 15159011 · 방위사업청 15158416(기관 코드 1690000, 국내 물품·용역 + 시설 공사) · 온비드 차세대 15157216
import { db } from '../../db';

const T = () => process.env.SALES_COLLECT_TEST_BASE?.replace(/\/$/, '');
export const DEFAULT_ENDPOINTS: Record<string, string> = {
  lh_bid: 'https://apis.data.go.kr/B552555/OpenBidInfoList/getOpenBidInfo', lh_prespec: 'https://apis.data.go.kr/B552555/OpenAdvcinfoReqList/getOpenAdvcinfoReqList',
  d2b_bid: 'https://apis.data.go.kr/1690000/BidPblancInfoService/getDmstcCmpetBidPblancList', d2b_fclty: 'https://apis.data.go.kr/1690000/BidPblancInfoService/getFcltyCmpetBidPblancList',
  onbid_lease: 'https://apis.data.go.kr/B010003/OnbidPbancListSrvc2/getPbancList2',
  // 로컬 10/23: 누리장터 getPrvtBidNtceList* = '서비스가 없거나 폐기'(12) → 오퍼레이션 이름은 getPrvtBidPblancListInfo*(공고명 검색 = PPSSrch). 10/23 키 없이 호출해 '등록되지 않은 키'(30) = 주소 있음 확인
  nuri_bid_servc: 'https://apis.data.go.kr/1230000/ao/PrvtBidNtceService/getPrvtBidPblancListInfoServcPPSSrch', nuri_bid_thng: 'https://apis.data.go.kr/1230000/ao/PrvtBidNtceService/getPrvtBidPblancListInfoThngPPSSrch',
  // #450 지원사업 — 기업마당 지원사업정보 API(인증키 crtfcKey) · K-Startup 사업공고(창업진흥원, data.go.kr)
  bizinfo_support: 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do', bizinfo_datago_support: 'https://apis.data.go.kr/1421000/bizinfo/pblancBsnsService',
  kstartup_support: 'https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01',
};
/** 폐기된 주소(예전 기본값) — 설정에 그대로 남아 있어도 무시하고 새 기본값을 씀(#522: 옛 LH·국방·온비드 주소 포함) */
const DEAD = /PrvtBidNtceService\/getPrvtBidNtceList|lhBidInfo\/|lhPreStdInfo\/|\/1290000\/cmpetBidInfoService|OnbidRentalService/;
export const ENDPOINT_LABEL: Record<string, string> = { lh_bid: 'LH 입찰공고', lh_prespec: 'LH 사전규격', d2b_bid: '방위사업청 입찰(국내 물품·용역)', d2b_fclty: '방위사업청 입찰(시설 공사·용역)', onbid_lease: '온비드 공고(차세대)', nuri_bid_servc: '누리장터 민간입찰 용역', nuri_bid_thng: '누리장터 민간입찰 물품', bizinfo_support: '지원사업 · 기업마당', bizinfo_datago_support: '지원사업 · 기업마당(공공데이터포털)', kstartup_support: '지원사업 · K-Startup' };
/** 시험 모드: 기관은 `${T}/agency/<key>`, 누리장터는 `${T}/g2b/ao/PrvtBidNtceService/...` (가짜 원천 경로 그대로) */
export async function endpoints(): Promise<Record<string, string>> {
  if (T()) return Object.fromEntries(Object.keys(DEFAULT_ENDPOINTS).map((k) => [k, k.startsWith('nuri_') ? DEFAULT_ENDPOINTS[k].replace('https://apis.data.go.kr/1230000', `${T()}/g2b`) : `${T()}/agency/${k}`]));
  const [s] = await db()<{ value: Record<string, string> }[]>`select value from app_settings where key = 'sales_collector_endpoints'`;
  return { ...DEFAULT_ENDPOINTS, ...Object.fromEntries(Object.entries(s?.value ?? {}).filter(([, v]) => !DEAD.test(String(v)))) };
}
