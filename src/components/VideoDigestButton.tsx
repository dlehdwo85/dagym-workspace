'use client';
import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Modal, cx, toast } from './ui';
import { runVideoDigest, type VideoDigestResult } from './videoDigest';

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
/**
 * 대표 10/20 17:00 (#109) 마케팅 시안 영상 검토 공용 버튼 — 자료실 영상(fileId)을 받아 브라우저에서 장면·음성만 뽑아 AI 요약(review 모드: 자막 오타·브랜드 톤·구성).
 * 승인함 카드·콘텐츠 상세에서 쓴다. 영상 자체는 AI 에 보내지 않는다.
 */
export function VideoDigestButton({ fileId, title, mode = 'review', className }: { fileId: string; title: string; mode?: 'summary' | 'review'; className?: string }) {
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<VideoDigestResult | null>(null);
  async function run() {
    if (status) return;
    setStatus('영상 내려받는 중…');
    try {
      const r = await fetch(`/api/library/${fileId}/download?inline=1`);
      if (!r.ok) throw new Error('영상을 열지 못했습니다');
      const blob = await r.blob();
      const d = await runVideoDigest(blob, fileId, { mode, onStatus: setStatus });
      setResult(d);
    } catch (e: any) { toast.error(`AI 영상 검토 실패: ${e.message}`); }
    finally { setStatus(''); }
  }
  const d = result?.digest;
  return (
    <>
      <button type="button" onClick={run} disabled={!!status} className={cx('mt-1 inline-flex h-7 items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 text-[11px] font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-60', className)} title="장면·음성만 AI 에 보내 요약과 검토 의견을 받습니다(영상 원본은 안 보냄)" data-testid="video-digest-btn">
        {status ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}{status || (mode === 'review' ? 'AI 영상 검토' : 'AI 영상 요약')}
      </button>
      <Modal open={!!result} onClose={() => setResult(null)} title={`AI 영상 ${mode === 'review' ? '검토' : '요약'} — ${title}`}>
        {d && (
          <div className="space-y-3 text-sm" data-testid="video-digest-result">
            <p className="text-xs text-ink-3">장면 {d.frames}장{d.duration ? ` · 길이 ${mmss(d.duration)}` : ''}{d.transcript ? ' · 음성 녹취 있음' : d.sttNote ? ` · ${d.sttNote}` : ''}</p>
            <p className="whitespace-pre-wrap">{d.summary}</p>
            {d.review.length > 0 && <div><b className="font-semibold">검토 의견</b><ul className="mt-1 list-disc space-y-0.5 pl-5">{d.review.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
            {d.scenes.length > 0 && <div><b className="font-semibold">장면</b><ul className="mt-1 space-y-0.5 text-xs text-ink-2">{d.scenes.map((s, i) => <li key={i}><span className="mr-1 font-mono">{mmss(s.t)}</span>{s.text}</li>)}</ul></div>}
            {d.todos.length > 0 && <div><b className="font-semibold">할 일 후보</b><ul className="mt-1 list-disc space-y-0.5 pl-5">{d.todos.map((t, i) => <li key={i}>{t.title}{t.due ? ` (기한 ${t.due})` : ''} — <span className="text-ink-2">{t.detail}</span></li>)}</ul></div>}
            {d.transcript && <details className="text-xs"><summary className="cursor-pointer text-ink-2">음성 녹취</summary><p className="mt-1 whitespace-pre-wrap text-ink-2">{d.transcript}</p></details>}
            <p className="text-[11px] text-ink-3">요약은 영상 파일의 본문으로 저장되어 자료실 검색·AI 비서 첨부에 쓰입니다. 할 일로 만들려면 AI 비서에 이 영상을 첨부해 요청하세요.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
