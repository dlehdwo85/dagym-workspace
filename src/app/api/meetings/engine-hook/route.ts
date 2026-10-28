import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse } from '@/lib/api';
import { engineHook } from '@/lib/meetings';

/** 엔진(영상 중계 서버) 알림: 입장·퇴장·회의 끝 — 로그인 없음, 엔진 서명으로 확인(engine.ts) */
export async function POST(req: NextRequest) {
  try { return NextResponse.json(await engineHook(req)); } catch (e) { return errorResponse(e, req); }
}
