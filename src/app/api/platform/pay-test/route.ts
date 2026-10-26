import { handler, body, clientIp } from '@/lib/api';
import { createTestTenant, payTestHome, testTenantInput } from '@/lib/billing/payTest';

/** 192차: 결제 시험 화면 — 결제 모듈 상태 · 고정 시험 회사 · 최근 시험 결제(플랫폼 운영자). tenants = 예전 시험 회사 목록(화면에는 안 씀) */
export const GET = handler(async ({ user }) => payTestHome(user));
export const POST = handler(async ({ req, user }) => createTestTenant(user, await body(req, testTenantInput), clientIp(req)));
