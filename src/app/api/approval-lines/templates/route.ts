import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { createTemplate } from '@/lib/approvals';

/** #429 예시 결재선 만들기: two(팀장 → 대표) · three(팀장 → 본부장 → 대표) · leave3(팀장, 3일 이상이면 대표) */
export const POST = handler(async ({ req, user }) => createTemplate(user, (await body(req, z.object({ preset: z.enum(['two', 'three', 'leave3']) }))).preset, clientIp(req)), { idempotent: true });
