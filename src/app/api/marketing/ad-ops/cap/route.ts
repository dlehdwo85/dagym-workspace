import { handler, body } from '@/lib/api';
import { capInput, setCap } from '@/lib/adOps';

/** 회사 월 광고비 상한(관리자, 필수) */
export const PUT = handler(async ({ req, user }) => setCap(user, await body(req, capInput)));
