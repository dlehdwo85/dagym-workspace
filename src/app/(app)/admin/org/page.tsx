'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, ErrorBox, Field, Loading, Modal, cx, inputCls, toast } from '@/components/ui';
import { HIDDEN_BRANDS, UNIT_TYPE_LABEL } from '@/lib/types';

export default function Org() {
  const { dir } = useSession();
  const { data, error, loading, reload } = useApi<{ units: any[] }>('/api/admin/org-units');
  const [f, setF] = useState<any>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body = { name: f.name, type: f.type, parentId: f.parentId || null, brandId: f.brandId || null, active: f.active };
      if (f.id) await api(`/api/admin/org-units/${f.id}`, { method: 'PATCH', body }); else await api('/api/admin/org-units', { body });
      toast.ok('저장했습니다. 메뉴의 조직 목록은 새로고침 후 반영됩니다.'); setF(null); reload();
    } catch (er: any) { toast.error(er.message); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  const units = data!.units;
  const render = (parent: string | null, depth: number): any[] => units.filter((u) => u.parent_id === parent).flatMap((u) => [
    <li key={u.id} className={cx('flex items-center gap-2 py-1.5 text-sm', !u.active && 'text-slate-400')} style={{ paddingLeft: depth * 20 }}>
      <span className="rounded bg-slate-100 px-1.5 text-xs">{UNIT_TYPE_LABEL[u.type as keyof typeof UNIT_TYPE_LABEL]}</span>
      <span className="font-medium">{u.name}</span>
      {u.brand_id && <span className="text-xs text-slate-500">{dir.brands.find((b) => b.id === u.brand_id)?.name}</span>}
      <span className="text-xs text-slate-400">구성원 {u.member_count}</span>
      {!u.active && <span className="text-xs">(비활성)</span>}
      <span className="flex-1" />
      <Button size="sm" variant="ghost" onClick={() => setF({ type: 'site', parentId: u.id, brandId: u.brand_id, active: true })}>+ 하위</Button>
      <Button size="sm" variant="ghost" onClick={() => setF({ id: u.id, name: u.name, type: u.type, parentId: u.parent_id, brandId: u.brand_id, active: u.active })}>편집</Button>
    </li>,
    ...render(u.id, depth + 1),
  ]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">조직 구성</h1>
        <Button onClick={() => setF({ type: 'department', parentId: units.find((u) => u.type === 'hq')?.id, active: true })}>+ 조직 추가</Button>
      </div>
      <p className="text-sm text-slate-500">본사 → 부서, 브랜드별 지점·위탁운영 현장을 구성합니다. 조직마다 공유 캘린더가 자동으로 만들어집니다. 직원은 소속 조직과 그 하위 조직의 업무만 볼 수 있습니다.</p>
      <ul className="divide-y rounded-lg border bg-white px-3" data-testid="org-tree">{render(null, 0)}</ul>
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? '조직 편집' : '조직 추가'}>
        {f && <form onSubmit={save} className="space-y-3">
          <Field label="이름"><input className={inputCls} required value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="유형"><select className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(UNIT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="브랜드"><select className={inputCls} value={f.brandId ?? ''} onChange={(e) => setF({ ...f, brandId: e.target.value })}><option value="">공통</option>{dir.brands.filter((b) => !HIDDEN_BRANDS.includes(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          </div>
          <Field label="상위 조직"><select className={inputCls} value={f.parentId ?? ''} onChange={(e) => setF({ ...f, parentId: e.target.value })}><option value="">(최상위)</option>{units.filter((u) => u.id !== f.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          {f.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />사용 중</label>}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setF(null)}>취소</Button><Button type="submit">저장</Button></div>
        </form>}
      </Modal>
    </div>
  );
}
