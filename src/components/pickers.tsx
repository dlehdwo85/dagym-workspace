'use client';
import { useMemo } from 'react';
import { useSession } from './session';
import { inputCls } from './ui';
import { UNIT_TYPE_LABEL } from '@/lib/types';

export function UnitSelect({ value, onChange, allowEmpty, id }: { value: string | null | undefined; onChange: (v: string) => void; allowEmpty?: string; id?: string }) {
  const { dir } = useSession();
  const tree = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const byParent = new Map<string | null, typeof dir.orgUnits>();
    for (const u of dir.orgUnits) {
      const p = dir.orgUnits.some((x) => x.id === u.parent_id) ? u.parent_id : null;
      byParent.set(p, [...(byParent.get(p) ?? []), u]);
    }
    const walk = (p: string | null, depth: number) => {
      for (const u of byParent.get(p) ?? []) {
        out.push({ id: u.id, label: `${'　'.repeat(depth)}${u.name} (${UNIT_TYPE_LABEL[u.type as keyof typeof UNIT_TYPE_LABEL] ?? u.type})` });
        walk(u.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [dir.orgUnits]);
  return (
    <select id={id} className={inputCls} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
      {tree.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
    </select>
  );
}

export function UserSelect({ value, onChange, placeholder = '담당자 없음', id }: { value: string | null | undefined; onChange: (v: string | null) => void; placeholder?: string; id?: string }) {
  const { dir } = useSession();
  return (
    <select id={id} className={inputCls} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {dir.users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` · ${u.title}` : ''}</option>)}
    </select>
  );
}

export function MultiUserSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { dir } = useSession();
  return (
    <div className="flex flex-wrap gap-1.5">
      {value.map((id) => {
        const u = dir.users.find((x) => x.id === id);
        return (
          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">
            {u?.name ?? '알 수 없음'}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`${u?.name} 제거`} className="text-slate-500">✕</button>
          </span>
        );
      })}
      <select className="rounded-md border border-slate-300 px-2 py-0.5 text-xs" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} aria-label="사람 추가">
        <option value="">+ 추가</option>
        {dir.users.filter((u) => !value.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    </div>
  );
}

export function BrandSelect({ value, onChange }: { value: string | null | undefined; onChange: (v: string | null) => void }) {
  const { dir } = useSession();
  return (
    <select className={inputCls} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">브랜드 공통</option>
      {dir.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
}

export const RECUR_PRESETS: { label: string; rule: string | null }[] = [
  { label: '반복 안 함', rule: null },
  { label: '매일', rule: 'FREQ=DAILY' },
  { label: '평일(월~금)', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: '매주', rule: 'FREQ=WEEKLY' },
  { label: '2주마다', rule: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: '매월', rule: 'FREQ=MONTHLY' },
  { label: '매년', rule: 'FREQ=YEARLY' },
];

/** 반복 규칙 선택 (요일 지정이 필요한 주간 규칙은 시작일 요일을 쓴다) */
export function RecurSelect({ value, onChange, anchorDate }: { value: string | null; onChange: (v: string | null) => void; anchorDate?: string | null }) {
  const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const withDay = (rule: string | null) => {
    if (!rule || !anchorDate) return rule;
    const d = new Date(anchorDate + 'T00:00:00Z').getUTCDay();
    if (rule === 'FREQ=WEEKLY' || rule === 'FREQ=WEEKLY;INTERVAL=2') return `${rule};BYDAY=${days[d]}`;
    if (rule === 'FREQ=MONTHLY') return `${rule};BYMONTHDAY=${Number(anchorDate.slice(8, 10))}`;
    return rule;
  };
  const known = RECUR_PRESETS.find((p) => withDay(p.rule) === value || p.rule === value);
  return (
    <select className={inputCls} value={known ? known.label : '__custom'} onChange={(e) => {
      const p = RECUR_PRESETS.find((x) => x.label === e.target.value);
      if (p) onChange(withDay(p.rule));
    }}>
      {RECUR_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
      {!known && <option value="__custom">사용자 지정: {value}</option>}
    </select>
  );
}
