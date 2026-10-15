import { handler, body, clientIp } from '@/lib/api';
import { deletionRequestInput, requestDeletion } from '@/lib/account';

/** 회사 계정 직원: 앱 설정 > 계정 > 계정 삭제 요청(회사 관리자·개인정보 담당에게) */
export const POST = handler(async ({ req, user }) => requestDeletion(user, await body(req, deletionRequestInput.partial({ email: true }).transform((v) => ({ ...v, email: v.email || user!.email }))), clientIp(req)));
