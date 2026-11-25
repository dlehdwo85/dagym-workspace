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

/** #1171 공간 전환 숫자 = 그 공간 사이드바 숫자들의 합(서버 navCounts.ts·화면 AppShell 이 같은 기준 — 이 파일은 화면에서도 씀) */
export type SpaceKey = 'work' | 'sales' | 'marketing';
/** 설정 경고·정보성 알림 화면 — 숫자 대신 빨간 점, 공간 숫자에 넣지 않음(#1171 영업 데이터 설정 · #1173 마케팅 연결 계정(잔액·토큰) · 광고 집행·광고 성과(성과 보고·상한·자동 정지 알림)) */
export const DOT_AREAS = new Set(['/s/sales/sources', '/s/marketing/connections', '/s/marketing/ad-ops', '/s/marketing/ads']);
export const HUB_AREA = '/s/sales/hub';
/** 공간별 사이드바 메뉴 화면(홈·공통 메뉴 제외 — 공통(캘린더·알림·메시지·자료실 등)은 어느 공간에서나 보여 공간 숫자에 넣지 않음) */
export const MENU_AREAS: Record<SpaceKey, string[]> = {
  work: ['/tasks', '/projects', '/reports', '/approvals', '/revenue'],
  sales: ['/s/sales/hub', '/s/sales/leads', '/s/sales/deals', '/s/sales/support', '/s/sales/sources'],
  marketing: ['/s/marketing/goals', '/s/marketing/ops', '/s/marketing/team', '/s/marketing/approvals', '/s/marketing/automation', '/s/marketing/materials', '/s/marketing/calendar',
    '/s/marketing/connections', '/s/marketing/ads', '/s/marketing/ad-ops', '/s/marketing/report', '/s/marketing/sites', '/s/marketing/calls', '/s/marketing/history'],
};
/** 공간 전환 칸 설명(마우스 올리기·공간 시트)에 쓰는 메뉴 이름 — 사이드바 이름과 같게 */
export const MENU_LABEL: Record<string, string> = {
  '/tasks': '업무', '/projects': '프로젝트', '/reports': '보고', '/approvals': '결재', '/revenue': '매출',
  '/s/sales/hub': '영업 기회 허브', '/s/sales/leads': '영업 진행', '/s/sales/deals': '제안·계약', '/s/sales/support': '지원사업', '/s/sales/sources': '데이터 설정',
  '/s/marketing/goals': '월 운영 목표', '/s/marketing/ops': '운영 계획', '/s/marketing/team': 'AI 마케팅팀', '/s/marketing/approvals': '승인함', '/s/marketing/automation': '자동 제작',
  '/s/marketing/materials': '자료 요청', '/s/marketing/calendar': '콘텐츠 캘린더', '/s/marketing/connections': '연결 계정', '/s/marketing/ads': '광고 성과', '/s/marketing/ad-ops': '광고 집행',
  '/s/marketing/report': '월간 보고', '/s/marketing/sites': '사이트별 집계', '/s/marketing/calls': '전화 문의', '/s/marketing/history': '이전 요청 기록',
};
/** 메뉴가 없는 하위 화면 → 그 화면을 여는 메뉴(허브 안 입찰·계약만료·시설·지역 탭 등) */
export const AREA_ALIAS: Record<string, string> = {
  '/branch-reports': '/reports', '/s/sales/bids': HUB_AREA, '/s/sales/contracts': HUB_AREA, '/s/sales/prospects': HUB_AREA, '/s/sales/regions': HUB_AREA,
  '/s/sales/pipeline': '/s/sales/leads',
};
export const menuArea = (a: string | null) => (a ? AREA_ALIAS[a] ?? a : null);
export function spaceOfArea(a: string): SpaceKey | null {
  for (const sp of ['work', 'sales', 'marketing'] as SpaceKey[]) if (MENU_AREAS[sp].includes(a)) return sp;
  return null;
}
/** 공간별 합계(점 화면 제외) — counts 는 menuArea 로 접은 메뉴 숫자 */
export function spaceSums(counts: Record<string, number>): Record<SpaceKey, number> {
  const s: Record<SpaceKey, number> = { work: 0, sales: 0, marketing: 0 };
  for (const [a, n] of Object.entries(counts)) { const sp = spaceOfArea(a); if (sp && !DOT_AREAS.has(a) && n > 0) s[sp] += n; }
  return s;
}
/** 공간 전환 칸 설명: '업무 41 + 보고 2 = 43'(메뉴 하나면 '업무 41') — 숫자가 없으면 빈 글자. detail = 메뉴별 괄호 설명 */
export function spaceBreakdown(counts: Record<string, number>, sp: SpaceKey, detail: Record<string, string> = {}) {
  const on = MENU_AREAS[sp].filter((a) => !DOT_AREAS.has(a) && (counts[a] ?? 0) > 0);
  const parts = on.map((a) => `${MENU_LABEL[a] ?? a} ${counts[a]}${detail[a] ? `(${detail[a]})` : ''}`);
  const sum = on.reduce((x, a) => x + counts[a], 0);
  return parts.length > 1 ? `${parts.join(' + ')} = ${sum}` : parts[0] ?? '';
}
