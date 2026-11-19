import { handler, body } from '@/lib/api';
import { addItemPhoto, photoInput } from '@/lib/check/photos';

/** 점검 항목의 기준 사진 올리기(줄인 사진, 3MB·항목마다 6장까지) — 가이드 편집 권한 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => addItemPhoto(user, params.id, await body(req, photoInput)));
