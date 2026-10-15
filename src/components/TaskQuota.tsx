'use client';
import { useState } from 'react';
import { Archive, Download, ListChecks } from 'lucide-react';
import { api } from './client';
import { Meter } from './usage';
import { Button, inputCls, toast } from './ui';

/** V29 3장 업무 총량(완료·휴지통 포함) — 90% 안내, 다 차면 새 업무만 멈춤. 오래된 완료 업무를 보관 파일(CSV)로 내려받고 정리 */
export function TaskQuota({ used, limit, canEdit, onChanged }: { used: number; limit: number; canEdit: boolean; onChanged: () => void }) {
  const d = new Date(); d.setMonth(d.getMonth() - 3);
  const [before, setBefore] = useState(d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }));
  const [preview, setPreview] = useState<{ count: number } | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const pct = limit ? used / limit : 0;
  async function check() {
    try { setPreview(await api(`/api/usage/tasks-cleanup?before=${before}`)); setDownloaded(false); } catch (e: any) { toast.error(e.message); }
  }
  async function apply() {
    if (!confirm(`${before} 전에 완료한 업무 ${preview!.count}개를 정리할까요? 목록·휴지통에서 빠지고 되살릴 수 없습니다(보관 파일에 남음).`)) return;
    try { const r = await api('/api/usage/tasks-cleanup', { body: { before } }); toast.ok(`${r.purged}개 정리했습니다`); setPreview(null); onChanged(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="task-quota">
      <Meter label="업무 수(완료·휴지통 포함)" icon={ListChecks} used={used} limit={limit} usedLabel={`${used.toLocaleString('ko-KR')}개`} limitLabel={`${limit.toLocaleString('ko-KR')}개`} testid="meter-tasks" />
      {pct >= 0.9 && <p className="mt-2 rounded-input bg-amber-50 p-2 text-xs text-amber-800" data-testid="task-quota-warn">{used >= limit ? '한도에 닿아 새 업무를 만들 수 없습니다(보기·완료·삭제·내보내기는 됩니다).' : `한도의 ${Math.floor(pct * 100)}% 입니다.`} 오래된 완료 업무를 보관 파일로 내보내고 정리하면 다시 여유가 생깁니다. 휴지통 업무는 30일 뒤 자동으로 빠집니다.</p>}
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
          <label className="text-xs text-ink-2">이 날짜 전에 완료한 업무<input type="date" className={inputCls + ' mt-0.5 h-9 w-40'} value={before} onChange={(e) => { setBefore(e.target.value); setPreview(null); }} aria-label="정리 기준 날짜" /></label>
          <Button size="sm" variant="secondary" onClick={check} data-testid="cleanup-check">개수 보기</Button>
          {preview && (preview.count === 0 ? <span className="text-xs text-ink-3">정리할 완료 업무가 없습니다</span> : <>
            <a href={`/api/usage/tasks-cleanup?before=${before}&format=csv`} onClick={() => setDownloaded(true)} className="inline-flex h-8 items-center gap-1 rounded-input border border-line px-2.5 text-xs font-medium hover:bg-slate-50" data-testid="cleanup-download"><Download className="size-3.5" />보관 파일 내려받기({preview.count}개)</a>
            <Button size="sm" onClick={apply} disabled={!downloaded} title={downloaded ? '' : '보관 파일을 먼저 내려받으세요'} data-testid="cleanup-apply"><Archive />정리</Button>
          </>)}
        </div>
      )}
    </section>
  );
}
