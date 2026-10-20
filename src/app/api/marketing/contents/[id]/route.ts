import { handler, body } from '@/lib/api';
import { contentPatchInput, getContent, patchContent } from '@/lib/marketing';

export const GET = handler<{ id: string }>(async ({ user, params }) => getContent(user, params.id));
/** 로컬 10/21 08:10: 브랜드·게시 예정 시각 바로잡기(관리자, 승인 상태 유지) */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => patchContent(user, params.id, await body(req, contentPatchInput)));
