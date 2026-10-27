import { z } from 'zod';
import { after } from 'next/server';
import { handler, body } from '@/lib/api';
import { completeLibraryFile, framesInput } from '@/lib/library';
import { logError } from '@/lib/log';

export const maxDuration = 120; // 올린 뒤 자동 정리(AI) + #161 매출 자료면 숫자 읽기(응답 뒤 after)
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  // 210차 #619: frames = 영상 장면 사진 2장(화면이 뽑음) — 자동 정리가 무엇을 찍은 영상인지 봄
  const b = await body(req, z.object({ uploadId: z.string().max(400).optional(), frames: framesInput }).default({})).catch(() => ({ uploadId: undefined as string | undefined, frames: undefined as string[] | undefined }));
  const r = await completeLibraryFile(user, params.id, b.uploadId, b.frames);
  // #161 V25: 매출 자료(매출 근거·정산 폴더, 이름·본문에 매출·정산…)면 '확인 대기' 1건 + 숫자 읽기 — 올리기 응답은 기다리지 않음
  after(async () => { try { await (await import('@/lib/revenueAuto')).onLibraryReady(user, params.id); } catch (e) { await logError('revenue:detect', e, { fileId: params.id }); } });
  return r;
});
