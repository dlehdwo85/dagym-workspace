import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { completeFile, fileUrl, removeFile } from '@/lib/agreements';

/** 계약서 파일 열기(?inline=1 이면 바로 보기 — PDF·사진만) — 계약 관리 권한이 있어야 하고 열람은 감사 기록에 남음 */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => ({ url: await fileUrl(user, params.id, req.nextUrl.searchParams.get('inline') === '1', clientIp(req)) }));
/** 올리기 마무리 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => completeFile(user, params.id, await body(req, z.object({ uploadId: z.string().max(400).optional() }))));
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => removeFile(user, params.id, clientIp(req)));
