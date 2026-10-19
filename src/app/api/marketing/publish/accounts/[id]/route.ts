import { handler } from '@/lib/api';
import { removePublishAccount } from '@/lib/mktChannels';

/** 게시 연결 끊기(관리자) — 토큰 즉시 삭제 */
export const DELETE = handler<{ id: string }>(async ({ user, params }) => removePublishAccount(user, params.id));
