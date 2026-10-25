import { handler, body } from '@/lib/api';
import { exampleFromInput, saveExampleFrom } from '@/lib/mktAuto';

/** #235 ⓔ [좋은 예시로 저장]: 승인·게시 글을 브랜드의 같은 형식 예시로({ note }) · { remove: true } = 예시에서 빼기 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => saveExampleFrom(user, params.id, await body(req, exampleFromInput)));
