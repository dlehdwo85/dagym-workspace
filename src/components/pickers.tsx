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

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** 시작(기준)일로부터 반복 프리셋 규칙을 만든다 */
export function recurPresets(anchorDate?: string | null): { label: string; rule: string | null }[] {
  const d = anchorDate ? new Date(anchorDate + 'T00:00:00Z') : null;
  const dow = d ? d.getUTCDay() : 1;
  const dom = d ? d.getUTCDate() : 1;
  const nth = Math.ceil(dom / 7);
  const last = d ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() - dom < 7 : false;
  const list: { label: string; rule: string | null }[] = [
    { label: '반복 안 함', rule: null },
    { label: '매일', rule: 'FREQ=DAILY' },
    { label: '평일(월~금)', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    { label: `매주 ${DAY_KO[dow]}요일`, rule: `FREQ=WEEKLY;BYDAY=${DAY_CODES[dow]}` },
    { label: `2주마다 ${DAY_KO[dow]}요일`, rule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${DAY_CODES[dow]}` },
    { label: `매월 ${dom}일`, rule: `FREQ=MONTHLY;BYMONTHDAY=${dom}` },
  ];
  if (nth <= 4) list.push({ label: `매월 ${nth}번째 ${DAY_KO[dow]}요일`, rule: `FREQ=MONTHLY;BYDAY=${nth}${DAY_CODES[dow]}` });
  if (last) list.push({ label: `매월 마지막 ${DAY_KO[dow]}요일`, rule: `FREQ=MONTHLY;BYDAY=-1${DAY_CODES[dow]}` });
  list.push({ label: '매년', rule: 'FREQ=YEARLY' });
  return list;
}

/** 규칙을 (기본 규칙, 종료 조건)으로 나눈다. UNTIL 은 서울 날짜로 바꾼다 */
export function splitRule(rule: string | null): { base: string | null; until: string | null; count: number | null } {
  if (!rule) return { base: null, until: null, count: null };
  let until: string | null = null, count: number | null = null;
  const parts = rule.split(';').filter((p) => {
    const m = /^UNTIL=(\d{8})(T(\d{6})Z?)?$/i.exec(p);
    if (m) {
      const iso = m[2] ? `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[3].slice(0, 2)}:${m[3].slice(2, 4)}:${m[3].slice(4, 6)}Z` : `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T00:00:00+09:00`;
      until = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso));
      return false;
    }
    const c = /^COUNT=(\d+)$/i.exec(p);
    if (c) { count = Number(c[1]); return false; }
    return true;
  });
  return { base: parts.join(';'), until, count };
}

/** 종료일(서울 날짜)은 그날 23:59:59 KST = 14:59:59Z 의 UTC UNTIL 로 저장 */
export function joinRule(base: string | null, end: { until?: string | null; count?: number | null }) {
  if (!base) return null;
  if (end.until) return `${base};UNTIL=${end.until.replace(/-/g, '')}T145959Z`;
  if (end.count) return `${base};COUNT=${end.count}`;
  return base;
}

/** 반복 편집기: 프리셋 + 종료 조건(계속·날짜까지·횟수) */
export function RecurSelect({ value, onChange, anchorDate }: { value: string | null; onChange: (v: string | null) => void; anchorDate?: string | null }) {
  const presets = recurPresets(anchorDate);
  const { base, until, count } = splitRule(value);
  const known = presets.find((p) => p.rule === base);
  const endKind = until ? 'until' : count ? 'count' : 'none';
  const setBase = (b: string | null) => onChange(joinRule(b, { until, count }));
  return (
    <div className="space-y-1.5" data-testid="recur-editor">
      <select className={inputCls} value={known ? known.label : '__custom'} aria-label="반복 규칙" onChange={(e) => {
        const p = presets.find((x) => x.label === e.target.value);
        if (p) setBase(p.rule);
      }}>
        {presets.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
        {!known && <option value="__custom">사용자 지정: {base}</option>}
      </select>
      {base && (
        <div className="flex items-center gap-1.5 text-sm">
          <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={endKind} aria-label="반복 종료" onChange={(e) => {
            const k = e.target.value;
            if (k === 'none') onChange(joinRule(base, {}));
            else if (k === 'until') onChange(joinRule(base, { until: anchorDate ? addMonths(anchorDate, 3) : null }));
            else onChange(joinRule(base, { count: 10 }));
          }}>
            <option value="none">계속 반복</option><option value="until">종료일까지</option><option value="count">횟수 지정</option>
          </select>
          {endKind === 'until' && <input type="date" className="rounded-md border border-slate-300 px-2 py-1 text-sm" aria-label="반복 종료일" min={anchorDate ?? undefined} value={until ?? ''} onChange={(e) => onChange(joinRule(base, { until: e.target.value || null }))} />}
          {endKind === 'count' && <><input type="number" min={1} max={500} className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm" aria-label="반복 횟수" value={count ?? 10} onChange={(e) => onChange(joinRule(base, { count: Math.max(1, Number(e.target.value) || 1) }))} /><span>회</span></>}
        </div>
      )}
    </div>
  );
}

function addMonths(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCMonth(t.getUTCMonth() + n);
  return t.toISOString().slice(0, 10);
}

const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
export function fmtReminder(m: number) {
  if (m === 0) return '시작 시각';
  if (m % 1440 === 0) return `${m / 1440}일 전`;
  if (m % 60 === 0) return `${m / 60}시간 전`;
  return `${m}분 전`;
}

/** 일정별 알림: null = 각자 기본 설정, 배열 = 이 일정만의 알림(최대 5개, 빈 배열 = 알림 없음) */
export function ReminderEditor({ value, onChange }: { value: number[] | null; onChange: (v: number[] | null) => void }) {
  return (
    <div className="space-y-1.5 text-sm" data-testid="reminder-editor">
      <label className="flex items-center gap-2"><input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : [30])} />각자 기본 알림 설정 따르기</label>
      {value !== null && (
        <div className="flex flex-wrap items-center gap-1.5">
          {value.map((m) => (
            <span key={m} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">
              {fmtReminder(m)}<button type="button" aria-label={`${fmtReminder(m)} 알림 삭제`} onClick={() => onChange(value.filter((x) => x !== m))}>✕</button>
            </span>
          ))}
          {value.length < 5 && (
            <select className="rounded-md border border-slate-300 px-2 py-0.5 text-xs" value="" aria-label="알림 추가" onChange={(e) => e.target.value !== '' && onChange([...value, Number(e.target.value)].sort((a, b) => a - b))}>
              <option value="">+ 알림 추가</option>
              {REMINDER_CHOICES.filter((c) => !value.includes(c)).map((c) => <option key={c} value={c}>{fmtReminder(c)}</option>)}
            </select>
          )}
          {value.length === 0 && <span className="text-xs text-slate-500">이 일정은 알림을 보내지 않습니다</span>}
        </div>
      )}
    </div>
  );
}
