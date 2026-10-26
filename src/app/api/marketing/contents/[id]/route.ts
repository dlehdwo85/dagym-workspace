import { handler, body } from '@/lib/api';
import { contentPatchInput, getContent, patchContent } from '@/lib/marketing';
import { trashContent } from '@/lib/mktTrash';

export const GET = handler<{ id: string }>(async ({ user, params }) => getContent(user, params.id));
/** 로컬 10/21 08:10: 브랜드·게시 예정 시각 바로잡기(관리자, 승인 상태 유지) */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => patchContent(user, params.id, await body(req, contentPatchInput)));
/** 183차 #177: 상세 창 [휴지통으로](관리자) — 30일 뒤 영구 삭제, 그 안에는 되살리기 */
export const DELETE = handler<{ id: string }>(async ({ user, params }) => trashContent(user, params.id));
