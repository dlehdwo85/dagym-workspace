import { handler, body } from '@/lib/api';
import { applyKwSuggestion, kwApplyInput } from '@/lib/sales/kwSuggest';

// 224차 #457 추천에서 고른 것만 반영(관리자)
export const POST = handler(async ({ req, user }) => applyKwSuggestion(user, await body(req, kwApplyInput)));
