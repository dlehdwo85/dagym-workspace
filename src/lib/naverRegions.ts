/**
 * 네이버 검색광고 지역 타겟팅(REGIONAL_TARGET, location.KR) 시·도 코드 — 공식 문서(naver/searchad-apidoc 'target' 형식) 기준.
 * 시·군·구·동 단위 코드는 공개 문서에 없어 쓰지 않는다(네이버 화면에서 세부 지역을 정한 광고그룹은 워크인이 바꾸지 않음).
 * 서버·화면 공용(서버 전용 import 없음). 순서 = 화면 표시 순서.
 */
export const NAVER_REGIONS: [string, string][] = [['09', '서울'], ['02', '경기'], ['11', '인천'], ['01', '강원'], ['15', '충남'], ['16', '충북'], ['07', '대전'], ['17', '세종'],
  ['04', '경북'], ['03', '경남'], ['06', '대구'], ['08', '부산'], ['10', '울산'], ['13', '전북'], ['12', '전남'], ['05', '광주'], ['14', '제주']];
export const NAVER_REGION_CODES = NAVER_REGIONS.map(([c]) => c);
export const REGION_RE = /^(0[1-9]|1[0-7])$/;
const NAME = new Map(NAVER_REGIONS);
/** ['15'] → '충남', null·전체 → '전국' */
export const regionLabel = (codes: string[] | null | undefined) => (!codes?.length || NAVER_REGION_CODES.every((c) => codes.includes(c)) ? '전국' : codes.map((c) => NAME.get(c) ?? c).join('·'));
