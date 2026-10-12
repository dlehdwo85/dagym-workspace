import { handler, body } from '@/lib/api';
import { attachmentInput, createAttachment } from '@/lib/attachments';

export const POST = handler(async ({ req, user }) => createAttachment(user, await body(req, attachmentInput)), { idempotent: true });
