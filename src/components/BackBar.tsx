'use client';
// #429 (대표 10/22 23:15) 웹 하위 화면 뒤로가기: '← 이전 화면'(앱 안에서 옮겨 온 화면이 있으면 그곳, 처음 연 화면이면 정해 둔 화면) + 경로(결재 › 결재 설정 › 결재선)
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronRight } from 'lucide-react';

export type Crumb = { label: string; href?: string };
export function BackBar({ fallback, crumbs }: { fallback: string; crumbs?: Crumb[] }) {
  const router = useRouter();
  const back = () => { if (((window as any).__wosNav ?? 0) > 1 && window.history.length > 1) router.back(); else router.push(fallback); };
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="back-bar">
      <button type="button" onClick={back} className="inline-flex shrink-0 items-center gap-1 rounded-input py-1 text-ink-2 hover:text-ink" data-testid="back-link"><ArrowLeft className="size-4" />이전 화면</button>
      {!!crumbs?.length && (
        <nav aria-label="경로" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-ink-3" data-testid="breadcrumbs">
          {crumbs.map((c, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3 shrink-0" />}
              {c.href && i < crumbs.length - 1 ? <Link href={c.href} className="truncate hover:text-ink hover:underline">{c.label}</Link> : <span className={i === crumbs.length - 1 ? 'truncate font-medium text-ink-2' : 'truncate'}>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
    </div>
  );
}
