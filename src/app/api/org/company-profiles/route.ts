import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { deleteProfile, listProfiles, profileInput, saveProfile } from '@/lib/companyProfiles';

/** V22 회사 정보·디자인 기준 (조직 설정) */
export const GET = handler(async ({ user }) => listProfiles(user));
export const PUT = handler(async ({ req, user }) => saveProfile(user, await body(req, profileInput), clientIp(req)));
export const DELETE = handler(async ({ req, user }) => deleteProfile(user, (await body(req, z.object({ key: z.string().min(1).max(30) }))).key, clientIp(req)));
