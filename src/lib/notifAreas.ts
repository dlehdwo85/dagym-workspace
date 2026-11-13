/**
 * 394차(대표 11/13 "각 페이지별 알람이 보일 수 있도록"): 알림을 '어느 화면 알림인지'로 묶는 기준 — 알림 링크의 앞부분.
 * '/tasks/123' → '/tasks', '/calendar?event=x' → '/calendar', '/s/sales/leads?id=y' → '/s/sales/leads'. 서버(SQL)와 화면(메뉴·하단 탭·화면 위 알림 줄)이 같은 기준.
 * 서버 쪽 SQL 은 AREA_SQL_RE 를 regexp_replace 로 쓴다(같은 정규식).
 */
export const AREA_SQL_RE = '^(/s/[^/]+/[^/]+|/[^/]+).*$';
const RE = /^(\/s\/[^/]+\/[^/]+|\/[^/]+)/;
/** 링크·주소 → 화면 묶음. 홈('/')·공간 첫 화면('/s', '/s/sales')은 묶음이 아님(null) */
export function areaOf(href: string | null | undefined): string | null {
  const p = String(href ?? '').split(/[?#]/)[0];
  const a = p.match(RE)?.[1] ?? null;
  return !a || a === '/s' || /^\/s\/[^/]+$/.test(a) ? null : a;
}
/** 화면 이름(알림 화면 칩·화면 위 알림 줄) — 없으면 '이 화면' */
export const AREA_LABEL: Record<string, string> = {
  '/tasks': '업무', '/calendar': '캘린더', '/approvals': '결재', '/projects': '프로젝트', '/reports': '보고', '/library': '자료실', '/revenue': '매출', '/quotes': '견적',
  '/notices': '공지', '/admin': '관리', '/platform': '플랫폼 운영', '/settings': '설정', '/meet': '회의', '/mail': '메일', '/assistant': 'AI 비서', '/help': '도움말',
  '/s/sales/hub': '영업기회', '/s/sales/leads': '영업 진행', '/s/sales/deals': '제안·계약', '/s/sales/support': '지원사업', '/s/sales/sources': '영업 수집',
  '/s/marketing/approvals': '마케팅 승인함', '/s/marketing/ops': '마케팅 운영', '/s/marketing/ad-ops': '광고 운영', '/s/marketing/automation': '마케팅 자동화',
  '/s/marketing/materials': '마케팅 자료', '/s/marketing/goals': '마케팅 목표', '/s/marketing/report': '마케팅 보고', '/s/marketing/ads': '광고',
};
export const areaLabel = (a: string) => AREA_LABEL[a] ?? '이 화면';
/** 주소 검사(알림 화면 ?area=) — 영문·숫자·/·-·_ 만 */
export const AREA_OK = /^\/[A-Za-z0-9/_-]{1,80}$/;
