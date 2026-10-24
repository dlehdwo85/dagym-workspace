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
/** 네이버 새 지역 타겟팅(기준 방식 criterion RL)의 이름 → 시·도 짧은 이름(서울특별시 → 서울). 시·도가 아니면(시·군·구 등) 그대로 */
const SIDO_FULL: Record<string, string> = { 서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종',
  경기도: '경기', 강원도: '강원', 강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주' };
export const sidoShort = (name: string) => SIDO_FULL[name.trim()] ?? name.trim();
/** ['15'] → '충남', null·전체 → '전국' */
export const regionLabel = (codes: string[] | null | undefined) => (!codes?.length || NAVER_REGION_CODES.every((c) => codes.includes(c)) ? '전국' : codes.map((c) => NAME.get(c) ?? c).join('·'));
