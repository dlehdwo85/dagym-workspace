import { NextResponse, type NextRequest } from 'next/server';
import { unsubscribe } from '@/lib/bidAlerts';
import { SITE } from '@/lib/landingPages';

export const runtime = 'nodejs';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** #949 수신 거부 — 메일 맨 아래 링크 한 번(로그인 없음). 결과는 짧은 HTML 한 장 */
export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get('t') ?? '';
  const r = await unsubscribe(t).catch(() => ({ ok: false }));
  const msg = r.ok ? '입찰 공고 아침 메일을 더 보내지 않습니다. 이메일 주소는 30일 안에 지웁니다.' : '이미 수신 거부되었거나 링크가 맞지 않습니다. 메일이 계속 오면 메일 맨 아래 링크를 다시 눌러 주세요.';
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>수신 거부 — 워크인</title></head>
<body style="margin:0;background:#F3F6F5;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#0F172A"><div style="max-width:480px;margin:48px auto;padding:28px;background:#fff;border:1px solid #E5E7EB;border-radius:12px">
<div style="font-size:12px;font-weight:700;color:#0F766E">워크인 입찰 공고 아침 메일</div><h1 style="margin:8px 0 0;font-size:20px">${r.ok ? '수신 거부되었습니다' : '확인해 주세요'}</h1><p style="margin-top:10px;font-size:14px;line-height:22px;color:#475569" data-bid-alert-unsub="${r.ok ? 'ok' : 'no'}">${esc(msg)}</p>
<p style="margin-top:16px;font-size:13px"><a href="${esc(SITE)}/landing/bid-alerts" style="color:#0F766E">다시 신청하기</a></p></div></body></html>`;
  return new NextResponse(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
