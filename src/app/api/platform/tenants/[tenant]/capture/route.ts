import { handler, body, clientIp } from '@/lib/api';
import { setTenantCapture, tenantCaptureInput } from '@/lib/capturePolicy';

/** #626 플랫폼 운영 › 회사 상세 '화면 캡처 차단' — PUT {on, note?}(슈퍼관리자만, 끌 때 사유 → 감사 기록) */
export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setTenantCapture(user, params.tenant, await body(req, tenantCaptureInput), clientIp(req)));
