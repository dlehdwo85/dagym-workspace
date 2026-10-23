'use client';
import { useState } from 'react';
import Link from 'next/link';
import { MediaFull, MediaThumb, isVideoMime, mimeOf, posterFrom } from '@/components/MediaView';
import { VideoDigestButton } from '@/components/VideoDigestButton';
import { api } from '@/components/client';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { ModeChip } from './ModeToggle';
import { ChannelPreview } from './ChannelPreview';

/** 운영실 화면 명세(OPS_ROOM_SCREEN_SPEC 2-2·5절)에 맞춘 승인 카드·라벨 — 승인함·현황이 같이 씀 */
const KIND: Record<string, string> = { feed: '피드', blog: '블로그', reels: '릴스', video: '생성 영상', shorts: '쇼츠', story: '스토리' };
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

const VIDEO_KINDS = ['reels', 'shorts', 'video'];
/** #516 서버가 바로 그릴 수 있는 시안(인스타·페북 피드·스토리, 크레딧 0) — 서버 mktAutoVisual.serverVisual 과 같은 규칙 */
export const canDrawVisual = (c: { channel: string; kind?: string | null }) => (c.channel === 'instagram' || c.channel === 'facebook') && !VIDEO_KINDS.includes(c.kind ?? '');
/** #516 시안이 없어 승인할 수 없는 카드(스레드만 글로 승인 — 서버 decide 와 같은 규칙) */
export const needsVisual = (c: { channel: string; media_ids?: string[] }) => c.channel !== 'threads' && !c.media_ids?.length;
/** [AI 이미지로 다시] 수정 요청 문구 — 서버 classifyRevision 이 이미지 재생성(regen_image)으로 읽음 */
const AI_REGEN = 'AI 이미지로 다시 만들어 주세요(사진 재생성)';
const AI_REGEN_CREDITS = 6.5;

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

export type CardContent = { id: string; title: string; channel: string; kind?: string | null; mode?: string | null; status: string; scheduled_at: string | null; current_version: number; brand: string | null; brand_color?: string | null; brand_logo?: string | null; handle?: string | null;
  body?: string; media_ids?: string[]; media_info?: { id: string; mime: string | null }[] | null; version_note?: string | null; deadline: string | null; late?: boolean; reapprove_from?: number | null; published_url?: string | null;
  auto?: boolean; produce_at?: string | null; produced_at?: string | null; quality?: { passed?: boolean; issues?: string[]; visual?: { by: string } | null; report?: { v?: number; needsPolish?: boolean; human?: { score: number }; hook?: { score: number; pass: boolean } | null } } | null; production?: { kind: string; status: string } | null;
  rationale?: { purpose?: string | null; metric?: string | null; message?: string | null; why?: string | null; topic?: string | null; week?: number | null; qa?: { needsHuman?: boolean; issues?: string[]; notes?: string[] } | null } | null;
  last_decision?: { decision: string; comment: string | null; at: string; version: number; by: string | null } | null };

/** 대표 10/20 18:00 ①: '왜 이 글인가' — 목적·목표 지표·핵심 메시지·근거 한 줄(목표·주차 주제·규칙에서 자동, 사람이 적은 것도) */
export function WhyBox({ r, compact }: { r?: CardContent['rationale']; compact?: boolean }) {
  // #454 영상 AI 검수: 걸린 장면이 남았으면 승인 전에 사람이 보도록 빨간 줄
  const qa = r?.qa?.needsHuman ? <div className={cx('rounded-input bg-red-50 px-2.5 py-1.5 text-xs text-red-900', compact ? 'mt-2' : 'mt-1')} data-testid="mkt-qa-review"><b>사람 검수 필요</b> — {(r.qa.issues ?? []).join(' · ') || 'AI 검수를 못 했습니다'}</div> : null;
  if (!r || !(r.purpose || r.metric || r.message || r.why)) return qa;
  return (<>{qa}
    <div className={cx('rounded-input border border-violet-100 bg-violet-50/40 px-2.5 py-1.5 text-xs', compact ? 'mt-2' : '')} data-testid="mkt-why">
      <div className="font-semibold text-violet-800">왜 이 글인가{r.week ? <span className="ml-1 font-normal text-ink-3">{r.week}주{r.topic ? ` · ${r.topic}` : ''}</span> : r.topic ? <span className="ml-1 font-normal text-ink-3">{r.topic}</span> : null}</div>
      {r.why && <p className="mt-0.5 text-ink">{r.why}</p>}
      <dl className="mt-0.5 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0 text-[11px] text-ink-2">{([['목적', r.purpose], ['목표 지표', r.metric], ['핵심 메시지', r.message]] as [string, string | null | undefined][]).filter(([, v]) => v).map(([k, v]) => [<dt key={k} className="text-ink-3">{k}</dt>, <dd key={k + 'v'}>{v}</dd>])}</dl>
    </div></>
  );
}
/** 승인 카드: 머리 칩(브랜드·채널+형식·제목·상태·vN·재승인) · 게시 시각·마감 · 미디어 넘겨 보기 · 문안 · 제작 메모 · 결정 기록 · [승인]/[수정 요청] */
export function ApprovalCard({ c, canDecide, onDone, onOpen }: { c: CardContent; canDecide: boolean; onDone: () => void; onOpen?: () => void }) {
  const [mode, setMode] = useState<'idle' | 'changes'>('idle'); const [memo, setMemo] = useState(''); const [done, setDone] = useState<string | null>(null);
  const [full, setFull] = useState(false); const [idx, setIdx] = useState(0); const [bodyOpen, setBodyOpen] = useState(false); const [look, setLook] = useState(false);
  const media = c.media_ids ?? [];
  const issues = c.quality?.passed === false ? c.quality.issues ?? [] : [];
  const rep = c.quality?.report?.v === c.current_version ? c.quality.report : null; // #426 이 버전의 품질 보고서만(사람이 고친 새 버전엔 옛 점수 안 붙임)
  const late = !!c.late;
  const noVisual = needsVisual(c); const drawable = canDrawVisual(c); const [making, setMaking] = useState(false);
  async function decide(decision: 'approve' | 'changes', comment = memo.trim()) {
    try { await api(`/api/marketing/contents/${c.id}/decide`, { body: { version: c.current_version, decision, comment: decision === 'changes' ? comment : undefined } });
      setDone(decision === 'approve' ? '✓ 승인됨' : comment === AI_REGEN ? 'AI 이미지 요청함' : '수정 요청 보냄'); toast.ok(decision === 'approve' ? '승인했습니다' : comment === AI_REGEN ? 'AI 이미지 제작을 요청했습니다 — 붙으면 다시 승인 요청이 옵니다' : '수정을 요청했습니다'); setTimeout(onDone, 900); }
    catch (e: any) { toast.error(e.message); }
  }
  // #516 (c): 시안 없는 카드 [지금 만들기] = 서버가 브랜드 키트·자료실 사진으로 그려 새 버전(크레딧 0) → 승인 대기
  async function makeNow() {
    setMaking(true);
    try { const r = await api<{ version: number; photo: string | null }>(`/api/marketing/contents/${c.id}/visual`, { body: {} });
      toast.ok(`시안을 그려 붙였습니다(v${r.version}) — ${r.photo ? `사진: ${r.photo}` : '브랜드 색 바탕'}`); onDone(); }
    catch (e: any) { toast.error(e.message); }
    finally { setMaking(false); }
  }
  const canAct = canDecide && !done && ['pending', 'changes', 'approved'].includes(c.status);
  const d = c.last_decision;
  return (
    <article className={cx('rounded-card border bg-white p-3 text-sm shadow-card', late ? 'border-2 border-red-500' : 'border-line')} data-testid="approval-card" data-late={late || undefined}>
      <div className="flex flex-wrap items-center gap-1.5">
        <BrandChip name={c.brand} color={c.brand_color} />
        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800" data-testid="mkt-channel-label">{channelLabel(c.channel, c.kind)}</span>
        <ModeChip mode={c.mode} />
        <StatusChip s={late ? 'late' : c.status} />
        <span className="text-[11px] text-ink-3">v{c.current_version}</span>
        {rep?.needsPolish && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800" data-testid="approval-polish-badge" title="사람다움 점수가 기준보다 낮습니다 — 상세에서 [AI로 다듬기]">다듬기 필요{rep.human ? ` · ${rep.human.score}점` : ''}</span>}
        {rep?.hook && !rep.hook.pass && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800" data-testid="approval-weak-hook">훅 약함 {rep.hook.score}점</span>}
        {!!c.reapprove_from && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800" data-testid="mkt-reapprove">재승인 (v{c.reapprove_from} 수정 요청 → v{c.current_version})</span>}
        {done && <span className="ml-auto text-xs font-semibold text-emerald-700" data-testid="approval-done">{done}</span>}
      </div>
      <button type="button" onClick={onOpen} className="mt-1 block text-left font-semibold hover:underline" data-testid="mkt-row">{c.title}</button>
      <p className="text-xs text-ink-2">{whenLabel(c.scheduled_at)} 게시{c.deadline && !['published'].includes(c.status) && <> · <span className={late ? 'font-bold text-red-600' : ''} data-testid="mkt-deadline">{late ? '마감 지남 — 다음 날로 이동 필요' : deadlineLabel(c.deadline, c.scheduled_at)}</span></>}</p>
      {media.length > 0 && (
        <div className="mt-2">
          <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:thin]">{media.map((m, k) => (
            <button key={m} type="button" onClick={() => { setIdx(k); setFull(true); }} className={cx('relative size-20 shrink-0 overflow-hidden rounded-input border', k === 0 ? 'border-violet-400' : 'border-line')} aria-label={`시안 ${k + 1} 크게 보기`}>
              <MediaThumb src={`/api/library/${m}/download?inline=1`} mime={mimeOf(c.media_info, m)} poster={isVideoMime(mimeOf(c.media_info, m)) && posterFrom(c.media_info, m) ? `/api/library/${posterFrom(c.media_info, m)}/download?inline=1` : null} className="size-full object-cover" />{k === 0 && <span className="absolute left-0 top-0 rounded-br bg-violet-600 px-1 text-[10px] text-white">표지</span>}
            </button>))}</div>
          <p className="mt-0.5 text-[11px] text-ink-3">{media.length}장 — 옆으로 넘겨 보기</p>
          {media.some((m) => isVideoMime(mimeOf(c.media_info, m))) && <VideoDigestButton fileId={media.find((m) => isVideoMime(mimeOf(c.media_info, m)))!} title={c.title} mode="review" />}
        </div>)}
      {/* 대표 재지적 10/20 18:45 ②: 시안이 없어도 카드 첫 화면에 자리(회색 상자)를 늘 보여 줌 — 제작 중이면 예정 시각
          #516 (c): 시안 없이는 승인할 수 없는 카드(스레드 빼고)는 빨간 띠 '시안 없음' + [지금 만들기](서버 그리기, 크레딧 0) — [승인] 단추는 숨김 */}
      {media.length === 0 && <div className={cx('mt-2 flex items-center gap-3 rounded-input border p-2', noVisual ? 'border-red-300 bg-red-50' : 'border-dashed border-line bg-slate-50')} data-testid="approval-no-media" data-blocked={noVisual || undefined}>
        <div className={cx('flex size-20 shrink-0 items-center justify-center rounded-input text-center text-[11px] leading-tight', noVisual ? 'bg-red-100 font-semibold text-red-800' : 'bg-slate-200 text-ink-2')}>{c.production || (c.auto && !c.produced_at) ? '시안\n제작 중'.split('\n').map((t, i) => <span key={i} className="block">{t}</span>) : '시안 없음'}</div>
        <div className="min-w-0 flex-1 space-y-1">
          {noVisual && <p className="text-xs font-bold text-red-800" data-testid="approval-no-media-band">시안 없음 — 글만으로는 승인할 수 없습니다</p>}
          <p className="text-xs text-ink-2">{c.production ? `${c.production.kind.includes('video') ? '영상' : '이미지'} 제작 요청이 열려 있습니다${c.production.status === 'needs_approval' ? ' (한도 승인 대기)' : ''} — 붙으면 여기에 보입니다` : c.auto && !c.produced_at && c.produce_at ? `AI 제작 예정 ${fmtDateTime(c.produce_at)}` : drawable ? '[지금 만들기]를 누르면 브랜드 키트·자료실 사진으로 바로 그려 붙입니다(크레딧 0)' : '아직 시안이 없습니다 — 상세에서 수정본에 사진을 붙여 주세요'}</p>
          {noVisual && !done && (drawable ? <Button size="sm" onClick={makeNow} disabled={making} data-testid="approval-make-visual">{making ? '그리는 중…' : '지금 만들기'}</Button>
            : VIDEO_KINDS.includes(c.kind ?? '') ? <Link href="/s/marketing/automation" className="inline-block text-xs font-medium text-violet-700 underline" data-testid="approval-production-link">제작 요청 카드 보기 →</Link> : null)}
        </div>
      </div>}
      {/* #497 R06 ⑥: 상세와 같은 '실제 게시 화면' 틀을 카드에서도(기본 접힘 — 승인함 길이 유지) */}
      {(media.length > 0 || c.body) && <button type="button" onClick={() => setLook(!look)} className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-violet-700" aria-expanded={look} data-testid="approval-look">
        {look ? <><ChevronUp size={14} aria-hidden />게시 화면 접기</> : <><ChevronDown size={14} aria-hidden />게시 화면으로 보기</>}</button>}
      {look && <div className="mt-2"><ChannelPreview channel={c.channel} kind={c.kind} brand={c.brand} handle={c.handle} logo={c.brand_logo} color={c.brand_color} title={c.title} body={c.body ?? ''} media={media} info={c.media_info ?? []} /></div>}
      {issues.length > 0 && <p className="mt-1 rounded-input bg-amber-50 px-2 py-1 text-[11px] text-amber-800" data-testid="approval-issues">{issues.join(' · ')}</p>}
      <WhyBox r={c.rationale} compact />
      {/* 대표 재지적 10/20 18:45 ①: 본문은 2줄(PC 4줄)만 보이고 [더보기] 글자 버튼(아이콘+글자)으로 펼침 — 전에는 줄임표(…)만 보여 누를 수 있는지 몰랐음 */}
      {c.body && <div className="mt-2 text-xs">
        <p className={cx('whitespace-pre-wrap text-ink', !bodyOpen && 'line-clamp-2 md:line-clamp-4')} data-testid="approval-body">{c.body}</p>
        <button type="button" onClick={() => setBodyOpen(!bodyOpen)} className="mt-0.5 inline-flex items-center gap-0.5 font-medium text-violet-700" aria-expanded={bodyOpen} data-testid="approval-body-more">{bodyOpen ? <><ChevronUp size={14} aria-hidden />접기</> : <><ChevronDown size={14} aria-hidden />더보기</>}</button>
      </div>}
      {c.version_note && bodyOpen && <p className="mt-1 text-xs text-ink-2">제작 메모: {c.version_note}</p>}
      {d && d.version === c.current_version && <p className="mt-1 text-[11px] text-ink-3" data-testid="mkt-decision-line">{({ approve: '승인', changes: '수정 요청', hold: '보류' } as Record<string, string>)[d.decision] ?? d.decision} · {kst(d.at, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} KST{d.by ? ` · ${d.by}` : ''}{d.comment ? ` · 메모: ${d.comment}` : ''}{c.published_url ? <> · <a href={c.published_url} target="_blank" rel="noopener" className="underline">게시물 열기</a></> : null}</p>}
      {canAct && !late && (mode === 'idle' ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {c.status !== 'approved' && !noVisual && <Button size="sm" onClick={() => decide('approve')} data-testid="card-approve">{c.reapprove_from ? `수정본 v${c.current_version} 승인` : '승인'}</Button>}
          <Button size="sm" variant="secondary" onClick={() => setMode('changes')} data-testid="card-changes">{c.status === 'approved' ? '게시 전 수정 요청' : '수정 요청'}</Button>
          {/* #516 (a): 서버가 그린 시안 → Higgsfield AI 이미지로 바꾸기는 크레딧이 들어 따로(제작 요청 카드·한도 확인) */}
          {c.auto && c.status !== 'approved' && media.length > 0 && c.quality?.visual?.by === 'server' && drawable && <Button size="sm" variant="secondary" data-testid="card-ai-image"
            onClick={() => confirm(`AI 이미지로 다시 만들면 약 ${AI_REGEN_CREDITS}크레딧이 듭니다(이번 달 한도를 넘으면 한도 승인 뒤 제작). 지금 시안은 그대로 두고 새 이미지가 붙으면 다시 승인 요청이 옵니다. 진행할까요?`) && decide('changes', AI_REGEN)}>AI 이미지로 다시 · 약 {AI_REGEN_CREDITS}크레딧</Button>}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2"><input className={cx(inputCls, 'min-w-0 flex-1')} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="무엇을 고칠지(두 글자 이상)" aria-label="수정 요청 메모" data-testid="card-changes-memo" />
          <Button size="sm" disabled={memo.trim().length < 2} onClick={() => decide('changes')} data-testid="card-changes-send">수정 요청 보내기</Button><Button size="sm" variant="secondary" onClick={() => setMode('idle')}>취소</Button></div>
      ))}
      {canAct && !late && c.status !== 'approved' && !noVisual && <p className="mt-1 hidden text-[11px] text-ink-3 md:block">승인해도 바로 공개되지 않습니다 — 게시 시각에 게시(도우미 또는 연결된 채널)합니다.</p>}
      {full && media.length > 0 && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/90 p-4" onClick={() => setFull(false)} data-testid="media-viewer">
          <MediaFull src={`/api/library/${media[idx]}/download?inline=1`} mime={mimeOf(c.media_info, media[idx])} poster={posterFrom(c.media_info, media[idx]) ? `/api/library/${posterFrom(c.media_info, media[idx])}/download?inline=1` : null} className="max-h-[80vh] max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          <div className="mt-3 flex items-center gap-4 text-white" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setIdx((idx - 1 + media.length) % media.length)} aria-label="이전" className="px-3 text-2xl">‹</button><span>{idx + 1} / {media.length}</span>
            <button type="button" onClick={() => setIdx((idx + 1) % media.length)} aria-label="다음" className="px-3 text-2xl">›</button></div>
        </div>)}
    </article>
  );
}
