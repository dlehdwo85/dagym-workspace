import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { prepareSource, sourceBytes } from '@/lib/contracts';

/** 전자계약 2차: 올린 원본 확인(사진은 PDF 로 바꿈) → 키·쪽 수·해시 */
export const POST = handler(async ({ req, user }) => prepareSource(user, (await body(req, z.object({ key: z.string().min(1).max(400) }))).key));
/** 편집기용 원본 PDF(우리 회사 키만) */
export const GET = handler(async ({ req, user }) => new Response(new Uint8Array(await sourceBytes(user, req.nextUrl.searchParams.get('key') ?? '')), { headers: { 'content-type': 'application/pdf', 'cache-control': 'private, no-store' } }));
