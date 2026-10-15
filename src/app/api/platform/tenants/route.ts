import { handler } from '@/lib/api';
import { tenantDirectory } from '@/lib/platformAdmin';

/** V28-3 회사(테넌트) 목록 — 검색·상태 필터 */
export const GET = handler(async ({ req, user }) => tenantDirectory(user, { q: req.nextUrl.searchParams.get('q') ?? '', status: req.nextUrl.searchParams.get('status') ?? '' }));
