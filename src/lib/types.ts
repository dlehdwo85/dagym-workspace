export type Role = 'owner' | 'admin' | 'dept_lead' | 'site_manager' | 'staff';
export const ROLE_RANK: Record<Role, number> = { owner: 5, admin: 4, dept_lead: 3, site_manager: 2, staff: 1 };
export const ROLE_LABEL: Record<Role, string> = {
  owner: '대표', admin: '본사 관리자', dept_lead: '부서 책임자', site_manager: '현장 관리자', staff: '직원',
};
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'on_hold' | 'done';
export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '예정', in_progress: '진행 중', review: '검토 요청', on_hold: '보류', done: '완료',
};
export const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'on_hold', 'done'];
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export const PRIORITY_LABEL: Record<Priority, string> = { low: '낮음', normal: '보통', high: '높음', urgent: '긴급' };
/** 화면에서 숨기는 브랜드 (WORKIN_V2: BODY LAB 은 DB 값만 보존, 선택지·문구에서 제외) */
export const HIDDEN_BRANDS = ['bodylab'];
export const SERVICE_NAME = '워크인';
export const SERVICE_SUB = '다짐 · 하이링크';
export const UNIT_TYPE_LABEL = { hq: '본사', department: '부서', branch: '지점', site: '위탁운영 현장' } as const;
export const EVENT_KIND_LABEL = { normal: '일정', vacation: '휴가', business_trip: '출장', task_block: '업무 시간' } as const;

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
}

export const NOTIFICATION_TYPES = {
  task_assigned: '업무 배정',
  mention: '멘션',
  due_soon: '마감 임박',
  overdue: '기한 초과',
  review_requested: '검토 요청',
  review_result: '검토 결과',
  event_changed: '일정 변경',
  recurring_created: '반복 업무 생성',
  comment: '업무 댓글',
  sync_error: '동기화 오류',
  event_reminder: '일정 시작 전',
  weekly_report: '주간 보고',
  task_done_for_requester: '지시한 업무 완료·검토 요청',
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;
