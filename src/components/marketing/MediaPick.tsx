'use client';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { useApi } from '@/components/client';
import { Button, cx, inputCls } from '@/components/ui';

/** 자료실에서 시안(이미지·영상) 고르기 — 볼 수 있는 자료만 */
export function MediaPick({ value, onChange, label = '자료실에서 시안 고르기' }: { value: { id: string; title: string }[]; onChange: (v: { id: string; title: string }[]) => void; label?: string }) {
  const [q, setQ] = useState(''); const [query, setQuery] = useState(''); const [open, setOpen] = useState(false);
  const res = useApi<{ files: { id: string; title: string; file_name: string; mime_type: string; vision?: { faces?: boolean } | null }[] }>(open ? `/api/library?limit=30&space=marketing&q=${encodeURIComponent(query)}` : null, [query, open]);
  return (
    <div className="space-y-1.5" data-testid="media-pick">
      <div className="flex flex-wrap gap-1.5">
        {value.map((m) => <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-800">{m.title}<button type="button" onClick={() => onChange(value.filter((x) => x.id !== m.id))} aria-label={`${m.title} 빼기`}>×</button></span>)}
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((x) => !x)} data-testid="media-pick-open">{label}</Button>
      </div>
      {open && (
        <div className="rounded-input border border-line p-2">
          <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="flex gap-1.5"><input className={cx(inputCls, 'py-1')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="파일 이름" aria-label="시안 검색" /><Button size="sm" type="submit" variant="secondary"><Search />찾기</Button></form>
          <ul className="mt-1 max-h-40 overflow-y-auto text-sm">{(res.data?.files ?? []).map((f) => (
            <li key={f.id}><button type="button" className="w-full truncate rounded px-2 py-1 text-left hover:bg-slate-50" onClick={() => { if (!value.some((x) => x.id === f.id)) onChange([...value, { id: f.id, title: f.title || f.file_name }]); }}>{f.title || f.file_name}{f.vision?.faces && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800" title="얼굴이 나온 실사 — 촬영·게시 동의 확인" data-testid="pick-faces">얼굴 · 동의 확인</span>}</button></li>))}
            {res.data && !res.data.files.length && <li className="px-2 py-1 text-xs text-ink-3">마케팅 자료실에 자료가 없습니다 — 먼저 올려 주세요</li>}</ul>
        </div>
      )}
    </div>
  );
}
