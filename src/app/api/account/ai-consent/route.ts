import { handler, body, clientIp } from '@/lib/api';
import { aiConsentInput, aiConsentOf, setAiConsent } from '@/lib/ai/consent';

/** AI 동의(대표 11/19 — 애플 5.1.2): 내 동의 상태 보기 · 동의/거부(설정에서 언제든 바꿈) */
export const GET = handler(async ({ user }) => aiConsentOf(user.id));
export const PUT = handler(async ({ req, user }) => setAiConsent(user, await body(req, aiConsentInput), clientIp(req)));
