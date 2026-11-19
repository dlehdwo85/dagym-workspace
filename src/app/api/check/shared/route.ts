import { handler } from '@/lib/api';
import { sharedItems } from '@/lib/check/guide';

/** 직원 공유용 양호 기준 — 가이드 권한이 없어도 같은 회사 사람이면 '직원 공유' 표시 항목만 */
export const GET = handler(async ({ user }) => sharedItems(user));
