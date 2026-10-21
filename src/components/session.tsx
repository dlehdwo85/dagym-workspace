'use client';
import { createContext, useContext } from 'react';
import type { Role } from '@/lib/types';
import { DEFAULT_TERMS, type SalesTerms } from '@/lib/sales/terms';

export interface Dir {
  brands: { id: string; name: string; color: string }[];
  orgUnits: { id: string; parent_id: string | null; brand_id: string | null; type: string; name: string; active: boolean }[];
  users: { id: string; name: string; title: string | null; role: Role; email: string; org_unit_ids: string[]; /** #101 심사용·체험 계정 → Guest 배지 */ is_demo?: boolean }[];
  isAdmin: boolean;
}
export interface Sess {
  user: { id: string; name: string; email: string; role: Role; /** V10 플랫폼 운영자 */ platformAdmin?: boolean };
  dir: Dir;
  /** V28-3 지원 모드(플랫폼 운영자가 이 회사 대표 화면을 읽기 전용으로 보는 중) */
  support?: { adminId: string; adminName: string; until: string; tenantName: string } | null;
  /** 선택 기능 스위치 (핵심 기능은 항상 켜짐) */
  /** V13 메뉴 권한 (revenue·team_reports·library·assistant → none/view/edit/use) */
  menus?: Record<string, string>;
  tenant?: { /** #101 권한 배지: 영어(기본)·한글·끄기 */ roleBadge?: 'en' | 'ko' | 'off'; name: string; personal: boolean; internal: boolean; /** V21 문의(웹·전화) 받는 회사 */ inquiries?: boolean; onboarding: boolean; trial?: { trial: boolean; readOnly: boolean; daysLeft: number } | null; /** V28 B2 미납 잠금 */ billingLock?: 'read_only' | 'suspended' | null };
  /** V41 공간: 들어갈 수 있는 공간(업무는 늘) */
  spaces?: ('work' | 'sales' | 'marketing')[];
  features: { googleSync: boolean; /** V9 AI 비서 (플랫폼 API 키가 있을 때만) */ ai: boolean; /** V9 자료실 (체험 계정 제외) */ library: boolean; /** 영업 입찰·공고 사용(회사 선택) */ salesBids?: boolean; /** #408 회사 업종 템플릿 용어(영업 메뉴·칸 이름·예시) */ salesTerms?: SalesTerms; /** ⑦ 사이드바 3구역(대표 승인 10/20 오후) — FEATURE_SIDEBAR3=0 이면 예전 사이드바 */ sidebar3?: boolean };
}
export const SessionCtx = createContext<Sess | null>(null);
export function useSession() {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('no session');
  return s;
}
/** #408 영업 용어(업종 템플릿) — 세션에 없으면 중립('일반') */
export function useSalesTerms(): SalesTerms {
  return useSession().features.salesTerms ?? DEFAULT_TERMS;
}
export const canManage = (role: Role) => role !== 'staff';
export const isAdminRole = (role: Role) => role === 'owner' || role === 'admin';
