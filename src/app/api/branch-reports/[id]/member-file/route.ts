import { body, clientIp, handler } from '@/lib/api';
import { memberExcludeInput, memberFileInput, setMemberExclude, uploadMemberFile } from '@/lib/branchReport';

/** #1112 월간 보고 — 하이링크 회원목록 엑셀 → 회원(이용권) 현황(집계만 저장, 원본·이름·연락처 저장 안 함) · 시험·직원 줄 제외 켜기/끄기 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => uploadMemberFile(user, params.id, await body(req, memberFileInput), clientIp(req)));
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => setMemberExclude(user, params.id, await body(req, memberExcludeInput), clientIp(req)));
