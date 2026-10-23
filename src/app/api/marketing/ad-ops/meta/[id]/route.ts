import { handler, body } from '@/lib/api';
import { metaAutoInput, updateMetaPlan } from '@/lib/metaAuto';

/** 세팅안 고치기(Meta 에 초안을 만들기 전·실패 뒤) */
export const PUT = handler<{ id: string }>(async ({ req, user, params }) => updateMetaPlan(user, params.id, await body(req, metaAutoInput)));
