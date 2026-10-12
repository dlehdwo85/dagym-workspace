'use client';
import { useState } from 'react';
import { CalendarHeart, Plus, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, Field, PageHeader, fmtDate, inputCls, toast } from '@/components/ui';

/** B-17 공휴일 관리 — 기본 목록(2026~2027)을 넣어 두었고, 정부 발표(임시공휴일·선거일 등)에 맞춰 관리자가 고칩니다 */
export default function HolidaysPage() {
  const year = new Date().getFullYear();
  const { data, reload } = useApi<{ holidays: { date: string; name: string }[] }>(`/api/holidays?from=${year}-01-01&to=${year + 1}-12-31`);
  const [f, setF] = useState({ date: '', name: '' });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { await api(`/api/holidays/${f.date}`, { method: 'PUT', body: { name: f.name } }); toast.ok('저장했습니다'); setF({ date: '', name: '' }); reload(); } catch (er: any) { toast.error(er.message); }
  }
  async function remove(d: string) {
    if (!confirm(`${fmtDate(d)} 공휴일을 지울까요?`)) return;
    try { await api(`/api/holidays/${d}`, { method: 'DELETE' }); reload(); } catch (er: any) { toast.error(er.message); }
  }
  return (
    <div className="space-y-4">
      <PageHeader title="공휴일" icon={CalendarHeart} sub="캘린더에 빨간 날로 표시되고 업무량의 가용 근무일 계산에 쓰입니다. 임시공휴일은 발표되면 여기에 추가하세요." />
      <form onSubmit={save} className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-white p-4 shadow-card">
        <Field label="날짜"><input type="date" className={inputCls} required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="이름" className="min-w-[200px] flex-1"><input className={inputCls} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 임시공휴일" /></Field>
        <Button type="submit"><Plus />추가·변경</Button>
      </form>
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="holidays">
        {data?.holidays.map((h) => (
          <li key={h.date} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="w-32 font-medium tabular-nums text-red-600">{fmtDate(h.date)}</span><span className="flex-1">{h.name}</span>
            <button onClick={() => remove(h.date)} className="rounded p-1 text-ink-3 hover:bg-red-50 hover:text-red-600" aria-label={`${h.name} 삭제`}><Trash2 className="size-4" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}
