import { handler, body } from '@/lib/api';
import { contractUploadTarget, sourceUploadInput } from '@/lib/contracts';

/** 전자계약 2차: 계약서 원본(PDF·사진) 올릴 주소 */
export const POST = handler(async ({ req, user }) => contractUploadTarget(user, await body(req, sourceUploadInput)));
