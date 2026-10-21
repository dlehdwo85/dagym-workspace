import { handler, body } from '@/lib/api';
import { listRules, ruleInput, upsertRule } from '@/lib/assignees';

/** 대표 10/20 15:00 (#100) 담당자 지정: 규칙 목록(선택지 포함) · 규칙 저장(관리자) */
export const GET = handler(async ({ user }) => listRules(user));
export const PUT = handler(async ({ req, user }) => upsertRule(user, await body(req, ruleInput)));
