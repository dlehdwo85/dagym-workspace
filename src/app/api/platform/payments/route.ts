import { handler } from '@/lib/api';
import { platformPayments, platformPaymentsQuery } from '@/lib/billing';

/** #1160 플랫폼 결제 목록 — ?q=회사·from·to·status·min·max·hideTest(기본 1) */
export const GET = handler(async ({ req, user }) => platformPayments(user, platformPaymentsQuery.parse(Object.fromEntries(req.nextUrl.searchParams))));
