import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { fileTarget } from '@/lib/chat';

/** 파일 올릴 주소 (올린 뒤 메시지에 file.key 로 붙인다) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) =>
  fileTarget(user, params.id, await body(req, z.object({ fileName: z.string().trim().min(1).max(200), mime: z.string().max(100).default('application/octet-stream'), size: z.number().int().positive() }))));
