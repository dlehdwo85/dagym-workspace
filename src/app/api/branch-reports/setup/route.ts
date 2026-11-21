import { body, clientIp, handler } from '@/lib/api';
import { branchSetup, saveBranchSetup, setupInput } from '@/lib/branchReport';

/** #1096 보고 지점 목록(관리자): 이름·숨김·작성 담당·검토 담당 — 기능 안의 별도 목록(다짐 조직 단위는 건드리지 않음) */
export const GET = handler(async ({ user }) => branchSetup(user));
export const PUT = handler(async ({ req, user }) => saveBranchSetup(user, await body(req, setupInput), clientIp(req)));
