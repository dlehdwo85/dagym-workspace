import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { getRoleBadge, setRoleBadge } from '@/lib/roleBadge';

/** 대표 10/20 15:05 (#101) 회사 설정: 권한 배지 영어(기본)/한글/끄기 — 바꾸기는 회사 정보·디자인 편집 권한 */
export const GET = handler(async ({ user }) => getRoleBadge(user));
export const PUT = handler(async ({ req, user }) => setRoleBadge(user, (await body(req, z.object({ mode: z.enum(['en', 'ko', 'off']) }))).mode));
