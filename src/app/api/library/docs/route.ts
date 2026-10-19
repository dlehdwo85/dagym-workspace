import { handler, body } from '@/lib/api';
import { createDoc, docCreateInput } from '@/lib/libDocs';

/** 새 워크인 문서(공동 편집) */
export const POST = handler(async ({ req, user }) => createDoc(user, await body(req, docCreateInput)));
