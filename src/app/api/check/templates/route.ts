import { handler, body } from '@/lib/api';
import { installInput, installTemplate, listTemplates } from '@/lib/check/install';

/** 점검 템플릿: 넣을 수 있는 목록(설치 여부) · 업종 템플릿 더 넣기(가이드 편집 권한) */
export const GET = handler(async ({ user }) => listTemplates(user));
export const POST = handler(async ({ req, user }) => installTemplate(user, await body(req, installInput)));
