import { handler, body } from '@/lib/api';
import { parseFile, parseInput } from '@/lib/taskImport';

/** V30 ① 파일(base64) → 머리글·줄·추측한 열 짝 */
export const POST = handler(async ({ req }) => parseFile(await body(req, parseInput)));
