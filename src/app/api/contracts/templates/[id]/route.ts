import { handler, body, clientIp } from '@/lib/api';
import { saveTemplate, templateInput } from '@/lib/contracts';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => saveTemplate(user, params.id, await body(req, templateInput), clientIp(req)));
