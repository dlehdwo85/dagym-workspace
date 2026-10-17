import { handler, body } from '@/lib/api';
import { addVersion, versionInput } from '@/lib/marketing';

/** 수정본 = 새 버전(이전 승인 무효 → 재승인 대기) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => addVersion(user, params.id, await body(req, versionInput)));
