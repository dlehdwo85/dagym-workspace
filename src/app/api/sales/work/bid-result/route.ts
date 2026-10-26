import { body, handler } from '@/lib/api';
import { bidResultInput, setBidResult } from '@/lib/sales/bidTasks';

/** 결정 15-35: 입찰 업무 결과 [낙찰]·[미낙찰]·[유찰] — 사람이 넣거나 자동 판정을 바로잡음(낙찰이면 계약 기록·계약 업무) */
export const POST = handler(async ({ req, user }) => setBidResult(user, await body(req, bidResultInput)));
