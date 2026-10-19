import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { convertAndVerify, cutoverStatus, setWritesOpen, snapshotSource } from '@/lib/sales/cutover';

export const maxDuration = 300;
/** V41 단계 2 전환(T-1·T-3·T-5): 동결 시점 원본 건수 기록 · 정식 표 변환 + 대조 · 쓰기 열기/닫기 — 플랫폼 운영자만 */
const input = z.object({ action: z.enum(['snapshot', 'convert', 'open', 'close']), tenant: z.string().trim().min(1).max(60).default('default') });
export const GET = handler(async ({ user }) => cutoverStatus(user));
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, input);
  if (i.action === 'snapshot') return snapshotSource(user, i.tenant);
  if (i.action === 'convert') return convertAndVerify(user, i.tenant);
  return setWritesOpen(user, i.tenant, i.action === 'open');
});
