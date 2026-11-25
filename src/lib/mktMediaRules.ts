/** #1181-2(대표 11/26 '4건이 아니라 3건으로 보였다'): 시안 승인 규칙 — 서버(승인·현황)와 화면(승인함 카드·목록)이 같은 규칙을 쓰게 한 곳에 둠.
 *  이 파일은 화면에서도 불러 쓰므로 서버 모듈(db 등)을 불러오지 않는다. */

/** 글만으로 승인할 수 있는 채널 — 스레드(사진은 선택) · 기타(파워링크·검색 광고 문구·문자처럼 그림이 필요 없는 글). 인스타·페북 광고형은 그림이 있어야 하므로 그대로 */
export const TEXT_OK_CHANNELS = ['threads', 'other'] as const;
export const textOk = (channel: string | null | undefined) => (TEXT_OK_CHANNELS as readonly string[]).includes(String(channel ?? ''));

/** 사진 수 규칙(marketing.ts mediaRule 이 씀) */
export const BLOG_PHOTO_RULE = '블로그는 표지 1장 + 본문 사진 1장 이상을 붙여야 승인 요청됩니다';
export const BLOG_AUTO_RULE = '블로그는 표지 1장 + 본문 사진 3장 이상(실사 또는 도표형 카드)이 붙어야 승인 요청됩니다';
export const FEED_PAGE_RULE = '피드는 카드뉴스 3~5장(표지 포함)이 붙어야 승인 요청됩니다';
export const STORY_FRAME_RULE = '스토리는 3~5프레임이 붙어야 승인 요청됩니다';
export const MEDIA_RULES = [BLOG_PHOTO_RULE, BLOG_AUTO_RULE, FEED_PAGE_RULE, STORY_FRAME_RULE];
/** 295차 #835: 표지가 단색 바탕 + 글자뿐 */
export const PLAIN_ISSUE = '표지가 단색 바탕 + 글자뿐 — 사진·화면·도표가 든 표지로 바꾼 뒤 승인함에 올립니다(같은 브랜드 실사 참고 생성 또는 자료 요청)';
/** 자동 제작에서 시안 이미지가 아직 없을 때의 사유(mktAuto) */
export const VISUAL_ISSUE_IMAGE = '시안 이미지 없음 — 승인함에서 [지금 만들기]';

/** 수정 요청 칸에 있지만 '사진·시안만 붙이면 승인 대기로 올라가는' 글 — 승인함 위쪽 '사진 필요 n건' 줄 */
export function photoNeeded(c: { status: string; channel?: string | null; quality?: { issues?: unknown } | null }) {
  if (c.status !== 'changes') return false;
  const issues = Array.isArray(c.quality?.issues) ? (c.quality!.issues as unknown[]).map(String) : [];
  return issues.some((x) => MEDIA_RULES.includes(x) || x === PLAIN_ISSUE || x === VISUAL_ISSUE_IMAGE);
}
/** 사진 필요 사유를 짧게(카드 한 줄) */
export function photoNeedLabel(c: { quality?: { issues?: unknown } | null }) {
  const issues = Array.isArray(c.quality?.issues) ? (c.quality!.issues as unknown[]).map(String) : [];
  const x = issues.find((i) => MEDIA_RULES.includes(i) || i === PLAIN_ISSUE || i === VISUAL_ISSUE_IMAGE);
  if (!x) return '';
  if (x === PLAIN_ISSUE) return '표지 사진 필요(단색 바탕 + 글자뿐)';
  if (x === VISUAL_ISSUE_IMAGE) return '시안 이미지 필요';
  return x.replace(/이 붙어야 승인 요청됩니다$|을 붙여야 승인 요청됩니다$/, ' 필요');
}
