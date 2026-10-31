import { body, handler } from '@/lib/api';
import { createMaterial, listMaterials, materialInput } from '@/lib/mktMaterials';

/** 296차 #836 자료 요청: 목록(?status=requested|received|used|canceled|all) · 만들기(관리자) */
export const GET = handler(async ({ req, user }) => listMaterials(user, { status: req.nextUrl.searchParams.get('status') ?? undefined }));
export const POST = handler(async ({ req, user }) => createMaterial(user, await body(req, materialInput)));
