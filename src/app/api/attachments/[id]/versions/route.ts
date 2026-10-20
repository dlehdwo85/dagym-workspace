import { handler, body } from '@/lib/api';
import { listVersions, newVersionInput, startVersion } from '@/lib/attachmentEdit';

/** 대표 10/20 23:05 업무 첨부 버전: 목록 · [새 버전 올리기] 1/2(올릴 자리) */
export const GET = handler<{ id: string }>(async ({ user, params }) => listVersions(user, params.id));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => startVersion(user, params.id, await body(req, newVersionInput)));
