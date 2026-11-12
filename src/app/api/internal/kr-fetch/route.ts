import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { relayAllowed } from '@/lib/krFetch';
import { fetchErr } from '@/lib/sales/collectors/kg2b';

/** 376차: 한국 IP 만 받는 곳(KG2B)을 서울에서 대신 받는 중계 — 서버끼리만(CRON_SECRET) · 허용한 곳만 · 리다이렉트는 따라가지 않고 그대로 ·
 *  응답 상태·머리는 x-kr-* 에 담고 본문은 그대로 흘려보냄(저장 안 함). 메일 발송 주소처럼 서울(icn1)에서 실행 */
export const preferredRegion = 'icn1';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
const PASS = ['content-type', 'content-length', 'content-disposition', 'last-modified', 'location'];
export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret || token.length !== secret.length || !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let q: { url?: string; method?: string; headers?: Record<string, string>; body?: string };
  try { q = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const url = String(q.url ?? '');
  // 390차: KG2B 말고도 협력사 모집 감시 페이지(플랫폼 운영 › 영업 수집기 설정의 목록에 있는 사이트)는 중계 — 해외 접속을 끊는 국내 건설사 게시판
  if (!relayAllowed(url) && !(await (await import('@/lib/sales/collectors/vendorRecruit')).relayVendorAllowed(url).catch(() => false))) return NextResponse.json({ error: '중계하지 않는 주소입니다' }, { status: 403 });
  const method = q.method === 'POST' ? 'POST' : 'GET';
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(q.headers ?? {})) if (/^(user-agent|content-type|cookie|referer|accept|accept-language)$/i.test(k) && typeof v === 'string') headers[k] = v.slice(0, 4000);
  try {
    const r = await fetch(url, { method, headers, body: method === 'POST' ? String(q.body ?? '').slice(0, 200_000) : undefined, redirect: 'manual', signal: AbortSignal.timeout(50_000) });
    const out = new Headers({ 'x-kr-status': String(r.status), 'x-kr-url': r.url || url, 'x-kr-region': process.env.VERCEL_REGION ?? 'local', 'cache-control': 'no-store' });
    for (const k of PASS) { const v = r.headers.get(k); if (v) out.set(`x-kr-h-${k}`, v.slice(0, 2000)); }
    const sc = (r.headers as any).getSetCookie?.() as string[] | undefined; out.set('x-kr-set-cookie', JSON.stringify((sc ?? []).map((c) => c.split(';')[0]).slice(0, 10)));
    out.set('content-type', 'application/octet-stream');
    return new NextResponse(r.body, { status: 200, headers: out });
  } catch (e) {
    return NextResponse.json({ error: fetchErr(e) }, { status: 502, headers: { 'x-kr-status': '599', 'x-kr-region': process.env.VERCEL_REGION ?? 'local' } });
  }
}
