import type { Role } from './types';

/**
 * 범용화 2단계 '용어 사전 구조'(대표 11/13 승인 · docs/generalization-audit.md G-05·G-06·G-33·G-34·G-67·G-68).
 * 화면·서버 문구에 박혀 있던 다짐식 낱말(본사 관리자·현장 관리자·위탁운영 현장·연차 …)을 한 곳에서 회사별로 고른다.
 *  · 기본 회사(default — 다짐): TERMS_BASE = 지금까지 화면에 나오던 표현 그대로(바꾸지 않는다).
 *  · 다른 회사: TERMS_COMMON(공통 표현) + 회사가 정한 역할 이름(회사 정보 › 역할 이름).
 * 역할 키(owner·admin·…)·조직 유형 키·자격 키는 그대로 두고 '표시 이름'만 여기서 나온다(비교·권한 로직은 키로만).
 * 이 파일은 화면(클라이언트)과 서버가 같이 쓰는 순수 상수·함수 — DB·서버 전용 모듈을 가져오지 않는다.
 */
export type UnitType = 'hq' | 'department' | 'branch' | 'site';
export type EventKind = 'normal' | 'vacation' | 'half_day' | 'outside' | 'business_trip' | 'task_block';
/** 업무 완료·마감 변경 자격(access.ts perms.finish·dueNow 의 값 — 기록에도 이 값으로 남아 있어 키로 그대로 쓴다) */
export type CapacityKey = '요청자' | '관리자' | '부서장' | '팀장' | '대표' | '담당자';
export type Terms = {
  role: Record<Role, string>;
  unit: Record<UnitType, string>;
  event: Record<EventKind, string>;
  /** 연락처의 소속 칸 이름 */
  contactOrg: string;
  capacity: Record<CapacityKey, string>;
};
export const ROLES: Role[] = ['owner', 'admin', 'dept_lead', 'site_manager', 'staff'];

/** 다짐(기본 회사) — 지금 화면 표현 그대로 */
export const TERMS_BASE: Terms = {
  role: { owner: '대표', admin: '본사 관리자', dept_lead: '부서 책임자', site_manager: '현장 관리자', staff: '직원' },
  unit: { hq: '본사', department: '부서', branch: '지점', site: '위탁운영 현장' },
  event: { normal: '일정', vacation: '연차', half_day: '반차', outside: '외근', business_trip: '출장', task_block: '업무 시간' },
  contactOrg: '회사·단지',
  capacity: { 요청자: '요청자', 관리자: '관리자', 부서장: '부서장', 팀장: '팀장', 대표: '대표', 담당자: '담당자' },
};
/** 다른 회사 기본값(대표 11/13: 대표·관리자·팀 책임자·지점 관리자·직원) */
export const TERMS_COMMON: Terms = {
  role: { owner: '대표', admin: '관리자', dept_lead: '팀 책임자', site_manager: '지점 관리자', staff: '직원' },
  unit: { hq: '회사', department: '부서', branch: '지점', site: '사업장' },
  event: { normal: '일정', vacation: '휴가', half_day: '반차', outside: '외근', business_trip: '출장', task_block: '업무 시간' },
  contactOrg: '회사·지점',
  capacity: { 요청자: '요청자', 관리자: '관리자', 부서장: '부서장', 팀장: '팀장', 대표: '대표', 담당자: '담당자' },
};
/** 회사가 정한 값(지금은 역할 이름만) */
export type TermsCustom = { role?: Partial<Record<Role, string>> };
export const ROLE_NAME_MAX = 12;
/** 역할 이름으로 쓸 수 있는 글자: 한글·영문·숫자·공백·가운뎃점·하이픈, 1~12자 */
export const roleNameOk = (s: unknown): s is string => typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= ROLE_NAME_MAX && /^[가-힣A-Za-z0-9 ·\-]+$/.test(s.trim());

export const isBaseTenant = (tenant: string | null | undefined) => !tenant || tenant === 'default';
/** 그 회사의 용어 — 기본 회사는 늘 TERMS_BASE(회사 설정을 읽지 않는다) */
export function termsFor(tenant: string | null | undefined, custom?: TermsCustom | null): Terms {
  if (isBaseTenant(tenant)) return TERMS_BASE;
  const role = { ...TERMS_COMMON.role };
  for (const r of ROLES) { const v = custom?.role?.[r]; if (roleNameOk(v)) role[r] = v.trim(); }
  // 자격 표시의 '대표'는 그 회사의 대표 이름을 따른다(다른 자격 이름은 조직 모델이 정해진 뒤)
  return { ...TERMS_COMMON, role, capacity: { ...TERMS_COMMON.capacity, 대표: role.owner } };
}
/** 조사 '이/가' — 회사가 정한 이름이 받침으로 끝나는지에 따라(한글이 아니면 '가') */
export const josaIGa = (w: string) => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? '이' : '가'; };
/** "현장 관리자 이상" 같은 문구 */
export const roleOrAbove = (t: Terms, r: Role) => `${t.role[r]} 이상`;
/** "대표·본사 관리자" */
export const adminsLabel = (t: Terms) => `${t.role.owner}·${t.role.admin}`;
/** 권한 배지 '한글' 보기의 설명 글자 */
export const roleListLabel = (t: Terms) => ROLES.map((r) => t.role[r]).join(' · ');
