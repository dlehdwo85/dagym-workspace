import { handler, body } from '@/lib/api';
import { markPublished, publishInput } from '@/lib/marketing';

/** 게시 확인(주소 증거) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => markPublished(user, params.id, await body(req, publishInput)));
