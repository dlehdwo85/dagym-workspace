'use client';
// 대표 11/19 #1070: 화상회의를 일정 없이 바로 — 업무 탭의 작은 [회의] 단추(자리를 많이 차지하지 않게).
// 누르면 창 → [바로 회의 시작] = 즉석 회의를 만들고(POST /api/meetings kind instant) 회의 주소를 보여 줌 → [회의 들어가기] · [주소 복사] · [공유].
// 화상회의가 꺼진 회사(features.meetings 없음)에는 단추가 없다. 주소를 받은 사람은 설치 없이 들어오고, 외부 손님은 대기실에서 기다린다(218차 그대로).
import { useState } from 'react';
import { Copy, Loader2, Share2, Video } from 'lucide-react';
import { api } from '@/components/client';
import { shareLink } from '@/components/native';
import { useSession } from '@/components/session';
import { Button, Modal, cx, toast } from '@/components/ui';

type Made = { id: string; code: string; url: string; title: string };

export function QuickMeetingButton({ className }: { className?: string }) {
  const { features } = useSession();
  const [open, setOpen] = useState(false);
  const [m, setM] = useState<Made | null>(null);
  const [busy, setBusy] = useState(false);
  if (!features.meetings) return null;
  async function start() {
    setBusy(true);
    try { setM(await api<Made>('/api/meetings', { body: { kind: 'instant' } })); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function copy() {
    if (!m) return;
    try { await navigator.clipboard.writeText(m.url); toast.ok('회의 주소를 복사했습니다'); } catch { toast.error('복사하지 못했습니다 — 주소를 길게 눌러 복사해 주세요'); }
  }
  async function share() {
    if (!m) return;
    const data = { title: '워크인 화상회의', text: '워크인 화상회의에 들어오세요(설치 없이 주소만 누르면 됩니다)', url: m.url };
    try { if (!(await shareLink(data))) await copy(); } // 공유 창이 없는 브라우저(PC)는 복사로
    catch (e: any) { if (e?.name !== 'AbortError' && !/cancel/i.test(String(e?.message ?? ''))) await copy(); }
  }
  const close = () => { setOpen(false); setM(null); };
  const path = m ? new URL(m.url, location.origin).pathname : '';
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="회의하러 가기" aria-label="회의하러 가기" data-testid="quick-meeting-open"
        className={cx('inline-flex items-center gap-1 rounded-input border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink-2 shadow-card hover:border-brand-600 hover:text-brand-700', className)}>
        <Video className="size-4" />회의
      </button>
      <Modal open={open} onClose={close} title="회의하러 가기">
        <div className="space-y-3 text-sm" data-testid="quick-meeting">
          {!m ? (
            <>
              <p className="text-ink-2">일정을 만들지 않고 지금 바로 화상회의를 엽니다. 주소를 받은 사람은 설치 없이 들어오고, 회사 밖 손님은 대기실에서 기다렸다가 허락하면 들어옵니다.</p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={close}>닫기</Button>
                <Button onClick={start} disabled={busy} data-testid="quick-meeting-start">{busy ? <Loader2 className="animate-spin" /> : <Video />}바로 회의 시작</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-ink-2">회의를 만들었습니다. 함께할 사람에게 아래 주소를 보내 주세요.</p>
              <div className="flex min-w-0 items-center gap-1.5 rounded-input border border-line bg-slate-50 px-2.5 py-2">
                <span className="min-w-0 flex-1 select-all break-all font-mono text-xs text-ink" data-testid="quick-meeting-url">{m.url}</span>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={copy} data-testid="quick-meeting-copy"><Copy />주소 복사</Button>
                <Button variant="secondary" onClick={share} data-testid="quick-meeting-share"><Share2 />공유</Button>
                <a href={path} className="inline-flex h-9 items-center gap-1.5 rounded-input bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700" data-testid="quick-meeting-enter"><Video className="size-4" />회의 들어가기</a>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
