import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { completeLibraryFile } from '@/lib/library';

export const maxDuration = 60; // 올린 뒤 자동 정리(AI)
export const POST = handler<{ id: string }>(async ({ req, user, params }) => completeLibraryFile(user, params.id, (await body(req, z.object({ uploadId: z.string().max(400).optional() }).default({})).catch(() => ({ uploadId: undefined as string | undefined }))).uploadId));
