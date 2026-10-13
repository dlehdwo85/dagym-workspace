import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { attachLibraryToTask } from '@/lib/library';

/** 자료실 파일을 업무에 첨부 (같은 저장 파일을 가리킴) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => attachLibraryToTask(user, params.id, (await body(req, z.object({ taskId: z.string().uuid() }))).taskId));
