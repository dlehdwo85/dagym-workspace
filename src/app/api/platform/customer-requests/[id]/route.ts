import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { requestDetail, updateInput, updateRequest } from '@/lib/customerRequests';

/** #1175 요청 한 건 — GET 상세(묶인 요청·기록) · PATCH {category?, status?, ownerId?, reply?, groupInto?} */
export const GET = handler<{ id: string }>(async ({ user, params }) => requestDetail(user, z.string().uuid().parse(params.id)));
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateRequest(user, z.string().uuid().parse(params.id), await body(req, updateInput), clientIp(req)));
