import { handler } from '@/lib/api';
import { exportTenants } from '@/lib/platformAdmin';

/** #656 고객사 목록 내보내기 — 목록과 같은 검색·필터(q·status·segment·stage), 엑셀 기본·?format=csv */
export const GET = handler(async ({ req, user }) => {
  const p = req.nextUrl.searchParams;
  const r = await exportTenants(user, { q: p.get('q') ?? '', status: p.get('status') ?? '', segment: p.get('segment') ?? '', stage: p.get('stage') ?? '', format: p.get('format') ?? 'xlsx' });
  return new Response(new Uint8Array(r.data), { headers: { 'content-type': r.type, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.fileName)}` } });
});
