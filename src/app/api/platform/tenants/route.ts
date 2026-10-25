import { handler, body, clientIp } from '@/lib/api';
import { createTenantByPlatform, newTenantInput, tenantDirectory } from '@/lib/platformAdmin';

/** V28-3 회사(테넌트) 목록 — 검색·상태 필터 */
export const GET = handler(async ({ req, user }) => tenantDirectory(user, { q: req.nextUrl.searchParams.get('q') ?? '', status: req.nextUrl.searchParams.get('status') ?? '',
  segment: req.nextUrl.searchParams.get('segment') ?? '', stage: req.nextUrl.searchParams.get('stage') ?? '' })); // #656 구분·단계 필터
/** 대표 10/20 ① [고객사 추가]: 회사·대표 계정 만들고 초대 메일 */
export const POST = handler(async ({ req, user }) => createTenantByPlatform(user, await body(req, newTenantInput), clientIp(req)));
