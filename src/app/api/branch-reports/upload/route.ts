import { body, clientIp, handler } from '@/lib/api';
import { uploadChat, uploadInput } from '@/lib/branchReport';

/** #1096 카카오톡 대화 내보내기 파일(txt·csv·zip) — 원본은 저장하지 않고 가린 메시지만 */
export const POST = handler(async ({ req, user }) => uploadChat(user, await body(req, uploadInput), clientIp(req)));
