import { body, clientIp, handler } from '@/lib/api';
import { memberFileInput, memberPatchInput, patchMembers, uploadMemberFile } from '@/lib/branchReport';

/** #1112 월간 보고 — 하이링크 회원목록 엑셀 → 회원(이용권) 현황(집계만 저장, 원본·이름·연락처 저장 안 함) · 시험·직원 줄 제외 켜기/끄기 · #1115 이용권명 분류(이용권/수강권) 바꾸기 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => uploadMemberFile(user, params.id, await body(req, memberFileInput), clientIp(req)));
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => patchMembers(user, params.id, await body(req, memberPatchInput), clientIp(req)));
