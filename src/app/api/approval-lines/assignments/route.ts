import { handler, body, clientIp } from '@/lib/api';
import { assignInput, listAssignments, saveAssignment } from '@/lib/approvals';

/** #429 (양식 종류 × 부서·팀) → 결재선 배정: 목록(부서·팀 트리 포함) · 저장(lineId null = 지우기) — 운영 상태 권한 */
export const GET = handler(async ({ user }) => listAssignments(user));
export const PUT = handler(async ({ req, user }) => saveAssignment(user, await body(req, assignInput), clientIp(req)));
