import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { upgradeToTeam } from '@/lib/account';

export const POST = handler(async ({ req, user }) => upgradeToTeam(user, (await body(req, z.object({ company: z.string().max(60) }))).company, clientIp(req)));
