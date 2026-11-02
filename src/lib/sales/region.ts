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
const CITY_RE = new RegExp(`(?<![가-힣])(${Object.keys(CITY).join('|')})(?:시|군)`);
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

/** 글(발주처·수요기관·주소·제목)에서 시도 짧은 이름 — '서울특별시청'·'경기도 화성시'·'삼척시'·'[경기용인] …' → 서울·경기·강원·경기. 못 찾으면 null('경기장' 같은 낱말은 시도로 보지 않음) */
export function sidoIn(...texts: (string | null | undefined)[]): string | null {
  for (const raw of texts) {
    const s = String(raw ?? '').trim(); if (!s) continue;
    for (const [long, short] of Object.entries(SIDO_ALIASES)) if (s.includes(long)) return short;
    const b = s.match(BRACKET_RE); if (b) return b[1];
    const m = s.match(SHORT_RE); if (m) return m[1];
    const c = s.match(CITY_RE); if (c) return CITY[c[1]];
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
