import { handler, body, clientIp } from '@/lib/api';
import { listTemplates, saveTemplate, templateInput } from '@/lib/contracts';

/** #116 계약 서식: 기본 2종(근로계약서·비밀유지서약서) + 회사 서식 · 저장(사용자 관리 편집 권한) */
export const GET = handler(async ({ user }) => listTemplates(user));
export const POST = handler(async ({ req, user }) => saveTemplate(user, null, await body(req, templateInput), clientIp(req)));
