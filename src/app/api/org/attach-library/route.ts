import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { getAttachToLibrary, setAttachToLibrary } from '@/lib/library';

/** V38 4 회사 설정: 업무 첨부를 자료실에 자동 등록(기본 켬) — 바꾸기는 회사 정보·디자인 편집 권한 */
export const GET = handler(async ({ user }) => getAttachToLibrary(user));
export const PUT = handler(async ({ req, user }) => setAttachToLibrary(user, await body(req, z.object({ on: z.boolean().optional(), confWords: z.array(z.string().max(40)).max(200).nullable().optional() }))));
