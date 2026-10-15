import { after } from 'next/server';
import { handler, body } from '@/lib/api';
import { chat, chatInput } from '@/lib/ai/assistant';

export const maxDuration = 300;
export const POST = handler(async ({ req, user }) => {
  const r: any = await chat(user, await body(req, chatInput), undefined, req.signal); // 부록 A2: 화면이 요청을 끊으면 함께 멈춤
  // V22 문서 작업은 응답 뒤에 이어서 실행(화면은 카드에서 진행 확인). 끊기면 정기 실행이 다시 집어 간다
  if (r.docJobs?.length) after(async () => { const { processDocJob } = await import('@/lib/ai/docEngine'); for (const j of r.docJobs) await processDocJob(j.id); });
  return r;
});
