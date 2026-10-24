'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, FolderKanban, FolderPlus, Star } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { useSession, canManage } from '@/components/session';
import { Avatar, BrandDot, Button, Empty, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, inputCls, toast } from '@/components/ui';
import { BrandSelect, UnitSelect, UserSelect } from '@/components/pickers';
import { useUrlState } from '@/components/urlState';

export default function Projects() {
  const { user, dir } = useSession();
  const [arch, setArch] = useUrlState('archived', ''); const archived = arch === '1'; const setArchived = (v: boolean) => setArch(v ? '1' : ''); // #242 2단계: 보관함 보기는 주소(?archived=1)에 — 프로젝트를 열었다 뒤로 와도 보관함
  const { data, error, loading, reload } = useApi<{ projects: any[] }>(`/api/projects${archived ? '?archived=1' : ''}`);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({});
  const sp = useSearchParams();
  const router = useRouter();
  useEffect(() => { if (sp.get('new') === '1' && canManage(user.role)) { setF({ ownerId: user.id }); setOpen(true); const p = new URLSearchParams(location.search); p.delete('new'); router.replace(`/projects${p.size ? `?${p}` : ''}`); } }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  async function toggleFav(e: React.MouseEvent, p: any) {
    e.preventDefault(); e.stopPropagation();
    try { await api(`/api/projects/${p.id}/favorite`, { method: p.favorite ? 'DELETE' : 'PUT' }); reload(); window.dispatchEvent(new Event('wos-favorites')); } catch (er: any) { toast.error(er.message); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try { const r = await api('/api/projects', { body: { ...f, orgUnitId: f.orgUnitId ?? dir.orgUnits[0]?.id } }); setOpen(false); router.push(`/projects/${r.id}`); } catch (er: any) { toast.error(er.message); }
  }
  return (
    <div className="space-y-4">
      <PageHeader title={archived ? '보관된 프로젝트' : '프로젝트'} actions={<>
        <Button variant="secondary" onClick={() => setArchived(!archived)}><Archive />{archived ? '진행 중 보기' : '보관함'}</Button>
        {canManage(user.role) && <Button onClick={() => { setF({ ownerId: user.id }); setOpen(true); }}><FolderPlus />프로젝트</Button>}
      </>} />
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Skeleton rows={4} /> : !data?.projects.length ? <Empty title="프로젝트가 없습니다" icon={FolderKanban}>{canManage(user.role) ? '오픈 준비·캠페인처럼 여러 업무를 묶을 때 프로젝트를 만드세요.' : '관리자가 만든 프로젝트가 여기에 표시됩니다.'}</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="group relative overflow-hidden rounded-card border border-line bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop">
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: p.color }} />
              <div className="flex items-start gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-input text-white" style={{ background: p.color }}><FolderKanban className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{p.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-2"><span className="truncate">{p.org_unit_name}</span><BrandDot brand={p.brand_id} /></div>
                </div>
                <button onClick={(e) => toggleFav(e, p)} aria-label={p.favorite ? `${p.name} 즐겨찾기 해제` : `${p.name} 즐겨찾기`} aria-pressed={p.favorite}
                  className={cx('rounded-md p-1 transition-colors hover:bg-slate-100', p.favorite ? 'text-amber-400' : 'text-slate-300 group-hover:text-slate-400')}>
                  <Star className="size-[18px]" fill={p.favorite ? 'currentColor' : 'none'} />
                </button>
              </div>
              <p className="mt-2 line-clamp-2 min-h-[2.5em] text-sm text-ink-2">{p.description || <span className="text-ink-3">설명 없음</span>}</p>
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-500" style={{ width: `${p.task_count ? (p.done_count / p.task_count) * 100 : 0}%` }} /></div>
                <span className="text-xs font-medium text-ink-2 tabular-nums">{p.done_count}/{p.task_count}</span>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-xs text-ink-2"><Avatar id={p.owner_id} name={p.owner_name} size={20} />{p.owner_name ?? '담당 없음'}</div>
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
