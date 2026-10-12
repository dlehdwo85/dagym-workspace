'use client';
import { use } from 'react';
import { api, useApi } from '@/components/client';
import { TaskViews } from '@/components/TaskViews';
import { Button, ErrorBox, Loading, toast } from '@/components/ui';
import { useSession, canManage } from '@/components/session';

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useSession();
  const { data, error, loading, reload } = useApi<any>(`/api/projects/${id}`);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  const p = data.project;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-white p-4">
        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded" style={{ background: p.color }} /><h1 className="text-lg font-bold">{p.name}</h1>
          {p.archived && <span className="rounded bg-slate-200 px-1.5 text-xs">보관됨</span>}
          <span className="flex-1" />
          {!p.limited && canManage(user.role) && <Button size="sm" variant="ghost" onClick={async () => { try { await api(`/api/projects/${id}`, { method: 'PATCH', body: { archived: !p.archived } }); reload(); } catch (e: any) { toast.error(e.message); } }}>{p.archived ? '보관 해제' : '보관'}</Button>}
        </div>
        <p className="mt-1 text-sm text-slate-600">{p.description}</p>
        <p className="mt-1 text-xs text-slate-500">{p.org_unit_name} · 담당 {p.owner_name ?? '-'}{p.limited && ' · 내게 배정된 업무만 표시됩니다'}</p>
      </div>
      <TaskViews fixed={{ projectId: id }} title="프로젝트 업무" defaultMode="board" />
    </div>
  );
}
