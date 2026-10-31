import { body, handler } from '@/lib/api';
import { materialPatch, patchMaterial } from '@/lib/mktMaterials';

/** 296차 #836 자료 요청: 취소·다시 요청·담당·기한(관리자 또는 담당) */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => patchMaterial(user, params.id, await body(req, materialPatch)));
