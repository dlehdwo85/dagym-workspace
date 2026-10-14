import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { teamInput, updateTeam } from '@/lib/teams';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) =>
  updateTeam(user, params.id, await body(req, teamInput.partial().extend({ archived: z.boolean().optional() })), clientIp(req)));
