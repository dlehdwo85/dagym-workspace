/**
 * 320차(대표 11/01 23:3x 지적 — 다짐 11/3 피드 「사우나랑 독서실도 맡길 수 있나요?」 표지·4분할이 헬스장·GX룸 사진):
 * 글 제목·표지 첫 줄에 특정 시설 이름이 있으면 표지·4분할·카드 장·블로그·영상 사진은 그 시설 사진만 쓴다.
 * 맞는 사진이 없으면 다른 시설 사진으로 채우지 않음 → 표지는 단색으로 봐서 보류(수정 요청) + 그 시설 자료 요청.
 * 비슷한 말은 같은 시설로 묶음(독서실·열람실·스터디룸·스터디카페 / 사우나·목욕탕·찜질 …). 헬스장·웨이트는 기본 시설, 요가·필라테스·스피닝은 수업 이름이라 묶음에 없음(제한 안 함)
 */
export type Facility = { key: string; label: string; re: RegExp };

export const FACILITIES: Facility[] = [
  { key: 'sauna', label: '사우나', re: /사우나|목욕탕|목욕|찜질|대중탕|온탕|냉탕|열탕|반신욕/ },
  { key: 'study', label: '독서실', re: /독서실|열람실|스터디\s?룸|스터디\s?카페|자습실|공부방/ },
  { key: 'golf', label: '골프', re: /골프|퍼팅|드라이빙\s?레인지/ },
  { key: 'pool', label: '수영장', re: /수영장|수영|풀장|아쿠아로빅/ },
  { key: 'kids', label: '키즈', re: /키즈|어린이\s?(놀이|체육|공간|카페)|놀이방|유아\s?(놀이|체육)/ },
  // 323차(로컬 11/02 ②: 하이링크 '헬스장 출입' 글에 카페 사진): 글에 없는 '다른 시설' 사진을 빼는 데도 씀 — 카페·주차장 추가(키오스크는 하이링크 제품이라 시설로 안 봄)
  { key: 'cafe', label: '카페', re: /카페(?!테리아)|카페테리아|커피\s?(숍|샵|코너)|매점|베이커리/ },
  { key: 'parking', label: '주차장', re: /주차장|주차\s?(공간|타워|구역)/ },
  // GX 는 시설(GX룸)만 — 요가·필라테스·스피닝 같은 수업 이름은 시설이 아니라 제한하지 않음(헬스장 글 제목에 흔해 오탐이 큼)
  { key: 'gx', label: 'GX', re: /(^|[^A-Za-z])G\.?X(?![A-Za-z])|지엑스|그룹\s?(운동|엑서사이즈)\s?(룸|실|공간)|단체\s?운동\s?(룸|실|공간)/i },
];

/** 글(제목·표지 첫 줄)에 나온 시설 묶음 */
export const facilitiesIn = (text: string): Facility[] => FACILITIES.filter((f) => f.re.test(text));
/** 사진 쪽 글(이름·폴더·태그·설명·AI 설명·원본 영상)이 그 시설 중 하나에 맞는지 — 시설이 없으면 제한 없음 */
export const facilityMatch = (photoText: string, fac: Facility[]) => !fac.length || fac.some((f) => f.re.test(photoText));
export const facilityLabels = (fac: Facility[]) => fac.map((f) => f.label);
/** 323차: 사진 쪽 '강한' 글(이름·태그·한 줄 설명·폴더·원본 영상 이름)에 글에 없는 다른 시설이 있으면 그 시설 — 대표가 지적한 '문구와 관련 없는 사진'(헬스장 출입 글에 카페 사진).
 *  장면 설명(2~3문장)은 지나가는 말이 많아 안 봄. present = 글(제목·본문)에 나온 시설 */
export const facilityForeign = (strongText: string, present: Facility[]): Facility | null => FACILITIES.find((f) => !present.includes(f) && f.re.test(strongText)) ?? null;
