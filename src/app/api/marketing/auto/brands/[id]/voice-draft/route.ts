import { handler } from '@/lib/api';
import { voiceDraft } from '@/lib/mktAuto';

export const maxDuration = 60;
/** #426 [잘 된 글로 말투 만들기]: 이 브랜드의 승인·게시 글로 말투 프로필 초안(저장 안 함 — 화면에서 고쳐 [저장]) */
export const POST = handler<{ id: string }>(async ({ user, params }) => voiceDraft(user, params.id));
