import { handler, clientIp } from '@/lib/api';
import { signInfo } from '@/lib/contracts';

/** #116 서명 링크(로그인 없음): 코드 입력 전 안내(회사·제목·가려진 이름) */
export const GET = handler<{ token: string }>(async ({ req, params }) => signInfo(params.token, clientIp(req), req.headers.get('user-agent')), { public: true });
