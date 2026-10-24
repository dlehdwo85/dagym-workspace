import { handler, clientIp } from '@/lib/api';
import { signSource } from '@/lib/contracts';

/** 전자계약 2차: 서명 화면이 그릴 원본 PDF(접속 코드 필요) */
export const GET = handler<{ token: string }>(async ({ req, params }) =>
  new Response(new Uint8Array(await signSource(params.token, req.nextUrl.searchParams.get('code') ?? '', clientIp(req), req.headers.get('user-agent'))), { headers: { 'content-type': 'application/pdf', 'cache-control': 'private, no-store' } }), { public: true });
