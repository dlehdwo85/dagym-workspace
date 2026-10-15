'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, FileSpreadsheet, FileText, Library, Loader2, Presentation, Wand2 } from 'lucide-react';
import { api } from './client';
import { Button, cx, toast } from './ui';

type Job = { id: string; title: string; kind: string; mode: string; version: number; status: 'queued' | 'running' | 'done' | 'failed'; pages: number | null; summary: string | null; error: string | null;
  resultName: string | null; resultSize: number | null; hasFile: boolean; hasPreview: boolean; savedFileId: string | null; costUsd: number };
const ICON: Record<string, typeof FileText> = { xlsx: FileSpreadsheet, pptx: Presentation };

/**
 * V22 문서 작업 카드 — 만드는 중(1~3분, 자동 새로 고침) → 첫 페이지 미리보기·요약·쪽수 → [내려받기] [자료실에 저장] [더 다듬기] · 버전(v1·v2…)
 * 자료실 저장은 사람이 누를 때만(AI 가 저장하지 않음).
 */
export function DocJobCard({ id, onRefine }: { id: string; onRefine?: (text: string) => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [versions, setVersions] = useState<{ id: string; version: number; status: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stop = false, t: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const r = await api<{ job: Job; versions: any[] }>(`/api/ai/doc-jobs/${id}`);
        if (stop) return;
        setJob(r.job); setVersions(r.versions);
        if (r.job.status === 'queued' || r.job.status === 'running') t = setTimeout(load, 3000);
      } catch { if (!stop) t = setTimeout(load, 6000); }
    };
    load();
    return () => { stop = true; clearTimeout(t); };
  }, [id]);
  async function save() {
    setBusy(true);
    try { const r = await api(`/api/ai/doc-jobs/${id}/save`, { body: {} }); setJob((j) => j && { ...j, savedFileId: r.fileId }); toast.ok('자료실 "AI 문서"에 저장했습니다'); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const Icon = ICON[job?.kind ?? ''] ?? FileText;
  const working = !job || job.status === 'queued' || job.status === 'running';
  return (
    <div className="mt-1.5 w-full max-w-sm overflow-hidden rounded-input border border-line bg-white text-ink" data-testid="doc-job" data-status={job?.status ?? 'loading'}>
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 text-sm">
        <Icon className="size-4 shrink-0 text-brand-600" />
        <span className="min-w-0 flex-1 truncate font-semibold">{job?.title ?? '파일 작업'}</span>
        {job && <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-ink-2">v{job.version}</span>}
        {job?.pages ? <span className={cx('rounded-full px-1.5 text-[11px] font-medium', job.pages > 1 ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700')}>{job.pages}쪽</span> : null}
      </div>
      {working ? (
        <p className="flex items-center gap-2 px-2.5 py-3 text-sm text-ink-2" data-testid="doc-job-working"><Loader2 className="size-4 animate-spin" />만드는 중… (1~3분, 미리보기를 확인하며 다듬는 중)</p>
      ) : job.status === 'failed' ? (
        <p className="px-2.5 py-3 text-sm text-red-700">만들지 못했습니다: {job.error ?? '오류'}</p>
      ) : (
        <>
          {job.hasPreview && <a href={`/api/ai/doc-jobs/${id}/preview`} target="_blank" rel="noreferrer"><img src={`/api/ai/doc-jobs/${id}/preview`} alt={`${job.title} 첫 페이지 미리보기`} className="max-h-72 w-full border-b border-line bg-slate-50 object-contain" data-testid="doc-job-preview" /></a>}
          {job.summary && <p className="whitespace-pre-wrap px-2.5 py-2 text-xs text-ink-2">{job.summary}</p>}
          <div className="flex flex-wrap gap-1.5 px-2.5 pb-2.5">
            {job.hasFile && <a href={`/api/ai/doc-jobs/${id}/file`} className="inline-flex h-8 items-center gap-1 rounded-input bg-brand-600 px-2.5 text-xs font-semibold text-white hover:bg-brand-700" data-testid="doc-job-download"><Download className="size-3.5" />내려받기</a>}
            {job.hasFile && (job.savedFileId
              ? <Link href={`/library?file=${job.savedFileId}`} className="inline-flex h-8 items-center gap-1 rounded-input border border-green-300 px-2.5 text-xs font-medium text-green-700"><Library className="size-3.5" />자료실에 저장됨</Link>
              : <Button size="sm" variant="secondary" onClick={save} disabled={busy} data-testid="doc-job-save"><Library />자료실에 저장</Button>)}
            {onRefine && job.hasFile && <Button size="sm" variant="ghost" onClick={() => onRefine(`「${job.title}」 v${job.version}을 `)} data-testid="doc-job-refine"><Wand2 />더 다듬기</Button>}
          </div>
          {versions.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 border-t border-line px-2.5 py-1.5 text-[11px] text-ink-3" data-testid="doc-job-versions">버전
              {versions.map((v) => <a key={v.id} href={v.status === 'done' ? `/api/ai/doc-jobs/${v.id}/file` : undefined} className={cx('rounded px-1.5 py-0.5', v.id === id ? 'bg-brand-50 font-semibold text-brand-700' : 'hover:bg-slate-100')}>v{v.version}</a>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
