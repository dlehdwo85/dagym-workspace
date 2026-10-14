import { handler, body } from '@/lib/api';
import { moveFiles, moveInput } from '@/lib/library';

export const POST = handler(async ({ req, user }) => moveFiles(user, await body(req, moveInput)));
