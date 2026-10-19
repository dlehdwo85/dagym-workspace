import { handler, body, clientIp } from '@/lib/api';
import { listTemplates, saveTemplate, templateInput } from '@/lib/quotes';

export const GET = handler(async ({ req, user }) => listTemplates(user, req.nextUrl.searchParams.get('company') ?? undefined));
export const POST = handler(async ({ req, user }) => saveTemplate(user, await body(req, templateInput), clientIp(req)));
