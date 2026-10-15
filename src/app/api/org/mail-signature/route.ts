import { handler, body, clientIp } from '@/lib/api';
import { saveSignature, signatureInput, signatureList } from '@/lib/mailbox';

/** V21 메일 명함(회사별 소개 한 줄·비밀유지 안내문) */
export const PUT = handler(async ({ req, user }) => saveSignature(user, await body(req, signatureInput), clientIp(req)));
export const GET = handler(async ({ user }) => signatureList(user));
