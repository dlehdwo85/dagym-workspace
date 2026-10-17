import { handler, body } from '@/lib/api';
import { brandInput, createBrand, listBrands } from '@/lib/marketing';

export const GET = handler(async ({ user }) => listBrands(user));
export const POST = handler(async ({ req, user }) => createBrand(user, await body(req, brandInput)));
