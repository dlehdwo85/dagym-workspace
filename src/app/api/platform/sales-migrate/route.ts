import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { salesMapUser, salesMigrateApply, salesMigratePreview, salesMigrateStatus, salesSyncToggle } from '@/lib/sales/migrate';

export const maxDuration = 300;
/** V41 단계 2 영업관리 이전 — 미리보기(원본 읽기만, 저장 없음). 적용은 로컬 대조·대표 확인 뒤 다음 단계 */
const input = z.object({ action: z.enum(['preview', 'apply', 'daily', 'map']).default('preview'), tenant: z.string().trim().min(1).max(60).optional(), daily: z.boolean().optional(),
  srcUserId: z.string().max(100).optional(), userId: z.string().uuid().nullable().optional() });
export const GET = handler(async ({ user }) => salesMigrateStatus(user));
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, input);
  if (i.action === 'apply') return salesMigrateApply(user, i.tenant ?? 'default');
  if (i.action === 'daily') return salesSyncToggle(user, !!i.daily);
  if (i.action === 'map') return salesMapUser(user, i.tenant ?? 'default', i.srcUserId ?? '', i.userId ?? null);
  return salesMigratePreview(user);
});
