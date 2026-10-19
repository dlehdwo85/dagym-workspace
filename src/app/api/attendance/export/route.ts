import { handler } from '@/lib/api';
import { exportMonth } from '@/lib/attendance';
import { todaySeoul } from '@/lib/time';

export const GET = handler(async ({ req, user }) => {
  const r = await exportMonth(user, req.nextUrl.searchParams.get('month') ?? todaySeoul().slice(0, 7));
  return new Response(new Uint8Array(r.data), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.fileName)}` } });
});
