'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, ErrorBox, Field, Loading, Modal, inputCls, toast } from '@/components/ui';
import { UnitSelect, UserSelect } from '@/components/pickers';
import { PRIORITY_LABEL } from '@/lib/types';
import { describeRule } from '@/lib/recurrence';

export default function Templates() {
  const router = useRouter();
  const { user, dir } = useSession();
  const { data, error, loading, reload } = useApi<{ templates: any[] }>('/api/templates');
  const [use, setUse] = useState<any>(null);
  const [f, setF] = useState<any>({});
  async function apply(e: React.FormEvent) {
    e.preventDefault();
    try { const r = await api(`/api/templates/${use.id}/apply`, { body: { ...f, dueDate: f.dueDate || undefined } }); toast.ok('템플릿으로 업무를 만들었습니다'); router.push(`/tasks/${r.id}`); } catch (er: any) { toast.error(er.message); }
  }
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">업무 템플릿</h1>
      <p className="text-sm text-slate-500">자주 하는 업무를 복사해 바로 시작합니다. 업무 상세 화면의 “템플릿으로 저장”으로 새 템플릿을 만들 수 있습니다(현장 관리자 이상).</p>
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Loading /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="templates">
          {data!.templates.map((t) => (
            <div key={t.id} className="flex flex-col rounded-lg border bg-white p-4">
              <div className="font-semibold">{t.name}</div>
              <p className="text-xs text-slate-500">{t.description}</p>
              <ul className="mt-2 flex-1 list-disc pl-4 text-xs text-slate-600">{(t.payload.checklist ?? []).slice(0, 5).map((c: string) => <li key={c}>{c}</li>)}{(t.payload.checklist?.length ?? 0) > 5 && <li>외 {t.payload.checklist.length - 5}개</li>}</ul>
              <div className="mt-2 text-xs text-slate-500">우선순위 {PRIORITY_LABEL[(t.payload.priority ?? 'normal') as keyof typeof PRIORITY_LABEL]}{t.payload.dueInDays !== undefined && ` · 마감 +${t.payload.dueInDays}일`}{t.payload.recurrence && ` · ${describeRule(t.payload.recurrence)}`}{t.org_unit_name ? ` · ${t.org_unit_name} 전용` : ' · 전사'}</div>
              <Button size="sm" className="mt-3" onClick={() => { setUse(t); setF({ title: t.payload.title, assigneeId: user.id, orgUnitId: dir.users.find((u) => u.id === user.id)?.org_unit_ids?.[0] ?? dir.orgUnits[0]?.id }); }}>이 템플릿으로 업무 만들기</Button>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!use} onClose={() => setUse(null)} title={`템플릿: ${use?.name ?? ''}`}>
        <form onSubmit={apply} className="space-y-3">
          <Field label="업무 제목"><input className={inputCls} value={f.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="담당자"><UserSelect value={f.assigneeId} onChange={(v) => setF({ ...f, assigneeId: v })} /></Field>
            <Field label="마감일 (비우면 기본값)"><input type="date" className={inputCls} value={f.dueDate ?? ''} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          </div>
          <Field label="소속"><UnitSelect value={f.orgUnitId} onChange={(v) => setF({ ...f, orgUnitId: v })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setUse(null)}>취소</Button><Button type="submit">만들기</Button></div>
        </form>
      </Modal>
    </div>
  );
}
