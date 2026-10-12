'use client';
import { useState } from 'react';
import { Workflow } from 'lucide-react';
import { AutomationRules } from '@/components/Automations';
import { useSession, canManage, isAdminRole } from '@/components/session';
import { ErrorBox, Field, PageHeader, fmtDateTime } from '@/components/ui';
import { UnitSelect } from '@/components/pickers';
import { useApi } from '@/components/client';

/** B-10 조직·전사 자동화 규칙 (프로젝트 규칙은 프로젝트 화면의 "자동화" 탭) */
export default function AutomationsPage() {
  const { user } = useSession();
  const admin = isAdminRole(user.role);
  const [unit, setUnit] = useState('');
  const runs = useApi<{ runs: any[] }>('/api/automations');
  if (!canManage(user.role)) return <ErrorBox error={{ status: 403, message: '자동화 규칙은 현장 관리자 이상이 관리합니다.' }} />;
  return (
    <div className="space-y-5">
      <PageHeader title="자동화" icon={Workflow} sub="조직(현장·부서) 단위 또는 전사 규칙입니다. 프로젝트 전용 규칙은 프로젝트 화면의 자동화 탭에서 만듭니다." />
      <Field label="적용 범위" className="max-w-sm">
        <UnitSelect value={unit} onChange={setUnit} allowEmpty={admin ? '전사 (모든 조직)' : '조직을 선택하세요'} />
      </Field>
      {admin || unit ? <AutomationRules key={unit} orgUnitId={unit || undefined} canEdit /> : <p className="text-sm text-ink-2">규칙을 볼 조직을 선택하세요.</p>}
      <section>
        <h2 className="mb-2 text-sm font-semibold">최근 실행 기록</h2>
        <ul className="divide-y divide-line rounded-card border border-line bg-white text-sm shadow-card">
          {(runs.data?.runs ?? []).slice(0, 30).map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2">
              <span className={r.status === 'ok' ? 'text-emerald-600' : 'text-red-600'}>{r.status === 'ok' ? '성공' : '실패'}</span>
              <span className="font-medium">{r.rule_name}</span><span className="flex-1 truncate text-ink-2">{r.task_title}</span>
              <span className="text-xs text-ink-3">{fmtDateTime(r.created_at)}</span>
            </li>
          ))}
          {!runs.data?.runs.length && <li className="px-4 py-6 text-center text-ink-3">아직 실행된 규칙이 없습니다</li>}
        </ul>
      </section>
    </div>
  );
}
