import { handler } from '@/lib/api';
import { meetPublic } from '@/lib/meetings';

/** 회의 주소를 연 사람(로그인 없어도): 회사 이름·회의 이름·상태만 */
export const GET = handler<{ code: string }>(async ({ user, params }) => meetPublic(params.code, user), { public: true });
