import { body, handler } from '@/lib/api';
import { issueToken, tokenInput } from '@/lib/inquiries';

export const POST = handler(async ({ req, user }) => issueToken(user, await body(req, tokenInput)));
