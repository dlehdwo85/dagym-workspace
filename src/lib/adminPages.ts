/**
 * V36 3 관리 화면 ↔ 메뉴 권한 한 곳에서 — 사이드바 "관리" 묶음·관리 화면 입구 확인·권한 없을 때 안내가 모두 이 표를 쓴다.
 * 새 관리 화면을 만들면 여기에 한 줄(주소·이름·메뉴 키)만 넣으면 사이드바·접근 확인에 같이 들어가고,
 * 메뉴 키가 menuPerms.MENUS 에 있어야 하므로 대표의 메뉴 권한 표에도 자동으로 나온다(시험이 둘의 짝을 확인).
 * (서버·화면 양쪽에서 쓰므로 서버 전용 모듈을 가져오지 않는다)
 */
export type AdminPage = { href: string; label: string; menu: string; sidebar?: boolean };
export const ADMIN_PAGES: AdminPage[] = [
  { href: '/reports', label: '주간 보고', menu: 'team_reports', sidebar: true },
  { href: '/revenue', label: '매출', menu: 'revenue', sidebar: true },
  { href: '/admin/users', label: '사용자 관리', menu: 'admin_users', sidebar: true },
  { href: '/admin/ops', label: '운영 상태', menu: 'ops', sidebar: true },
  { href: '/admin/org', label: '조직 구성', menu: 'ops' },
  { href: '/admin/audit', label: '감사 기록', menu: 'ops' },
  { href: '/admin/holidays', label: '공휴일', menu: 'ops' },
  { href: '/admin/approvals', label: '결재선', menu: 'ops' },
  { href: '/admin/company', label: '회사 정보·디자인', menu: 'company', sidebar: true },
  { href: '/admin/mail', label: '메일 계정·명함', menu: 'mail_settings', sidebar: true },
  { href: '/admin/usage', label: '사용량·요금제', menu: 'usage', sidebar: true },
  { href: '/admin/ai-logs', label: 'AI 사용 내역', menu: 'ai_logs', sidebar: true },
  { href: '/admin/attendance', label: '근태(출퇴근)', menu: 'attendance_admin', sidebar: true }, // V30 ③
  { href: '/admin/approval-forms', label: '결재 양식', menu: 'ops' }, // V30 ④
];
/** 주소에 해당하는 관리 화면(가장 긴 앞부분 일치) */
export function adminPageFor(path: string): AdminPage | null {
  let best: AdminPage | null = null;
  for (const p of ADMIN_PAGES) if ((path === p.href || path.startsWith(p.href + '/')) && (!best || p.href.length > best.href.length)) best = p;
  return best;
}
export const ADMIN_MENU_KEYS = [...new Set(ADMIN_PAGES.map((p) => p.menu))];
