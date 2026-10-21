import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { getSmsSign, setSmsSign } from '@/lib/mailbox';

/** V32 7-2 회사 설정: 문자 명함형 서명에 회사 대표번호도 넣기(기본 끔) — 회사 정보·디자인 편집 권한 */
export const GET = handler(async ({ user }) => getSmsSign(user));
export const PUT = handler(async ({ req, user }) => setSmsSign(user, (await body(req, z.object({ companyPhone: z.boolean() }))).companyPhone));
