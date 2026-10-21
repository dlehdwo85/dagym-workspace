import { handler, body } from '@/lib/api';
import { digestVideo, videoDigestInput } from '@/lib/ai/videoDigest';

/** 대표 10/20 17:00 (#109) 영상 첨부 → 프레임(≤20장)·음성 파일 id 를 받아 '영상 요약 + 할 일 제안' 을 만든다(영상 자체는 AI 에 안 보냄) */
export const maxDuration = 120;
export const POST = handler(async ({ req, user }) => digestVideo(user, await body(req, videoDigestInput)));
