import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { feedPreview } from '@/lib/mktAutoVisual';
import { feedInput } from '@/lib/mktFeedTemplates';

export const maxDuration = 60;
/** #544 브랜드 키트 [피드 틀 미리보기]: 저장 전 값으로 틀마다 한 장(저장·자료실 기록 없음) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => feedPreview(user, params.id, await body(req, z.object({ feed: feedInput.optional(), all: z.boolean().optional() }))));
