'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { useSession, canManage } from '@/components/session';
import { BrandDot, Button, Empty, ErrorBox, Field, Loading, Modal, inputCls, toast } from '@/components/ui';
import { BrandSelect, UnitSelect, UserSelect } from '@/components/pickers';

export default function Projects() {
  const { user, dir } = useSession();
  const [archived, setArchived] = useState(false);
  const { data, error, loading, reload } = useApi<{ projects: any[] }>(`/api/projects${archived ? '?archived=1' : ''}`);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({});
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try { const r = await api('/api/projects', { body: { ...f, orgUnitId: f.orgUnitId ?? dir.orgUnits[0]?.id } }); setOpen(false); location.href = `/projects/${r.id}`; } catch (er: any) { toast.error(er.message); }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">프로젝트</h1>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setArchived(!archived)}>{archived ? '진행 중 보기' : '보관함'}</Button>
          {canManage(user.role) && <Button size="sm" onClick={() => { setF({ ownerId: user.id }); setOpen(true); }}>+ 프로젝트</Button>}
        </div>
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Loading /> : !data?.projects.length ? <Empty title="프로젝트가 없습니다">{canManage(user.role) ? '+ 프로젝트로 시작하세요.' : '관리자가 만든 프로젝트가 여기에 표시됩니다.'}</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="rounded-lg border bg-white p-4 hover:border-brand-500">
              <div className="flex items-center gap-2"><span className="h-3 w-3 rounded" style={{ background: p.color }} /><span className="font-semibold">{p.name}</span></div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{p.description}</p>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><span>{p.org_unit_name}</span><BrandDot brand={p.brand_id} /><span>담당 {p.owner_name ?? '-'}</span></div>
              <div className="mt-2 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${p.task_count ? (p.done_count / p.task_count) * 100 : 0}%` }} /></div>
              <div className="mt-1 text-right text-xs text-slate-500">{p.done_count}/{p.task_count} 완료</div>
            </Link>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="프로젝트 만들기">
        <form onSubmit={create} className="space-y-3">
          <Field label="이름"><input className={inputCls} required value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="설명"><textarea className={inputCls} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="소속"><UnitSelect value={f.orgUnitId ?? dir.orgUnits[0]?.id} onChange={(v) => setF({ ...f, orgUnitId: v })} /></Field>
            <Field label="브랜드"><BrandSelect value={f.brandId} onChange={(v) => setF({ ...f, brandId: v })} /></Field>
            <Field label="프로젝트 담당"><UserSelect value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} /></Field>
            <Field label="색"><input type="color" className="h-9 w-full rounded border" value={f.color ?? '#2563eb'} onChange={(e) => setF({ ...f, color: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>취소</Button><Button type="submit">만들기</Button></div>
        </form>
      </Modal>
    </div>
  );
}
