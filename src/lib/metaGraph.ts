// 로컬 10/23 #494 A: Meta(페이스북·인스타) Graph·Marketing API 버전은 여기 한곳에서 바꾼다.
// v21.0 은 Marketing API 기준 2025-09-09 만료(만료 버전의 광고 쓰기는 #2635) → v26.0(2026-07-29).
// 우리가 쓰는 호출(성과 insights·광고 계정·OAuth·IG/FB 게시·리드)은 v26 의 깨지는 변경(커머스 주문·배달 추정 칸·권리 관리자·Explore/메신저 스토리 지면)과 무관
export const META_GRAPH_VERSION = 'v26.0';
const T = () => process.env.ADS_TEST_BASE?.replace(/\/$/, '');
/** Graph API 기본 주소(시험은 가짜 서버 ADS_TEST_BASE) */
export const metaGraph = () => (T() ? `${T()}/graph` : `https://graph.facebook.com/${META_GRAPH_VERSION}`);
/** OAuth 동의 창 주소 */
export const metaDialog = () => (T() ? `${T()}/fbdialog` : `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
