import { handler, body } from '@/lib/api';
import { addResultPhoto, photoInput } from '@/lib/check/photos';

/** 점검 결과 사진 올리기(줄인 사진, 결과마다 6장까지) — 점검을 시작한 사람, 끝내기 전까지 */
export const POST = handler<{ id: string; rid: string }>(async ({ req, user, params }) => addResultPhoto(user, params.id, params.rid, await body(req, photoInput)));
