import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { perfBeaconInput, recordScreens } from '@/lib/perf';

export const runtime = 'nodejs';
/**
 * #948 실제 사용자 화면 속도 비콘 — 로그인한 화면(AppShell)의 PerfBeacon 이 sendBeacon 으로 보낸다(`{c:'web'|'app', items:[{s:화면, f:첫 표시 ms, l:목록 표시 ms}]}`).
 * 로그인한 세션(쿠키·앱 토큰)이 있는 요청만 센다(바깥에서 가짜 느린 기록으로 알림을 울리지 못하게) — 그래도 사람·회사 값은 저장하지 않고 화면 이름과 시간만 하루 히스토그램에 더한다.
 * sendBeacon 은 헤더를 못 붙이고, 공통 handler 는 POST 마다 푸시 발송 확인을 붙이므로 직접 처리.
 * 같은 주소(IP)에서 1분에 120번 넘게 오면 그 뒤는 버린다(셈만 안 함, 응답은 200).
 */
const seen = new Map<string, { n: number; t: number }>();
function allowed(ip: string) {
  const now = Date.now(); const e = seen.get(ip);
  if (!e || now - e.t > 60_000) { seen.set(ip, { n: 1, t: now }); if (seen.size > 5000) seen.clear(); return true; }
  e.n++; return e.n <= 120;
}
export async function POST(req: NextRequest) {
  try {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
    const txt = await req.text().catch(() => '');
    const parsed = perfBeaconInput.parse(JSON.parse(txt || '{}'));
    if (!allowed(ip)) return NextResponse.json({ ok: true, n: 0, dropped: true });
    if (!(await currentUser().catch(() => null))) return NextResponse.json({ ok: false, n: 0, reason: 'login' });
    return NextResponse.json(await recordScreens(parsed));
  } catch (e) { return errorResponse(e, req); }
}
