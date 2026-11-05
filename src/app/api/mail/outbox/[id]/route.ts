import { handler } from '@/lib/api';
import { getSent } from '@/lib/sentMail';

/** 375차 #997 보낸 메일 한 줄 — 본문 전체·받는 사람 전체·첨부·오류 (남의 줄은 관리자만, 다른 회사는 404) */
export const GET = handler<{ id: string }>(async ({ user, params }) => getSent(user, params.id));
