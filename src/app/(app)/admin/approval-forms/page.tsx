'use client';
// V30 ④ 결재 양식 편집 → #429 결재 설정 한 화면의 '양식' 탭(예전 주소 그대로 열림)
import { ApprovalSettings } from '@/components/ApprovalSettings';

export default function ApprovalFormsPage() {
  return <ApprovalSettings initialTab="forms" />;
}
