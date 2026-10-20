import { body, handler } from '@/lib/api';
import { alarmResultInput, recordAlarmResult } from '@/lib/alarm';

/** 로컬 10/20: 기기 로컬 예약 알람의 [해제]/[10분 뒤] 결과 기록(알림 '활동' 탭) — 미루기 재예약은 기기가 한다 */
export const POST = handler(async ({ req, user }) => recordAlarmResult(user, await body(req, alarmResultInput)));
