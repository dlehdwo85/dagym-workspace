import { type NextRequest } from 'next/server';
import { handleNotification } from '@/lib/billing';
import { logError } from '@/lib/log';

/** 나이스페이 결제통보(웹훅) — 성공 시 본문 "OK" */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  try { return new Response(await handleNotification(await req.text(), ip), { headers: { 'content-type': 'text/plain' } }); }
  catch (e) { await logError('nicepay-noti', e); return new Response('FAIL', { status: (e as { status?: number }).status ?? 500 }); }
}
