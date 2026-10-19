import { handler, body } from '@/lib/api';
import { importParseInput, parseContactsFile } from '@/lib/contacts';

/** 엑셀·CSV·vCard 파일(base64) → 머리글·줄·추측한 짝 */
export const POST = handler(async ({ req, user: _u }) => parseContactsFile(await body(req, importParseInput)));
