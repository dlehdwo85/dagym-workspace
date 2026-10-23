import { handler, body } from '@/lib/api';
import { deleteManual, detailView, editManual, manualPatch } from '@/lib/sales/support';

/** #450 지원사업 공고 상세(원문 요약·첨부·1차 규칙·AI 판단·진행·업무) — 공용 공고 또는 우리 회사가 넣은 공고만(다른 회사 것은 404) */
export const GET = handler<{ id: string }>(async ({ user, params }) => detailView(user, params.id));
/** 직접 넣은 공고 고치기·지우기(넣은 사람·관리자) */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => editManual(user, params.id, await body(req, manualPatch)));
export const DELETE = handler<{ id: string }>(async ({ user, params }) => deleteManual(user, params.id));
