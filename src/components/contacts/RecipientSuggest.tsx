'use client';
// V31 ② 받는 사람 자동 완성: 이름·회사·번호·이메일 일부 → 같은 업무에 연결된 고객 맨 위 → 최근 보낸 사람 → 직원(내부 표시). 고르면 번호/이메일이 들어간다.
import { useEffect, useRef, useState } from 'react';
import { Building2, UserRound } from 'lucide-react';
import { api } from '@/components/client';
import { cx, inputCls } from '@/components/ui';

export type Suggestion = { id: string; kind: 'contact' | 'employee'; name: string; organization: string | null; title: string | null; phone: string | null; email: string | null; linked: boolean; recent: boolean };

/** q 가 바뀌면 200ms 뒤 /api/contacts/suggest — 빈 q 는 taskId 가 있을 때만(이 업무에 연결된 사람) */
export function useRecipientSuggest(q: string, kind: 'phone' | 'email' | 'any', taskId?: string | null, enabled = true) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    if (!enabled || (!q.trim() && !taskId)) { setItems([]); return; }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ suggestions: Suggestion[] }>(`/api/contacts/suggest?q=${encodeURIComponent(q.trim())}&kind=${kind}${taskId ? `&taskId=${taskId}` : ''}`);
        if (n === seq.current) setItems(r.suggestions);
      } catch { if (n === seq.current) setItems([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [q, kind, taskId, enabled]);
  return items;
}

/** 드롭다운 목록(입력창 아래) */
export function SuggestList({ items, kind, onPick, active, testId }: { items: Suggestion[]; kind: 'phone' | 'email' | 'any'; onPick: (s: Suggestion) => void; active?: number; testId?: string }) {
  if (!items.length) return null;
  return (
    <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-card border border-line bg-white py-1 text-sm shadow-lg" role="listbox" data-testid={testId ?? 'recipient-suggest'}>
      {items.map((s, i) => {
        const value = kind === 'email' ? s.email : kind === 'phone' ? s.phone : s.phone ?? s.email;
        return (
          <li key={`${s.kind}:${s.id}`} role="option" aria-selected={i === active} data-testid="suggest-item"
            className={cx('flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50', i === active && 'bg-brand-50')}
            onMouseDown={(e) => e.preventDefault() /* 입력창 포커스 유지(blur 로 닫히지 않게) */}
            onClick={(e) => { e.preventDefault(); /* Field 의 <label> 안이라 기본 동작(첫 번째 버튼·입력에 클릭 전달)을 막는다 */ onPick(s); }}>
            {s.kind === 'employee' ? <UserRound className="size-3.5 shrink-0 text-ink-3" /> : <Building2 className="size-3.5 shrink-0 text-ink-3" />}
            <span className="min-w-0 flex-1 truncate"><b>{s.name}</b>{s.title && <span className="text-ink-2"> {s.title}</span>}{s.organization && <span className="text-ink-3"> · {s.organization}</span>}</span>
            <span className="shrink-0 text-xs tabular-nums text-ink-2">{value}</span>
            {s.linked && <span className="shrink-0 rounded bg-brand-50 px-1 text-[10px] font-medium text-brand-700">이 업무</span>}
            {s.kind === 'employee' && <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-ink-3">직원</span>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 번호·이메일 한 줄 입력 + 자동 완성. value 는 그대로 문자열(여러 명은 쉼표) — 기존 화면·시험과 호환.
 * multi 면 마지막 항목(마지막 쉼표 뒤)만 바뀐다.
 */
export function SuggestInput({ value, onChange, kind, taskId, testId, placeholder, className, multi, disabled, ariaLabel, inputMode }: {
  value: string; onChange: (v: string) => void; kind: 'phone' | 'email'; taskId?: string | null; testId?: string; placeholder?: string; className?: string; multi?: boolean; disabled?: boolean; ariaLabel?: string; inputMode?: 'tel' | 'email';
}) {
  const [focus, setFocus] = useState(false);
  const [active, setActive] = useState(-1);
  const [picked, setPicked] = useState(false); // 고른 직후에는 다시 칠 때까지 목록을 닫는다
  const parts = multi ? value.split(/[,;]/) : [value];
  const draft = (parts[parts.length - 1] ?? '').trim();
  const items = useRecipientSuggest(draft, kind, taskId, focus && !disabled && !picked && draft.length >= 1);
  const pick = (s: Suggestion) => {
    const v = (kind === 'email' ? s.email : s.phone) ?? '';
    if (!v) return;
    const head = multi ? parts.slice(0, -1).map((x) => x.trim()).filter(Boolean) : [];
    onChange([...head.filter((x) => x !== v), v].join(', ')); setActive(-1); setPicked(true);
  };
  return (
    <div className="relative">
      <input className={cx(inputCls, className)} value={value} onChange={(e) => { onChange(e.target.value); setActive(-1); setPicked(false); }} placeholder={placeholder} disabled={disabled} aria-label={ariaLabel} inputMode={inputMode ?? (kind === 'phone' ? 'tel' : 'email')} autoComplete="off"
        data-testid={testId} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 120)}
        onKeyDown={(e) => {
          if (!items.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); }
          else if (e.key === 'Escape') setFocus(false);
        }} />
      {focus && <SuggestList items={items} kind={kind} onPick={pick} active={active} testId={testId ? `${testId}-suggest` : undefined} />}
    </div>
  );
}
