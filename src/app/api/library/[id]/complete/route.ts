import { z } from 'zod';
import { after } from 'next/server';
import { handler, body } from '@/lib/api';
import { completeLibraryFile } from '@/lib/library';
import { logError } from '@/lib/log';

export const maxDuration = 120; // 올린 뒤 자동 정리(AI) + #161 매출 자료면 숫자 읽기(응답 뒤 after)
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const r = await completeLibraryFile(user, params.id, (await body(req, z.object({ uploadId: z.string().max(400).optional() }).default({})).catch(() => ({ uploadId: undefined as string | undefined }))).uploadId);
  // #161 V25: 매출 자료(매출 근거·정산 폴더, 이름·본문에 매출·정산…)면 '확인 대기' 1건 + 숫자 읽기 — 올리기 응답은 기다리지 않음
  after(async () => { try { await (await import('@/lib/revenueAuto')).onLibraryReady(user, params.id); } catch (e) { await logError('revenue:detect', e, { fileId: params.id }); } });
  return r;
});
