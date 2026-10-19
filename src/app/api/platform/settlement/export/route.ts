import { handler } from '@/lib/api';
import { exportSettlement } from '@/lib/billing/settlement';

export const GET = handler(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  const r = await exportSettlement(user, { month: q.get('month') ?? undefined, includeTest: q.get('test') === '1' });
  return new Response(new Uint8Array(r.data), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.fileName)}` } });
});
