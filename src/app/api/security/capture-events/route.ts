import { handler, body, clientIp } from '@/lib/api';
import { captureEventInput, recordCaptureEvent } from '@/lib/capturePolicy';

/** #626 화면이 감지한 캡처·인쇄·자동화 사건 기록(종류·경로만, 10분 1건) — 회사 관리자·플랫폼 운영의 감사 기록에 남는다 */
export const POST = handler(async ({ req, user }) => recordCaptureEvent(user, await body(req, captureEventInput), clientIp(req)));
