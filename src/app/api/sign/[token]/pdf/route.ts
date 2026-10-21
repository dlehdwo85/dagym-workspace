import { handler, clientIp } from '@/lib/api';
import { signPdf } from '@/lib/contracts';

/** 완료본 PDF 내려받기(접속 코드 필요) */
export const GET = handler<{ token: string }>(async ({ req, params }) => {
  const r = await signPdf(params.token, req.nextUrl.searchParams.get('code') ?? '', clientIp(req), req.headers.get('user-agent'));
  return new Response(new Uint8Array(r.data), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(r.fileName)}` } });
}, { public: true });
