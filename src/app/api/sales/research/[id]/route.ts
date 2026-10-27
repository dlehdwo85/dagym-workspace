import { body, handler } from '@/lib/api';
import { researchInput, saveResearch } from '@/lib/sales/research';

/** 212차 #612: 시설 하나의 조사 결과(현 위탁사·계약만료일·관리사무소 번호·메모) — 모두 비우면 '확인 못함' */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => saveResearch(user, Number(params.id), await body(req, researchInput)));
