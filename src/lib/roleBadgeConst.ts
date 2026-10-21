/** 대표 10/20 15:05 (#101) 권한 배지 글자 — 화면(클라이언트)과 서버가 같이 쓰는 순수 상수(db 없음) */
import type { Role } from './types';

export type RoleBadgeMode = 'en' | 'ko' | 'off';
export const ROLE_BADGE_MODES: RoleBadgeMode[] = ['en', 'ko', 'off'];
export const ROLE_BADGE_EN: Record<Role, string> = { owner: 'CEO', admin: 'Admin', dept_lead: 'Lead', site_manager: 'Ops', staff: 'Member' };
/** 심사용·체험 계정 등 정식 구성원이 아닌 사람 */
export const GUEST_BADGE = 'Guest';
export const ROLE_BADGE_MODE_LABEL: Record<RoleBadgeMode, string> = { en: '영어 (CEO · Admin · Lead · Ops · Member · Guest)', ko: '한글 (대표 · 본사 관리자 · 부서 책임자 · 현장 관리자 · 직원)', off: '표시 안 함' };
