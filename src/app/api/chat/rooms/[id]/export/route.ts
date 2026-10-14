import { handler, clientIp } from '@/lib/api';
import { exportRoom } from '@/lib/chat';

/** 대표만: 감사 목적 내보내기 (CSV) */
export const GET = handler<{ id: string }>(async ({ req, user, params }) =>
  new Response('﻿' + (await exportRoom(user, params.id, clientIp(req))), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="chat-${params.id}.csv"` } }));
