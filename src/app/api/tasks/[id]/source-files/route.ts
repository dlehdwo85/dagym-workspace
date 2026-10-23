import { handler } from '@/lib/api';
import { attachTaskSourceFiles } from '@/lib/sales/autoAttach';

/** #507 업무 상세 [공고 파일 붙이기]: 공고·지원사업에서 넘어온 업무에 원천 첨부를 받아 붙임(이미 붙은 것은 건너뜀, 실패는 설명에 한 줄) */
export const POST = handler<{ id: string }>(async ({ user, params }) => attachTaskSourceFiles(user, params.id));
