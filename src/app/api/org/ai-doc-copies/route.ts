import { handler, clientIp } from '@/lib/api';
import { db } from '@/lib/db';
import { audit } from '@/lib/log';
import { requireMenu } from '@/lib/menuPerms';
import { tenantOf } from '@/lib/types';
import { docCopiesLeft, purgeDocCopies } from '@/lib/ai/docEngine';

/**
 * 문서 만들기가 예전에 AI 회사(Anthropic) 파일 보관소에 남겨 둔 사본 — 몇 개 남았는지(GET) · 지우기(POST, 한 번에 100개).
 * 11/20부터 새 작업은 끝날 때 스스로 지운다. 예전 것은 지우는 일이라 자동으로 하지 않고 'AI 사용 내역' 편집 권한이 있는 사람(기본 대표)이 누를 때만. 우리 저장소의 원본은 그대로.
 */
export const GET = handler(async ({ user }) => { await requireMenu(user, 'ai_logs', 'view'); return docCopiesLeft(tenantOf(user)); });
export const POST = handler(async ({ req, user }) => {
  await requireMenu(user, 'ai_logs', 'edit');
  const r = await purgeDocCopies(tenantOf(user));
  await audit(db(), user.id, 'ai.doc_copies_purge', 'tenant', null, { removed: r.removed, failed: r.failed, left: r.left }, clientIp(req));
  return r;
});
