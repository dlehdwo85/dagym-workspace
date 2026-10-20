import { handler } from '@/lib/api';
import { retryJob } from '@/lib/mktPublish';

/** 실패한 게시 작업 [다시 시도](관리자) */
export const POST = handler<{ id: string }>(async ({ user, params }) => retryJob(user, params.id));
