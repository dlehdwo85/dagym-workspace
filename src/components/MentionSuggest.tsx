'use client';
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { Avatar, cx } from './ui';

/**
 * 300차 #851(로컬 10/31 16:40 대표 요청): 댓글 @멘션은 입력창 자동완성 하나로.
 * '@'를 치면 이 업무를 볼 수 있는 사람 목록 — 첫 줄이 기본 선택 · ↑↓로 옮기고 Enter·Tab 으로 고름 · Esc 로 닫음 · 마우스·손가락으로도 고름
 * 한글 입력 중(조합 중) Enter 는 글자 확정에 쓰이므로 건드리지 않음 · 맨 위 '@전체' = 이 업무를 볼 수 있는 사람 모두(서버가 알림)
 */
export type MentionUser = { id: string; name: string; title?: string | null };
export const MENTION_ALL: MentionUser = { id: 'all', name: '전체' };

export function useMention(o: { value: string; set: (v: string) => void; users: MentionUser[]; meId: string; onPick: (u: MentionUser) => void; focus?: () => void }) {
  const [active, setActive] = useState(0);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const m = /(^|\s)@([^\s@]*)$/.exec(o.value);
  const q = m ? m[2] : null;
  const others = o.users.filter((u) => u.id !== o.meId);
  const list: MentionUser[] = q === null || closedAt === o.value ? [] : [
    ...(others.length > 1 && '전체'.startsWith(q) ? [MENTION_ALL] : []),
    ...others.filter((u) => u.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6),
  ];
  useEffect(() => { setActive(0); }, [q]);
  const pick = (u: MentionUser) => {
    o.set(o.value.replace(/@[^\s@]*$/, `@${u.name} `));
    o.onPick(u);
    if (o.focus) setTimeout(o.focus, 0);
  };
  /** 입력칸 onKeyDown 맨 앞에서 부름 — 목록이 열려 있고 처리했으면 true */
  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!list.length) return false;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return false; // 한글 조합 중 Enter = 글자 확정
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % list.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + list.length) % list.length); return true; }
    if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); pick(list[Math.min(active, list.length - 1)]); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setClosedAt(o.value); return true; }
    return false;
  };
  return { list, active, setActive, pick, onKeyDown, total: others.length };
}

export function MentionList({ m, label, testId, className }: { m: ReturnType<typeof useMention>; label: string; testId: string; className?: string }) {
  if (!m.list.length) return null;
  return (
    <ul role="listbox" aria-label={label} className={cx('absolute bottom-full z-20 mb-1 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-line bg-white shadow-pop', className)} data-testid={testId}>
      {m.list.map((u, i) => (
        <li key={u.id}>
          <button type="button" role="option" aria-selected={i === m.active} data-active={i === m.active || undefined}
            className={cx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm', i === m.active ? 'bg-accent-50 text-ink' : 'hover:bg-slate-50')}
            onMouseDown={(e) => e.preventDefault() /* 입력칸 초점 유지 */} onMouseEnter={() => m.setActive(i)} onClick={() => m.pick(u)}>
            {u.id === MENTION_ALL.id
              ? <><span className="flex size-5 items-center justify-center rounded-full bg-slate-100 text-ink-2"><Users className="size-3.5" /></span><span className="font-medium">@전체</span><span className="text-xs text-ink-3">이 업무를 볼 수 있는 {m.total}명 모두</span></>
              : <><Avatar id={u.id} name={u.name} size={20} badge={false} />{u.name}{u.title && <span className="truncate text-xs text-ink-3">{u.title}</span>}</>}
          </button>
        </li>
      ))}
    </ul>
  );
}
