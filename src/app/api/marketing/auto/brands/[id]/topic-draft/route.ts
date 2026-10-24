import { handler } from '@/lib/api';
import { topicDraft } from '@/lib/mktAuto';

export const maxDuration = 120; // 만드는 일은 글 모델(최상 모델 30~60초)
/** 로컬 QA 10/24 ③ [AI로 주제 20개 제안]: 브랜드 주제 풀 초안(저장 안 함 — 화면에서 고쳐 [저장]) */
export const POST = handler<{ id: string }>(async ({ user, params }) => topicDraft(user, params.id));
