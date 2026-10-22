'use client';
// #429 결재 설정 한 화면(결재선 | 양식 | 팀별 배정) — ?tab=lines|forms|assign
import { useSearchParams } from 'next/navigation';
import { ApprovalSettings } from '@/components/ApprovalSettings';

export default function ApprovalSettingsPage() {
  const t = useSearchParams().get('tab');
  return <ApprovalSettings initialTab={t === 'forms' || t === 'assign' ? t : 'lines'} />;
}
