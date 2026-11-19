'use client';
import { use } from 'react';
import { RoundScreen } from '@/components/check/CheckRun';

/** 점검 2단계 — 점검 1회 화면: 코스 순서대로 항목을 보며 양호 · 보완 필요 · 해당 없음 + 메모 + 사진 → 끝내기(보완 요청) */
export default function CheckRoundPage({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <RoundScreen id={id} />; }
