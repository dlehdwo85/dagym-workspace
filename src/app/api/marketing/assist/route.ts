import { handler, body } from '@/lib/api';
import { captionAssist, captionInput } from '@/lib/marketing';

export const maxDuration = 120; // 대표 10/24 ①: 캡션 초안도 글 모델(최상 모델 30~60초)

/** 마케팅 AI 비서: 캡션 초안 3개 + 해시태그(게시는 승인 대기를 거쳐 사람이) */
export const POST = handler(async ({ req, user }) => captionAssist(user, await body(req, captionInput)));
