import { handler } from '@/lib/api';
import { libraryPreview } from '@/lib/library';

/** 336차: 자료실 고르기 창 미리보기 — 본문 앞부분(권한은 자료 열기와 같음, 기밀은 열람 기록) */
export const GET = handler<{ id: string }>(async ({ user, params }) => libraryPreview(user, params.id));
