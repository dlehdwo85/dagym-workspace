'use client';
// B-9 결재선 관리 → #429 결재 설정 한 화면의 '결재선' 탭(예전 주소 그대로 열림)
import { ApprovalSettings } from '@/components/ApprovalSettings';

export default function ApprovalLinesPage() {
  return <ApprovalSettings initialTab="lines" />;
}
