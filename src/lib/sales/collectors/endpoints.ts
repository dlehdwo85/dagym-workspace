// 기관별 data.go.kr 호출 주소 — 기본값은 공공데이터포털 명세·실측(2026-10-21 키 없이 호출해 '등록되지 않은 키' 응답 = 주소 존재, '서비스 없음' = 주소 틀림) 기준.
// 운영에서 다르면 플랫폼 운영 › 영업 수집기 설정(app_settings 'sales_collector_endpoints')으로 바꾼다. LH 입찰·사전규격·국방·온비드·누리장터는 아직 확인된 주소가 없어 '주소 확인 필요'로 남는다.
import { db } from '../../db';

const T = () => process.env.SALES_COLLECT_TEST_BASE?.replace(/\/$/, '');
export const DEFAULT_ENDPOINTS: Record<string, string> = {
  lh_bid: 'https://apis.data.go.kr/B552555/lhBidInfo/getBidInfoList', lh_prespec: 'https://apis.data.go.kr/B552555/lhPreStdInfo/getPreStdInfoList',
  d2b_bid: 'https://apis.data.go.kr/1290000/cmpetBidInfoService/getCmpetBidInfoList', onbid_lease: 'https://apis.data.go.kr/1360000/OnbidRentalService/getPublicRentalNoticeList',
  nuri_bid_servc: 'https://apis.data.go.kr/1230000/ao/PrvtBidNtceService/getPrvtBidNtceListServc', nuri_bid_thng: 'https://apis.data.go.kr/1230000/ao/PrvtBidNtceService/getPrvtBidNtceListThng',
  // #450 지원사업 — 기업마당 지원사업정보 API(인증키 crtfcKey) · K-Startup 사업공고(창업진흥원, data.go.kr)
  bizinfo_support: 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do', bizinfo_datago_support: 'https://apis.data.go.kr/1421000/bizinfo/pblancBsnsService',
  kstartup_support: 'https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01',
};
export const ENDPOINT_LABEL: Record<string, string> = { lh_bid: 'LH 입찰공고', lh_prespec: 'LH 사전규격', d2b_bid: '방위사업청(국방전자조달) 입찰', onbid_lease: '온비드 임대 공고', nuri_bid_servc: '누리장터 민간입찰 용역', nuri_bid_thng: '누리장터 민간입찰 물품', bizinfo_support: '지원사업 · 기업마당', bizinfo_datago_support: '지원사업 · 기업마당(공공데이터포털)', kstartup_support: '지원사업 · K-Startup' };
/** 시험 모드: 기관은 `${T}/agency/<key>`, 누리장터는 `${T}/g2b/ao/PrvtBidNtceService/...` (가짜 원천 경로 그대로) */
export async function endpoints(): Promise<Record<string, string>> {
  if (T()) return Object.fromEntries(Object.keys(DEFAULT_ENDPOINTS).map((k) => [k, k.startsWith('nuri_') ? DEFAULT_ENDPOINTS[k].replace('https://apis.data.go.kr/1230000', `${T()}/g2b`) : `${T()}/agency/${k}`]));
  const [s] = await db()<{ value: Record<string, string> }[]>`select value from app_settings where key = 'sales_collector_endpoints'`;
  return { ...DEFAULT_ENDPOINTS, ...(s?.value ?? {}) };
}
