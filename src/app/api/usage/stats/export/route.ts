import { handler } from '@/lib/api';
import { exportStats, pickRange } from '@/lib/usageStats';

export const GET = handler(async ({ req, user }) => {
  const r = await exportStats(user, pickRange(req.nextUrl.searchParams.get('days')));
  return new Response(new Uint8Array(r.data), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.fileName)}` } });
});
