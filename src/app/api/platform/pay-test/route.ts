import { handler, body, clientIp } from '@/lib/api';
import { createTestTenant, listTestTenants, testTenantInput } from '@/lib/billing/payTest';

/** V32 1 결제 시험 회사 목록·만들기(플랫폼 운영자) */
export const GET = handler(async ({ user }) => listTestTenants(user));
export const POST = handler(async ({ req, user }) => createTestTenant(user, await body(req, testTenantInput), clientIp(req)));
