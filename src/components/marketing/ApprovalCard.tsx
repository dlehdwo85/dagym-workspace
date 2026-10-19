'use client';
import { useState } from 'react';
import { api } from '@/components/client';
import { Button, cx, inputCls, toast } from '@/components/ui';

/** 운영실 화면 명세(OPS_ROOM_SCREEN_SPEC 2-2·5절)에 맞춘 승인 카드·라벨 — 승인함·현황이 같이 씀 */
const KIND: Record<string, string> = { feed: '피드', blog: '블로그', reels: '릴스', video: '쇼츠' };
const CH: Record<string, string> = { instagram: '인스타', facebook: '페이스북', threads: '스레드', blog: '네이버 블로그', youtube: '유튜브', naver_place: '네이버 플레이스', other: '기타' };
/** 채널+형식 라벨: 인스타 피드 · 네이버 블로그 · 인스타 릴스 · 유튜브 쇼츠 */
export const channelLabel = (channel: string, kind?: string | null) => (channel === 'blog' ? '네이버 블로그' : `${CH[channel] ?? channel}${kind && kind !== 'blog' ? ` ${KIND[kind] ?? ''}` : ''}`.trim());
export const formatLabel = (channel: string, kind?: string | null) => (kind ? KIND[kind] ?? kind : channel === 'blog' ? '블로그' : '피드');
/** 상태 색: 주황 = 대표 할 일 · 파랑 = 진행 · 초록 = 완료 · 빨강 = 실패/지연 · 회색 = 기타 */
export const STATUS_CHIP: Record<string, [string, string]> = {
  pending: ['승인 대기', 'bg-orange-50 text-orange-800 border-orange-200'], changes: ['수정 요청', 'bg-slate-100 text-ink-2 border-line'], hold: ['보류', 'bg-slate-100 text-ink-2 border-line'],
  approved: ['승인됨', 'bg-sky-50 text-sky-800 border-sky-200'], published: ['게시됨', 'bg-emerald-50 text-emerald-800 border-emerald-200'], draft: ['초안', 'bg-slate-100 text-ink-2 border-line'],
  late: ['지연', 'bg-red-50 text-red-800 border-red-200'], failed: ['실패', 'bg-red-50 text-red-800 border-red-200'], planned: ['예정', 'bg-sky-50 text-sky-800 border-sky-200'],
};
export const StatusChip = ({ s }: { s: string }) => { const [l, c] = STATUS_CHIP[s] ?? [s, 'bg-slate-100 text-ink-2 border-line']; return <span className={cx('rounded-full border px-2 py-0.5 text-[11px] font-medium', c)} data-testid="mkt-status-chip">{l}</span>; };
export const BrandChip = ({ name, color }: { name: string | null; color?: string | null }) => name ? <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: color || '#7C3AED' }} data-testid="mkt-brand-chip">{name}</span> : null;

const kst = (d: Date | string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...o }).format(new Date(d));
const ymd = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
const hm = (d: Date | string) => kst(d, { hour: '2-digit', minute: '2-digit', hour12: false });
/** '오늘 18:00' / '내일 10:00' / '10/21(화) 10:00' */
export function whenLabel(at: string | null) {
  if (!at) return '게시 시각 미정';
  const today = ymd(new Date()); const tomorrow = ymd(new Date(Date.now() + 864e5)); const d = ymd(at);
  const day = d === today ? '오늘' : d === tomorrow ? '내일' : `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${kst(at, { weekday: 'short' })})`;
  return `${day} ${hm(at)}`;
}
/** '10/19(일) 09:00까지 승인하면 18:00 게시' */
export const deadlineLabel = (deadline: string | null, at: string | null) => deadline && at ? `${whenLabel(deadline).replace(/^(오늘|내일) /, '$1 ')}까지 승인하면 ${hm(at)} 게시` : null;

export type CardContent = { id: string; title: string; channel: string; kind?: string | null; status: string; scheduled_at: string | null; current_version: number; brand: string | null; brand_color?: string | null;
  body?: string; media_ids?: string[]; version_note?: string | null; deadline: string | null; late?: boolean; reapprove_from?: number | null; published_url?: string | null;
  last_decision?: { decision: string; comment: string | null; at: string; version: number; by: string | null } | null };

/** 승인 카드: 머리 칩(브랜드·채널+형식·제목·상태·vN·재승인) · 게시 시각·마감 · 미디어 넘겨 보기 · 문안 · 제작 메모 · 결정 기록 · [승인]/[수정 요청] */
export function ApprovalCard({ c, canDecide, onDone, onOpen }: { c: CardContent; canDecide: boolean; onDone: () => void; onOpen?: () => void }) {
  const [mode, setMode] = useState<'idle' | 'changes'>('idle'); const [memo, setMemo] = useState(''); const [done, setDone] = useState<string | null>(null);
  const [full, setFull] = useState(false); const [idx, setIdx] = useState(0);
  const media = c.media_ids ?? [];
  const late = !!c.late;
  async function decide(decision: 'approve' | 'changes') {
    try { await api(`/api/marketing/contents/${c.id}/decide`, { body: { version: c.current_version, decision, comment: decision === 'changes' ? memo.trim() : undefined } });
      setDone(decision === 'approve' ? '✓ 승인됨' : '수정 요청 보냄'); toast.ok(decision === 'approve' ? '승인했습니다' : '수정을 요청했습니다'); setTimeout(onDone, 900); }
    catch (e: any) { toast.error(e.message); }
  }
  const canAct = canDecide && !done && ['pending', 'changes', 'approved'].includes(c.status);
  const d = c.last_decision;
  return (
    <article className={cx('rounded-card border bg-white p-3 text-sm shadow-card', late ? 'border-2 border-red-500' : 'border-line')} data-testid="approval-card" data-late={late || undefined}>
      <div className="flex flex-wrap items-center gap-1.5">
        <BrandChip name={c.brand} color={c.brand_color} />
        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800" data-testid="mkt-channel-label">{channelLabel(c.channel, c.kind)}</span>
        <StatusChip s={late ? 'late' : c.status} />
        <span className="text-[11px] text-ink-3">v{c.current_version}</span>
        {!!c.reapprove_from && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800" data-testid="mkt-reapprove">재승인 (v{c.reapprove_from} 수정 요청 → v{c.current_version})</span>}
        {done && <span className="ml-auto text-xs font-semibold text-emerald-700" data-testid="approval-done">{done}</span>}
      </div>
      <button type="button" onClick={onOpen} className="mt-1 block text-left font-semibold hover:underline" data-testid="mkt-row">{c.title}</button>
      <p className="text-xs text-ink-2">{whenLabel(c.scheduled_at)} 게시{c.deadline && !['published'].includes(c.status) && <> · <span className={late ? 'font-bold text-red-600' : ''} data-testid="mkt-deadline">{late ? '마감 지남 — 다음 날로 이동 필요' : deadlineLabel(c.deadline, c.scheduled_at)}</span></>}</p>
      {media.length > 0 && (
        <div className="mt-2">
          <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:thin]">{media.map((m, k) => (
            <button key={m} type="button" onClick={() => { setIdx(k); setFull(true); }} className={cx('relative size-20 shrink-0 overflow-hidden rounded-input border', k === 0 ? 'border-violet-400' : 'border-line')} aria-label={`시안 ${k + 1} 크게 보기`}>
              <img src={`/api/library/${m}/download?inline=1`} alt="" className="size-full object-cover" loading="lazy" />{k === 0 && <span className="absolute left-0 top-0 rounded-br bg-violet-600 px-1 text-[10px] text-white">표지</span>}
            </button>))}</div>
          <p className="mt-0.5 text-[11px] text-ink-3">{media.length}장 — 옆으로 넘겨 보기</p>
        </div>)}
      {/* 대표(10/19 앱): 휴대폰 카드는 핵심만 — 본문·제작 메모는 제목을 눌러 상세에서 */}
      {c.body && <details className="mt-2 hidden md:block"><summary className="line-clamp-4 cursor-pointer whitespace-pre-wrap text-xs text-ink">{c.body}</summary><p className="mt-1 whitespace-pre-wrap text-xs">{c.body}</p></details>}
      {c.version_note && <p className="mt-1 hidden text-xs text-ink-2 md:block">제작 메모: {c.version_note}</p>}
      {d && d.version === c.current_version && <p className="mt-1 text-[11px] text-ink-3" data-testid="mkt-decision-line">{({ approve: '승인', changes: '수정 요청', hold: '보류' } as Record<string, string>)[d.decision] ?? d.decision} · {kst(d.at, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} KST{d.by ? ` · ${d.by}` : ''}{d.comment ? ` · 메모: ${d.comment}` : ''}{c.published_url ? <> · <a href={c.published_url} target="_blank" rel="noopener" className="underline">게시물 열기</a></> : null}</p>}
      {canAct && !late && (mode === 'idle' ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {c.status !== 'approved' && <Button size="sm" onClick={() => decide('approve')} data-testid="card-approve">{c.reapprove_from ? `수정본 v${c.current_version} 승인` : '승인'}</Button>}
          <Button size="sm" variant="secondary" onClick={() => setMode('changes')} data-testid="card-changes">{c.status === 'approved' ? '게시 전 수정 요청' : '수정 요청'}</Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2"><input className={cx(inputCls, 'min-w-0 flex-1')} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="무엇을 고칠지(두 글자 이상)" aria-label="수정 요청 메모" data-testid="card-changes-memo" />
          <Button size="sm" disabled={memo.trim().length < 2} onClick={() => decide('changes')} data-testid="card-changes-send">수정 요청 보내기</Button><Button size="sm" variant="secondary" onClick={() => setMode('idle')}>취소</Button></div>
      ))}
      {canAct && !late && c.status !== 'approved' && <p className="mt-1 hidden text-[11px] text-ink-3 md:block">승인해도 바로 공개되지 않습니다 — 게시 시각에 게시(도우미 또는 연결된 채널)합니다.</p>}
      {full && media.length > 0 && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/90 p-4" onClick={() => setFull(false)} data-testid="media-viewer">
          <img src={`/api/library/${media[idx]}/download?inline=1`} alt="" className="max-h-[80vh] max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          <div className="mt-3 flex items-center gap-4 text-white" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setIdx((idx - 1 + media.length) % media.length)} aria-label="이전" className="px-3 text-2xl">‹</button><span>{idx + 1} / {media.length}</span>
            <button type="button" onClick={() => setIdx((idx + 1) % media.length)} aria-label="다음" className="px-3 text-2xl">›</button></div>
        </div>)}
    </article>
  );
}
