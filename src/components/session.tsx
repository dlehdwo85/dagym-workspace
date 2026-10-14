'use client';
import { createContext, useContext } from 'react';
import type { Role } from '@/lib/types';

export interface Dir {
  brands: { id: string; name: string; color: string }[];
  orgUnits: { id: string; parent_id: string | null; brand_id: string | null; type: string; name: string; active: boolean }[];
  users: { id: string; name: string; title: string | null; role: Role; email: string; org_unit_ids: string[] }[];
  isAdmin: boolean;
}
export interface Sess {
  user: { id: string; name: string; email: string; role: Role; /** V10 플랫폼 운영자 */ platformAdmin?: boolean };
  dir: Dir;
  /** 선택 기능 스위치 (핵심 기능은 항상 켜짐) */
  /** V13 메뉴 권한 (revenue·team_reports·library·assistant → none/view/edit/use) */
  menus?: Record<string, string>;
  tenant?: { name: string; personal: boolean; internal: boolean; onboarding: boolean; trial?: { trial: boolean; readOnly: boolean; daysLeft: number } | null };
  features: { googleSync: boolean; /** V9 AI 비서 (플랫폼 API 키가 있을 때만) */ ai: boolean; /** V9 자료실 (체험 계정 제외) */ library: boolean };
}
export const SessionCtx = createContext<Sess | null>(null);
export function useSession() {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('no session');
  return s;
}
export const canManage = (role: Role) => role !== 'staff';
export const isAdminRole = (role: Role) => role === 'owner' || role === 'admin';
