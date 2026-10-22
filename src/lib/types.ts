export type Role = 'owner' | 'admin' | 'dept_lead' | 'site_manager' | 'staff';
export const ROLE_RANK: Record<Role, number> = { owner: 5, admin: 4, dept_lead: 3, site_manager: 2, staff: 1 };
export const ROLE_LABEL: Record<Role, string> = {
  owner: '대표', admin: '본사 관리자', dept_lead: '부서 책임자', site_manager: '현장 관리자', staff: '직원',
};
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'on_hold' | 'done';
export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '진행 전', in_progress: '진행 중', review: '검토 요청', on_hold: '보류', done: '완료',
};
export const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'on_hold', 'done'];
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export const PRIORITY_LABEL: Record<Priority, string> = { low: '낮음', normal: '보통', high: '높음', urgent: '긴급' };
/** 화면에서 숨기는 브랜드 (WORKIN_V2: BODY LAB 은 DB 값만 보존, 선택지·문구에서 제외) */
export const HIDDEN_BRANDS = ['bodylab'];
export const SERVICE_NAME = '워크인';
export const SERVICE_SUB = '다짐 · 하이링크';
export const UNIT_TYPE_LABEL = { hq: '본사', department: '부서', branch: '지점', site: '위탁운영 현장' } as const;
export const EVENT_KIND_LABEL = { normal: '일정', vacation: '연차', half_day: '반차', outside: '외근', business_trip: '출장', task_block: '업무 시간' } as const;
/** V8 6번: 부재(본사 모두에게 보임, 업무 배정 경고) */
export const ABSENCE_KINDS = ['vacation', 'half_day', 'outside', 'business_trip'] as const;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  timezone: string;
  sessionId: string;
  /** 앱 심사용 체험 계정: 데모 조직 밖은 하나도 보이지 않고 설정·초대·첨부 등은 막힌다 */
  isDemo?: boolean;
  /** V10 플랫폼 운영자(워크인 운영사): 모든 회사 사용량·요금제 */
  platformAdmin?: boolean;
  /** V15 회사(tenant) — 'default'(다짐·하이링크) · 'demo'(체험) · 't_…'(공개 가입) */
  tenant?: string;
  /** V28-3 지원 모드: 플랫폼 운영자가 고객사 대표 화면을 읽기 전용으로 보는 중 */
  support?: { adminId: string; adminName: string; until: string; tenantName: string };
  /** V15 개인 공간(1인 회사)이면 관리 메뉴를 숨긴다 */
  personal?: boolean;
}
/** V15: 이 사용자의 회사. 예전 코드(isDemo)와 호환 */
export const tenantOf = (u: { tenant?: string | null; isDemo?: boolean | null }) => u.tenant ?? (u.isDemo ? 'demo' : 'default');

export const NOTIFICATION_TYPES = {
  task_assigned: '업무 배정',
  mention: '멘션',
  due_soon: '마감 임박',
  overdue: '기한 초과(첫날 1번)',
  review_requested: '검토 요청',
  review_result: '검토 결과',
  event_changed: '일정 변경',
  recurring_created: '반복 업무 생성',
  comment: '업무 댓글·답글',
  sync_error: '동기화 오류',
  event_reminder: '일정 시작 전',
  weekly_report: '주간 보고',
  task_done_for_requester: '요청한 업무 완료·보류',
  briefing: '아침 브리핑(오늘의 일정·일정)',
  usage_alert: '사용량 한도(저장공간·AI·사용자) 80%·100%',
  chat: '메신저 새 메시지',
  month_close: '월 마감 기록(지난달 완료·이월·지연)',
  mail_status: '메일 발송 실패',
  sms_due: '예약 문자 보낼 시간(휴대폰 문자앱에서 보내기)',
  mail_sent: '내가 보낸 결과(예약 메일 발송·고객 자료 열람) — 기본 푸시 끔',
  account_request: '직원 계정 삭제 요청',
  library_organized: '자료실 자동 정리 결과(올린 파일이 간 폴더)',
  announcement: '공지(새 공지·다시 알림)',
  digest: '영업·마케팅 묶음 알림(담당 아닌 것 1시간마다 1건 · 담당 미지정 하루 1건)',
  server_error: '서버 오류(플랫폼 운영자만)',
  revenue: '매출 자료 숫자 확인·분석 완료(매출 권한자만)',
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;
