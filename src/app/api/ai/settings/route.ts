import { handler, body, clientIp } from '@/lib/api';
import { aiSettingsInput, setAiSettings } from '@/lib/ai/threads';

/** V14 2·5·6번: 보관 기간·1인 일 한도·입력 길이·업무 무관 차단 (메뉴 권한 "AI 사용 내역" 편집) */
export const PUT = handler(async ({ req, user }) => setAiSettings(user, await body(req, aiSettingsInput), clientIp(req)));
