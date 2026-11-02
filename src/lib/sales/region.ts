// #510(로컬 10/23): 나라장터 공고 대부분이 '지역 -' — 참가가능지역이 비면 발주처·수요기관 이름(시·도, 시·군)에서 시도를 찾는다
import { SIDO_ALIASES } from './collectors/prospects';

const SHORT = '서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주';
/** 시·군 → 시도. 두 시도에 같은 이름이 있는 고성(강원·경남)·광주시(경기)·광주광역시는 넣지 않음 */
const CITY: Record<string, string> = Object.fromEntries(Object.entries({
  경기: '수원 성남 의정부 안양 부천 광명 평택 동두천 안산 고양 과천 구리 남양주 오산 시흥 군포 의왕 하남 용인 파주 이천 안성 김포 화성 양주 포천 여주 연천 가평 양평',
  강원: '춘천 원주 강릉 동해 태백 속초 삼척 홍천 횡성 영월 평창 정선 철원 화천 양구 인제 양양',
  충북: '청주 충주 제천 보은 옥천 영동 증평 진천 괴산 음성 단양',
  충남: '천안 공주 보령 아산 서산 논산 계룡 당진 금산 부여 서천 청양 홍성 예산 태안',
  전북: '전주 군산 익산 정읍 남원 김제 완주 진안 무주 장수 임실 순창 고창 부안',
  전남: '목포 여수 순천 나주 광양 담양 곡성 구례 고흥 보성 화순 장흥 강진 해남 영암 무안 함평 영광 장성 완도 진도 신안',
  경북: '포항 경주 김천 안동 구미 영주 영천 상주 문경 경산 의성 청송 영양 영덕 청도 고령 성주 칠곡 예천 봉화 울진 울릉',
  경남: '창원 진주 통영 사천 김해 밀양 거제 양산 의령 함안 창녕 남해 하동 산청 함양 거창 합천',
  제주: '서귀포', 대구: '군위', 인천: '강화 옹진', 부산: '기장', 울산: '울주',
}).flatMap(([sido, names]) => names.split(' ').map((n) => [n, sido])));
const SHORT_RE = new RegExp(`(?<![가-힣])(${SHORT})(?:특별시|광역시|특별자치시|특별자치도|시|도)?(?![가-힣])`);
// 340차(로컬 11/02 #924 후속: 진행 중 공고의 19% 가 '지역 미정'): '김해시영운국민체육센터'처럼 시·군 뒤에 글자가 바로 이어지는 기관 이름도 잡는다(접미 조건 없음 — 시·군 글자가 닻)
// 341차: '시설'로 이어지는 꼴은 뺌('강화시설 보수' → 강화시 오탐) — 안양시설관리공단 같은 기관은 아래 CITY_ORG_RE 가 잡음
const CITY_RE = new RegExp(`(?<![가-힣])(${Object.keys(CITY).join('|')})(?:시(?!설)|군)`);
/** 340차: 특별시·광역시·큰 시의 구 이름 → 시도. 두 곳 이상에 있는 중·동·서·남·북·강서(서울·부산)는 넣지 않음 */
const GU: Record<string, string> = Object.fromEntries(Object.entries({
  서울: '종로 용산 성동 광진 동대문 중랑 성북 강북 도봉 노원 은평 서대문 마포 양천 구로 금천 영등포 동작 관악 서초 강남 송파 강동',
  부산: '해운대 사하 금정 연제 수영 사상 영도 부산진 동래', 대구: '수성 달서', 인천: '미추홀 연수 남동 부평 계양', 광주: '광산', 대전: '유성 대덕',
  경기: '분당 수정 중원 권선 팔달 영통 장안 일산동 일산서 덕양 상록 단원 동안 만안 처인 기흥 수지 오정 원미 소사', 경남: '의창 성산 마산합포 마산회원 진해',
  충북: '상당 서원 흥덕 청원', 충남: '동남 서북', 전북: '완산 덕진',
}).flatMap(([sido, names]) => names.split(' ').map((n) => [n, sido])));
// 구 뒤는 기관 이름에서 흔한 이어짐(청·의회·립·민·시설관리공단…)이나 글자 끝만 — '수영구역'·'수정구매'·'남동구간' 같은 보통 낱말은 안 잡음
const GU_RE = new RegExp(`(?<![가-힣])(${Object.keys(GU).join('|')})구(?:청|의회|립|민|시설|도시|체육|문화|서비스|보건|공단|공사|재단|센터|종합|국민|여성|청소년|노인|장애인|평생|건강|복지|자원|도서관|생활|가족|육아|진흥|[^가-힣]|$)`);
const BRACKET_RE = new RegExp(`^\\s*\\[(${SHORT})`);
// 341차(로컬 11/02 340차 운영 확인: 지역 미정 10건 발주처): 시·도 이름 뒤에 기관 글자가 바로 이어지는 꼴('경기주택도시공사'·'서울대학교'·'부산지방해양수산청'·'전남테크노파크')
// — '경기장'·'부산물' 같은 보통 낱말을 막던 '뒤 글자 없음' 조건은 두고, 기관에서 흔한 이어짐 낱말일 때만 허용
const ORG = '주택도시공사|도시공사|도시개발공사|도시관리공사|개발공사|관광공사|교통공사|에너지공사|환경공단|시설공단|시설관리공단|도시관리공단|항만공사|공항공사|농수산물공사|공사|공단|교육청|교육지원청|경찰청|자치경찰|소방본부|소방서|소방학교|테크노파크|신용보증재단|문화재단|관광재단|복지재단|장학재단|일자리재단|체육회|장애인체육회|의료원|연구원|진흥원|대학교|대학|올림픽|지방|광역|지역본부|남부|북부|동부|서부|중부|본부|지사|지청|사무소|협회|조합|은행|랜드|국제공항|농업기술원|농업기술센터|보건환경연구원|평생교육진흥원|문화예술|여성가족|인재개발원|경제진흥원|산업진흥원|콘텐츠진흥원|디자인진흥원|사회서비스원|상공회의소|국가산업단지|산업단지|산단|시민|도민|교육|주택|도시|경제|산업|환경|해양|수산|산림|정보|과학|신용|디지털|에너지|교통|문화|예술|복지|체육|관광|의료|병원|법원|검찰|세관|우체국|교정|재단|센터';
const SHORT_ORG_RE = new RegExp(`(?<![가-힣])(${SHORT})(?:특별시|광역시|특별자치시|특별자치도|시|도)?(?:${ORG})`);
// 시·군 글자 없이 도시 이름+기관('청주도시공사'·'천안시설관리공단') — 예산·음성·구리처럼 보통 낱말과 같은 이름이 있어 기관 낱말을 더 좁게
const ORG_CITY = '주택도시공사|도시공사|도시개발공사|도시관리공사|개발공사|관광공사|시설공단|시설관리공단|도시관리공단|환경공단|농수산물공사|공사|공단|교육청|교육지원청|문화재단|관광재단|복지재단|장학재단|체육회|장애인체육회|의료원|테크노파크|농업기술센터|보건소|상공회의소|시민|군민|문화원|국가산업단지|산업단지|산단|대학교|문화체육|체육|관광|도시'; // '시설' 단독은 넣지 않음('강화시설 보수' → 인천 오탐)
const CITY_ORG_RE = new RegExp(`(?<![가-힣])(${Object.keys(CITY).join('|')})(?:${ORG_CITY})`);
// 도시 이름 + (몇 글자) + 체육 시설('천안상록골프장'·'구미낙동강체육공원') — 시설 낱말이 뒤에 있을 때만
const CITY_FAC_RE = new RegExp(`(?<![가-힣])(${Object.keys(CITY).join('|')})[가-힣]{0,4}(?:골프장|컨트리클럽|국민체육센터|문화체육센터|체육센터|스포츠센터|종합운동장|공설운동장|운동장|체육관|체육공원|실내수영장|수영장|스포츠파크|스포츠타운|빙상장|아이스링크|야구장|축구장|테니스장|캠핑장|휴양림)`);
/** 이름에 지역이 없는 대학·기관 → 소재 시도(연세대학교 → 서울). 전국 단위 공공기관(공무원연금공단·LH 등)은 본사로 묶지 않음 — 제목·주소의 실제 장소가 우선이어야 하므로 */
const ORG_SIDO: Record<string, string> = Object.fromEntries(Object.entries({
  서울: '연세대학교 고려대학교 한양대학교 성균관대학교 중앙대학교 경희대학교 서강대학교 이화여자대학교 건국대학교 동국대학교 홍익대학교 숙명여자대학교 국민대학교 세종대학교 한국외국어대학교 숭실대학교 광운대학교 상명대학교 덕성여자대학교 성신여자대학교 세종문화회관 예술의전당 국립중앙박물관 국립중앙도서관',
  경기: '아주대학교 단국대학교 가천대학교 한국항공대학교 경기대학교 명지대학교 한신대학교', 인천: '인하대학교 경인교육대학교', 대전: '한국과학기술원 카이스트 KAIST 충남대학교 한밭대학교 목원대학교 배재대학교',
  대구: '경북대학교 계명대학교 대구가톨릭대학교', 광주: '전남대학교 조선대학교 광주과학기술원 호남대학교', 부산: '동아대학교 한국해양대학교 부경대학교 동의대학교 경성대학교', 울산: '울산과학기술원',
  경북: '포항공과대학교 포스텍 영남대학교 금오공과대학교 안동대학교 대구대학교 대구한의대학교', 경남: '경상국립대학교 창원대학교 인제대학교', 전북: '원광대학교 우석대학교 전주대학교', 전남: '목포대학교 순천대학교 동신대학교',
  충북: '한국교통대학교 한국교원대학교 청주대학교 서원대학교 세명대학교', 충남: '공주대학교 순천향대학교 호서대학교 선문대학교 남서울대학교 백석대학교 나사렛대학교 한서대학교',
}).flatMap(([sido, names]) => names.split(' ').map((n) => [n, sido])));
const LEGAL_PREFIX_RE = /재단법인|사단법인|학교법인|의료법인|사회복지법인|주식회사|유한회사|농업회사법인|\((재|사|주|유)\)/g;

/** 글(발주처·수요기관·주소·제목)에서 시도 짧은 이름 — '서울특별시청'·'경기도 화성시'·'삼척시'·'[경기용인] …' → 서울·경기·강원·경기. 못 찾으면 null('경기장' 같은 낱말은 시도로 보지 않음) */
export function sidoIn(...texts: (string | null | undefined)[]): string | null {
  for (const raw of texts) {
    const s = String(raw ?? '').replace(LEGAL_PREFIX_RE, ' ').trim(); if (!s) continue; // '재단법인전남테크노파크' → ' 전남테크노파크'
    for (const [long, short] of Object.entries(SIDO_ALIASES)) if (s.includes(long)) return short;
    for (const [name, sido] of Object.entries(ORG_SIDO)) if (s.includes(name)) return sido;
    const b = s.match(BRACKET_RE); if (b) return b[1];
    const m = s.match(SHORT_RE); if (m) return m[1];
    const so = s.match(SHORT_ORG_RE); if (so) return so[1];
    const c = s.match(CITY_RE); if (c) return CITY[c[1]];
    const co = s.match(CITY_ORG_RE); if (co) return CITY[co[1]];
    const cf = s.match(CITY_FAC_RE); if (cf) return CITY[cf[1]];
    const g = s.match(GU_RE); if (g) return GU[g[1]];
  }
  return null;
}

/** #530(로컬 10/24 ④): 참가 제한 지역 → 본사 기준 참가 가능 여부. 글 = '서울특별시' · '경기도, 인천광역시' · '경상남도 김해시' 같은 시·도(와 시·군·구) 목록.
 * 비었거나 '전국'·'제한 없음'이면 null(제한 없음) · ok = 참가 가능 true / 불가 false / 판단 못 함 null(본사를 모르거나 시·군까지 제한인데 본사 시·군을 모름) */
export type RegionLimit = { label: string; ok: boolean | null };
export function regionLimit(limit: unknown, hq: { sido: string | null; sigungu: string | null } | null): RegionLimit | null {
  const s = String(limit ?? '').replace(/\s+/g, ' ').trim();
  if (!s || s === '-' || /전국|제한\s*없음/.test(s)) return null;
  const zones: { sido: string; sigungu: string | null }[] = [];
  for (const p of s.split(/\s*[,·/|]\s*|\s+및\s+/)) {
    const sg = p.split(' ').find((t) => /(시|군|구)$/.test(t) && !SIDO_ALIASES[t] && !new RegExp(`^(${SHORT})(시|도)$`).test(t)) ?? null;
    const sido = sidoIn(p) ?? (sg && zones.length ? zones[zones.length - 1].sido : null); // '서울 강남구·서초구' → 서초구도 서울
    if (sido) zones.push({ sido, sigungu: sg });
  }
  if (!zones.length) return { label: s.slice(0, 30), ok: null };
  const label = [...new Set(zones.map((z) => (z.sigungu ? `${z.sido} ${z.sigungu}` : z.sido)))].join('·');
  if (!hq?.sido) return { label, ok: null };
  const each = zones.map((z) => (z.sido !== hq.sido ? false : !z.sigungu ? true : !hq.sigungu ? null : z.sigungu === hq.sigungu));
  return { label, ok: each.includes(true) ? true : each.includes(null) ? null : false };
}
