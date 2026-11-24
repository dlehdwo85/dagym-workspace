import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { myLocation, withdrawLocation } from '@/lib/attendance';

/** D-18 ①: 내 위치 동의 상태·위치정보 이용·제공 기록(최근 6개월) · POST {withdraw: true} = 동의 철회(내 출퇴근 좌표 바로 파기) */
export const GET = handler(async ({ user }) => myLocation(user));
export const POST = handler(async ({ req, user }) => { await body(req, z.object({ withdraw: z.literal(true) })); return withdrawLocation(user, clientIp(req)); });
