import { NextResponse } from 'next/server';
import { handler, body, clientIp } from '@/lib/api';
import { revealInput, revealMemo } from '@/lib/memos';

/** #1135 주요 메모 [보기]·[복사] — 본인 확인 10분 안에만, 고른 칸만, 열람 기록. 응답은 어디에도 저장되지 않게(no-store) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const out = await revealMemo(user, params.id, await body(req, revealInput), clientIp(req));
  return NextResponse.json(out, { headers: { 'cache-control': 'no-store, max-age=0', pragma: 'no-cache' } });
});
