import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { aiExtract } from '@/lib/revenue';

export const maxDuration = 120;
/** V13 1번 자료로 입력(AI): 자료실에 올린 정산서(엑셀·PDF·사진) → 미리보기. 반영은 /api/revenue/import (dryRun=false) */
export const POST = handler(async ({ req, user }) => aiExtract(user, (await body(req, z.object({ fileIds: z.array(z.string().uuid()).min(1).max(5) }))).fileIds));
