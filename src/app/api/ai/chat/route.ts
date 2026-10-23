import { after } from 'next/server';
import { handler, body, errorResponse } from '@/lib/api';
import { chat, chatInput } from '@/lib/ai/assistant';

export const maxDuration = 300;
// V22 문서 작업은 응답 뒤에 이어서 실행(화면은 카드에서 진행 확인). 끊기면 정기 실행이 다시 집어 간다
async function runDocJobs(jobs?: { id: string }[]) {
  if (!jobs?.length) return;
  const { processDocJob } = await import('@/lib/ai/docEngine');
  for (const j of jobs) await processDocJob(j.id);
}
export const POST = handler(async ({ req, user }) => {
  const input = await body(req, chatInput);
  if (!input.stream) {
    const r: any = await chat(user, input, undefined, req.signal); // 부록 A2: 화면이 요청을 끊으면 함께 멈춤
    if (r.docJobs?.length) after(() => runDocJobs(r.docJobs));
    return r;
  }
  // #497 R44: 답을 글자 단위로(SSE: data: {type: start|text|tools|done|error}). 사전 점검(한도·권한) 오류는 지금처럼 HTTP 오류로,
  // 대화가 시작된 뒤 오류는 'error' 이벤트로 보낸다
  let jobs: { id: string }[] | undefined;
  let finish!: () => void;
  const finished = new Promise<void>((r) => { finish = r; });
  after(async () => { await finished; await runDocJobs(jobs); });
  let opened!: (early?: unknown) => void;
  const ready = new Promise<unknown>((r) => { opened = r; });
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctl) {
      const send = (e: object) => { try { ctl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* 화면이 끊음 */ } };
      try {
        const r: any = await chat(user, input, undefined, req.signal, (e) => { opened(); send(e); });
        jobs = r.docJobs;
        opened();
        send({ type: 'done', ...r });
      } catch (e) {
        opened(e); // 시작 전이면 HTTP 오류로(아래), 시작 뒤면 이벤트로
        const res = errorResponse(e, req);
        const j = await res.json().catch(() => ({}));
        send({ type: 'error', status: res.status, code: j?.error?.code ?? 'error', message: j?.error?.message ?? '처리하지 못했습니다' });
      } finally {
        finish();
        try { ctl.close(); } catch { /* 이미 닫힘 */ }
      }
    },
  });
  const early = await ready;
  if (early) throw early;
  // no-transform: 압축(next start)이 조각을 모아 두지 않게
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' } });
});
