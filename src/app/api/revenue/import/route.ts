import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { importRevenueCsv } from '@/lib/revenue';

/** CSV 가져오기 (매출 입력 권한). evidenceFileIds = 자료로 입력(AI) 근거 파일. dryRun=true 면 검사·미리보기만 */
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ csv: z.string().min(1).max(2_000_000), fileName: z.string().max(200).nullable().optional(), dryRun: z.boolean().optional(),
    evidenceFileIds: z.array(z.string().uuid()).max(5).optional() }));
  return importRevenueCsv(user, i.csv, i.fileName ?? null, !!i.dryRun, clientIp(req), i.evidenceFileIds ?? null);
});
