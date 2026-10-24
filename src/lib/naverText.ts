/**
 * 네이버 검색광고 글자 규칙(서버 adOps · 화면 AdOps 공통) — 실계정에서 막힌 것
 * - 소재 허용 문자: 운영 10/19 가운뎃점 '·' 으로 400 code 1030 → #499-2 후속(d) 저장할 때 쉼표로 바꿈
 * - 캠페인·광고그룹 이름 1~30자: 운영 10/24 그룹 이름(세팅안 이름 + ' 그룹')이 30자를 넘어 400 code 3711 → #499-2 후속(a) 줄여서 만듦
 */
export const NAVER_OK = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 .,!?%&()+\-/:'"~@#*\[\]]$/;
export const badChars = (t: string) => [...new Set([...t].filter((c) => !NAVER_OK.test(c)))];
/** AI·사람이 자주 쓰는 문장부호를 네이버가 받는 글자로(글자 수는 그대로): 가운뎃점 → 쉼표(앞 공백 지움), 긴 줄표 → '-', 둥근 따옴표 → 곧은 따옴표 */
export const fixAdText = (s: string) => s.replace(/\s*[·ㆍ•∙・‧]/g, ',').replace(/[—–―]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

export const NAVER_NAME_MAX = 30;
const GROUP_SUFFIX = ' 그룹';
/** 네이버 이름 한도(글자 수)에 맞게 앞에서 자름 */
export const naverName = (s: string, max = NAVER_NAME_MAX) => { const c = [...s.trim()]; return c.length <= max ? c.join('') : c.slice(0, max).join('').trim(); };
/** 광고그룹 이름 = 세팅안 이름(27자까지) + ' 그룹' */
export const groupName = (s: string) => `${naverName(s, NAVER_NAME_MAX - [...GROUP_SUFFIX].length)}${GROUP_SUFFIX}`;
/** 네이버 광고 관리 화면 주소(고객 id = 연결 계정의 CUSTOMER_ID). 주소 형식은 실계정 로그인으로 확인 전 */
export const naverManageUrl = (customerId: string, kind: 'campaigns' | 'adgroups', id: string) =>
  `https://manage.searchad.naver.com/customers/${encodeURIComponent(customerId)}/${kind}/${encodeURIComponent(id)}`;
