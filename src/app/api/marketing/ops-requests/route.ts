import { handler } from '@/lib/api';
import { opsRequests } from '@/lib/opsConvert';

/** 운영실 이전 요청 기록(변환된 것) */
export const GET = handler(async ({ user }) => opsRequests(user));
