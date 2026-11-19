'use client';
import { Suspense } from 'react';
import { AgreementsHome } from '@/components/agreements/Agreements';

/** 계약 관리 1단계 — 맺은 계약서 보관·만료 알림(메뉴 권한 '계약 관리'). '전자계약'(서명 받는 도구)과는 따로 */
export default function AgreementsPage() { return <Suspense fallback={null}><AgreementsHome /></Suspense>; }
