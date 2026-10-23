// 협력사 모집 감시 규칙(순수 함수) — 수집기(vendorRecruit)·입찰 화면(srcViews)·아침 메일(digest)이 같이 씀. db·fetch 없음.

export const RECRUIT_RE = /(협력\s*(업체|회사|사)|파트너사|신규\s*업체|업체\s*등록|정기\s*등록|우수\s*협력)[^<]{0,40}(모집|등록|공개|접수|신청|안내)/;
/** #476 e: 결과 공지·종료 안내·평가 결과 글은 모집 글이 아님 */
export const RECRUIT_EXCLUDE_RE = /결과\s*(공지|공고|발표|안내)|(선정|평가|심사)\s*결과|(종료|마감)\s*(안내|공지)|모집\s*(종료|마감)|합격자/;
/** #476 후속(로컬 10/23 14:20): 페이지 조각 — 목록 기호(1) a. 가. ① · ※)로 시작하는 안내문 줄, 표 머리 '구분', 메뉴 단어(인사말·연혁·조직도·오시는 길…) */
export const FRAGMENT_RE = /^(?:\(?\d{1,2}[).](?!\d)|[a-zA-Z][.)]\s|[가나다라마바사아자차카타파하][.)]\s|[①-⑳⑴-⒇❶-❿]|[-·•※▶►▷■□○●◆◇◎★☆>+*]|구분(?:\s|$))|인사말|연혁|조직도|오시는\s*길|찾아오시는|사이트\s*맵|개인정보\s*처리|이용\s*약관/;
const GENERIC_RE = /신청서|신청|재등록|등록|협력|파트너|업체|회사|신규|정기|우수|안내|지원|모집|접수|공개|공고|다운로드|내려받기|양식|서식|바로\s*가기|하기|온라인|시스템|포털|센터|페이지|방법|절차|및|공지|알림|사|[\s()[\]·/,.\-~:]/g;
/** 고정 링크('협력업체등록'·'협력업체 등록신청서 다운로드'·'협력회사 신규 등록지원'처럼 일반 단어뿐인 제목) — 연도·회사명·내용 단어가 있으면 글 */
export const isGenericLink = (t: string) => t.replace(/^\[[^\]]*\]\s*/, '').replace(GENERIC_RE, '') === '';
/** 안내 페이지(게시판이 아닌 고정 페이지)에서 처음 보는 줄이 생겼을 때 넣는 1줄의 notice_state */
export const PAGE_CHANGED = '안내 페이지 바뀜';
/** 화면·메일이 믿는 협력사 게시일: 이 수집기가 게시판 날짜로 확인한 줄(posted_checked)·안내 페이지 바뀜 줄만.
 * 예전 방식(10/21~10/23 오전)·원본 복사 줄의 posted_date 는 수집한 날이라 믿지 않음 → 공고일 비움·오늘 탭·메일 밖 */
export const vendorDateOk = (r: { posted_checked?: unknown; notice_state?: unknown } | null | undefined) => r?.posted_checked === true || r?.notice_state === PAGE_CHANGED;

/** 게시판 줄 글자에서 제목만: 앞 번호·[공지] · 뒤 조회수·Hit·추천·작성자·날짜·새 글 표시를 지움 */
export function cleanRecruitTitle(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim(); let prev = '';
  while (t !== prev) {
    prev = t;
    t = t.replace(/^(?!(?:19|20)\d{2}\s)\d{1,6}\s+/, '').replace(/^\[?\s*(?:공지|알림|필독|NEW|new)\s*\]?\s+/, '')
      .replace(/\s+(?:(?:(?:조회수?|Hit|HIT|hit|추천)\s*[:：]?\s*)+[\d,]+|(?:작성자|글쓴이|등록일|작성일|첨부파일)(?=[\s:：]|$)).*$/, '')
      .replace(/\s+(?:관리자|운영자|담당자|admin|Admin|ADMIN)\s*$/, '')
      .replace(/\s+(?:20\d{2}|\d{2})[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}\.?\s*$/, '').replace(/\s+\d{1,2}[.\-/]\d{1,2}\s*$/, '')
      .replace(/\s+[\d,]+\s*$/, '').replace(/(?:\s+\[?|\s*\[)(?:N|NEW|new|새\s*글)\]?\s*$/, '').trim();
  }
  return t;
}
const ymdOk = (y: number, m: number, d: number) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; };
/** 게시일: 2026.10.20 · 26.10.20 · 10-20(올해, 미래면 작년 — short=false 면 안 읽음). 오늘 뒤 날짜는 버림. 'first' = 처음 나온 날짜, 'max' = 가장 늦은 날짜 */
export function postedDateOf(text: string, today: string, mode: 'first' | 'max' = 'max', short = true): string | null {
  const ds: string[] = []; const year = Number(today.slice(0, 4));
  for (const m of text.matchAll(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g)) { const d = ymdOk(+m[1], +m[2], +m[3]); if (d) ds.push(d); }
  if (!ds.length) for (const m of text.matchAll(/(?<![\d.])(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(?![\d])/g)) { const d = ymdOk(2000 + +m[1], +m[2], +m[3]); if (d) ds.push(d); }
  if (!ds.length && short) for (const m of text.matchAll(/(?<![\d.:])(\d{1,2})[.\-/](\d{1,2})(?![\d.:])/g)) { const d = ymdOk(year, +m[1], +m[2]); const d2 = d && d > today ? ymdOk(year - 1, +m[1], +m[2]) : d; if (d2) ds.push(d2); }
  const ok = ds.filter((d) => d <= today);
  return !ok.length ? null : mode === 'first' ? ok[0] : ok.sort().at(-1)!;
}
