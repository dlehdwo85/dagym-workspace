import { handler } from '@/lib/api';
import { changesSince, latestId } from '@/lib/chat';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
/**
 * 실시간(SSE): 4초마다(CHAT_STREAM_INTERVAL_MS, 10/21 DB 쿼터 장애 뒤 2초 → 4초) 새 메시지·수정·입력 중·읽음을 확인해 보낸다. 서버 실행 시간 제한 때문에 약 50초 뒤 닫고,
 * 브라우저 EventSource 가 이어서 다시 연결한다(Last-Event-ID = 마지막 메시지 id). 실패하면 화면이 5초 폴링으로 바꾼다.
 */
export const GET = handler(async ({ req, user }) => {
  const enc = new TextEncoder();
  let since = req.headers.get('last-event-id') ?? req.nextUrl.searchParams.get('since') ?? '';
  if (!/^\d+$/.test(since)) since = await latestId();
  let t = new Date(Date.now() - 5000);
  const stop = Date.now() + Number(process.env.CHAT_STREAM_SECONDS ?? 50) * 1000;
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (ev: string, data: unknown, id?: string) => ctrl.enqueue(enc.encode(`${id ? `id: ${id}\n` : ''}event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
      send('ready', { since }, since);
      let lastTyping = '';
      let lastReads = '';
      while (Date.now() < stop && !req.signal.aborted) {
        try {
          const now = new Date();
          const c = await changesSince(user, since, t);
          t = now;
          for (const m of c.messages as any[]) if (BigInt(m.id) > BigInt(since)) since = m.id;
          if (c.messages.length) send('messages', c.messages, since);
          const ty = JSON.stringify(c.typing); if (ty !== lastTyping) { send('typing', c.typing); lastTyping = ty; }
          const rd = JSON.stringify(c.reads); if (rd !== lastReads) { send('reads', c.reads); lastReads = rd; }
          ctrl.enqueue(enc.encode(': ping\n\n'));
        } catch { break; }
        await new Promise((r) => setTimeout(r, Number(process.env.CHAT_STREAM_INTERVAL_MS ?? 4000)));
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
});
