import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse } from '@/lib/api';
import { recordSiteEvent, siteEventInput } from '@/lib/mktSites';

export const runtime = 'nodejs';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '86400', 'cache-control': 'no-store' };
/**
 * 대표 10/20 14:10 ①: 브랜드 사이트 비콘 — `POST /api/public/site-event?k=<연동 토큰> {event:'visit'|'cta', label?, path?, site?}`.
 * 다른 출처(브랜드 사이트)에서 sendBeacon 으로 오므로 공통 handler(출처 검사·세션) 대신 직접 처리하고 CORS 를 연다. 토큰은 문의 연동과 같은 것(해시 비교).
 */
export const OPTIONS = async () => new NextResponse(null, { status: 204, headers: CORS });
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization'); const k = req.nextUrl.searchParams.get('k') ?? (auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '');
    const txt = await req.text().catch(() => ''); const parsed = siteEventInput.parse(JSON.parse(txt || '{}'));
    const out = await recordSiteEvent(k ?? '', parsed);
    return NextResponse.json(out, { headers: CORS });
  } catch (e) {
    const r = errorResponse(e, req); for (const [h, v] of Object.entries(CORS)) r.headers.set(h, v); return r;
  }
}
