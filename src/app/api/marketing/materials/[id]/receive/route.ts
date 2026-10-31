import { body, handler } from '@/lib/api';
import { receiveInput, receiveMaterial } from '@/lib/mktMaterials';

/** 296차 #836 자료 요청: 올린 파일(자료실 id)을 붙여 '받음' → 브랜드 폴더 · 사진 설명 · 단색 표지 글 다시 그리기(응답 뒤) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => receiveMaterial(user, params.id, await body(req, receiveInput)));
