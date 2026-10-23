import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse } from '@/lib/api';
import { recordSiteEvent, siteEventInput } from '@/lib/mktSites';

export const runtime = 'nodejs';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '86400', 'cache-control': 'no-store' };
/**
 * 대표 10/20 14:10 ①: 브랜드 사이트 비콘 — `POST /api/public/site-event {event:'visit'|'cta', label?, path?, landing?}`.
 * - 사이트 서버가 보낼 때: `Authorization: Bearer <연동 토큰>`(문의 연동과 같은 토큰 — 브라우저 코드에 넣지 않음, 로컬 10/23 보안)
 * - 브라우저가 바로 보낼 때: `?pk=<공개 키>`(방문·CTA 만 셈, 문의 등록 불가 — 사이트별 집계 화면에 있음)
 * 다른 출처에서 sendBeacon 으로 오므로 공통 handler(출처 검사·세션) 대신 직접 처리하고 CORS 를 연다.
 */
export const OPTIONS = async () => new NextResponse(null, { status: 204, headers: CORS });
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization'); const k = req.nextUrl.searchParams.get('k') ?? (auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '');
    const txt = await req.text().catch(() => ''); const parsed = siteEventInput.parse(JSON.parse(txt || '{}'));
    const out = await recordSiteEvent(k ?? '', parsed, req.nextUrl.searchParams.get('pk') ?? '');
    return NextResponse.json(out, { headers: CORS });
  } catch (e) {
    const r = errorResponse(e, req); for (const [h, v] of Object.entries(CORS)) r.headers.set(h, v); return r;
  }
}
