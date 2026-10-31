'use client';
import { dtf } from '@/lib/dtf';
import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { MediaFull, MediaThumb, isVideoMime, mimeOf, posterFrom } from '@/components/MediaView';
import { VideoDigestButton } from '@/components/VideoDigestButton';
import { api } from '@/components/client';
import { useBackClose } from '@/components/backClose';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { ModeChip } from './ModeToggle';
import { ChannelPreview, Slides } from './ChannelPreview';
import { VersionCompare, partsLabel, requestLabel, requestNote, type Revision } from './VersionCompare';

/** 운영실 화면 명세(OPS_ROOM_SCREEN_SPEC 2-2·5절)에 맞춘 승인 카드·라벨 — 승인함·현황이 같이 씀 */
const KIND: Record<string, string> = { feed: '피드', blog: '블로그', reels: '릴스', video: '생성 영상', shorts: '쇼츠', story: '스토리', photo: '사진 게시물' };
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
export const canDrawVisual = (c: { channel: string; kind?: string | null }) => ['instagram', 'facebook', 'blog'].includes(c.channel) && !VIDEO_KINDS.includes(c.kind ?? '');
/** #516 시안이 없어 승인할 수 없는 카드(스레드만 글로 승인 — 서버 decide 와 같은 규칙) */
export const needsVisual = (c: { channel: string; media_ids?: string[] }) => c.channel !== 'threads' && !c.media_ids?.length;
/** [AI 이미지로 다시] 수정 요청 문구 — 서버 classifyRevision 이 이미지 재생성(regen_image)으로 읽음 */
const AI_REGEN = 'AI 이미지로 다시 만들어 주세요(사진 재생성)';
const AI_REGEN_CREDITS = 6.5;

export type DecideRevision = { kind?: string; version?: number | null; n?: number | null; parts?: string[]; card?: unknown; error?: string; check?: Revision['check']; same?: number; repeat?: number };
/** 187차: 같은 글 요청이 연달아 반영 안 돼 AI 가 글을 다시 고치지 않은 경우의 한 줄(서버 SAME_REQUEST_STOP) */
const repeatNote = (k: number) => `같은 요청이 ${k}번 연속 반영되지 않아 이번엔 AI 가 글을 다시 고치지 않았습니다(다르게 적어 주시거나 상세 › 수정본 올리기)`;
/** #545: 수정 요청 → AI 가 글·시안을 고친 수정본을 바로 승인함에 다시 올림(187차: 횟수 제한 없음 · 회사 월 AI 예산 안에서) — 결정 뒤 무엇을 했는지 그대로 알림(카드·상세 공용) */
export function decideMessage(decision: 'approve' | 'changes' | 'hold', rv?: DecideRevision | null) {
  if (decision === 'approve') return '승인했습니다';
  if (decision === 'hold') return '보류했습니다';
  if (rv?.version) return `AI 가 고쳐 다시 올렸습니다 — 수정본 v${rv.version}(${partsLabel(rv.parts) || '글'} · AI 수정 ${rv.n}번째)${rv.card ? ' · 사진·영상은 제작 요청 카드로' : ''}${requestNote({ check: rv.check }) ? ` — ${requestLabel({ check: rv.check })}: ${requestNote({ check: rv.check })}` : ''}${rv.repeat ? ` · ${repeatNote(rv.repeat)}` : ''}`;
  if (rv?.kind === 'repeat') return `수정을 요청했습니다 — ${repeatNote(rv.same ?? 2)}`;
  if (rv?.card) return `수정을 요청했습니다 — 사진·영상 다시 만들기는 제작 요청 카드로 넘겼습니다${rv.repeat ? ` · ${repeatNote(rv.repeat)}` : ''}`;
  if (rv?.error) return `수정을 요청했습니다 — AI 수정본은 만들지 못했습니다: ${rv.error.slice(0, 80)}`;
  return '수정을 요청했습니다';
}
const kst = (d: Date | string, o: Intl.DateTimeFormatOptions) => dtf('ko-KR', { timeZone: 'Asia/Seoul', ...o }).format(new Date(d));
const ymd = (d: Date | string) => dtf('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
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
  body?: string; media_ids?: string[]; media_info?: { id: string; mime: string | null; faces?: boolean }[] | null; version_note?: string | null; deadline: string | null; late?: boolean; reapprove_from?: number | null; published_url?: string | null;
  revision?: Revision | null; reapprove_comment?: string | null; // #545 수정본 배지(반영한 요청·AI 수정 n번째)
  brand_templates?: boolean; // #544 브랜드 키트 피드 틀이 있으면 [다른 틀로 다시 그리기]
  auto?: boolean; produce_at?: string | null; produced_at?: string | null; quality?: { passed?: boolean; issues?: string[]; visual?: { by: string } | null; postponed?: { from?: string | null; at?: string; restored?: boolean } | null; held?: { at?: string; reason?: string } | null; /** 267차 #795 주 단위 묶음(그 주 월요일·올린 때) */ batch?: { week: string; status?: string; at?: string; released?: string } | null; failed?: { at?: string; reason?: string; n?: number } | null; report?: { v?: number; needsPolish?: boolean; human?: { score: number }; hook?: { score: number; pass: boolean } | null };
    rescheduled?: { from: string; to: string } | null } | null; production?: { id?: string; kind: string; status: string; est?: number | null; reason?: string | null } | null; // 요청 C §3-6: 수정본이 승인 마감을 넘겨 다음 슬롯으로 옮겨진 경우 '원래 m/d → m/d'
  rationale?: { purpose?: string | null; metric?: string | null; message?: string | null; why?: string | null; topic?: string | null; topicFrom?: string | null; week?: number | null; qa?: { needsHuman?: boolean; issues?: string[]; notes?: string[] } | null } | null;
  last_decision?: { decision: string; comment: string | null; at: string; version: number; by: string | null } | null };

/** 대표 10/20 18:00 ①: '왜 이 글인가' — 목적·목표 지표·핵심 메시지·근거 한 줄(목표·주차 주제·규칙에서 자동, 사람이 적은 것도) */
/** 로컬 QA 10/24 ③ 주제를 어디서 골랐나 — 회사 공통 테마는 브랜드에 맞게 바꿔 씀 */
const TOPIC_FROM: Record<string, string> = { answer: '답한 주제', goal: '브랜드 목표', brand: '브랜드 이번 주', news: '이번 달 소식', pool: '주제 풀', rule: '묶음 규칙', company: '회사 공통 테마에서' };
export function WhyBox({ r, compact }: { r?: CardContent['rationale']; compact?: boolean }) {
  // #454 영상 AI 검수: 걸린 장면이 남았으면 승인 전에 사람이 보도록 빨간 줄
  const qa = r?.qa?.needsHuman ? <div className={cx('rounded-input bg-red-50 px-2.5 py-1.5 text-xs text-red-900', compact ? 'mt-2' : 'mt-1')} data-testid="mkt-qa-review"><b>사람 검수 필요</b> — {(r.qa.issues ?? []).join(' · ') || 'AI 검수를 못 했습니다'}</div> : null;
  if (!r || !(r.purpose || r.metric || r.message || r.why)) return qa;
  return (<>{qa}
    <div className={cx('rounded-input border border-violet-100 bg-violet-50/40 px-2.5 py-1.5 text-xs', compact ? 'mt-2' : '')} data-testid="mkt-why">
      <div className="font-semibold text-violet-800">왜 이 글인가{r.week ? <span className="ml-1 font-normal text-ink-3">{r.week}주{r.topic ? ` · ${r.topic}` : ''}</span> : r.topic ? <span className="ml-1 font-normal text-ink-3">{r.topic}</span> : null}{r.topic && r.topicFrom && TOPIC_FROM[r.topicFrom] && <span className="ml-1 rounded-full bg-white px-1.5 text-[10px] font-normal text-ink-3" data-testid="mkt-why-topic-from">{TOPIC_FROM[r.topicFrom]}</span>}</div>
      {r.why && <p className="mt-0.5 text-ink">{r.why}</p>}
      <dl className="mt-0.5 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0 text-[11px] text-ink-2">{([['목적', r.purpose], ['목표 지표', r.metric], ['핵심 메시지', r.message]] as [string, string | null | undefined][]).filter(([, v]) => v).map(([k, v]) => [<dt key={k} className="text-ink-3">{k}</dt>, <dd key={k + 'v'}>{v}</dd>])}</dl>
    </div></>
  );
}
const md = (d: string) => { const y = ymd(d); return `${Number(y.slice(5, 7))}/${Number(y.slice(8, 10))}`; };
/** 승인 카드: 머리 칩(브랜드·채널+형식·제목·상태·vN·재승인) · 게시 시각·마감 · 미디어 넘겨 보기 · 문안 · 제작 메모 · 결정 기록 · [승인]/[수정 요청]
 *  simple(요청 C §3-5): 대표(회사 소유자) 화면 — [승인]·[수정 요청] 두 단추만, 다시 그리기·AI 이미지·버전 비교는 운영실(관리자) 몫 */
/** #210(로컬 10/24 '승인함 첫 표시 14초'): 접힌 묶음(수정 요청·보류·예정 지남·초안 보관·마감 지남) 안 카드는 펼치기 전까지 시안(사진·영상)을 그리지 않음 — 승인함을 열 때마다 원본 사진 수백 장을 받던 것 */
export const CardMediaGate = createContext(true);
export function ApprovalCard({ c, canDecide, onDone, onOpen, simple = false }: { c: CardContent; canDecide: boolean; onDone: () => void; onOpen?: () => void; simple?: boolean }) {
  const [mode, setMode] = useState<'idle' | 'changes'>('idle'); const [memo, setMemo] = useState(''); const [done, setDone] = useState<string | null>(null);
  const [full, setFull] = useState(false); const [idx, setIdx] = useState(0); const [bodyOpen, setBodyOpen] = useState(false); const [look, setLook] = useState(false); const [cmp, setCmp] = useState(false); const [busy, setBusy] = useState(false);
  // #545: AI 수정본이 바로 올라오면 같은 카드가 새 버전으로 다시 그려짐 — [승인]·[수정 요청]을 다시 보이게
  useEffect(() => { setDone(null); setMode('idle'); setMemo(''); }, [c.current_version]);
  const media = c.media_ids ?? []; const showMedia = useContext(CardMediaGate);
  // #631(대표 10/25 21:20 '승인함에서 뒤로가기가 승인함을 벗어남'): 카드 시안 크게 보기도 history 한 칸(?v=) — 뒤로가기·닫기 = 크게 보기만 닫힘(상세 창은 #535 ?c=)
  useBackClose(full && media.length > 0, () => setFull(false), ['v', c.id]);
  const issues = c.quality?.passed === false ? c.quality.issues ?? [] : [];
  const rep = c.quality?.report?.v === c.current_version ? c.quality.report : null; // #426 이 버전의 품질 보고서만(사람이 고친 새 버전엔 옛 점수 안 붙임)
  const late = !!c.late;
  const noVisual = needsVisual(c); const drawable = canDrawVisual(c); const [making, setMaking] = useState(false);
  async function decide(decision: 'approve' | 'changes', comment = memo.trim()) {
    setBusy(true);
    try { const r = await api<{ revision?: DecideRevision; rescheduled?: { from: string; to: string } }>(`/api/marketing/contents/${c.id}/decide`, { body: { version: c.current_version, decision, comment: decision === 'changes' ? comment : undefined } });
      const rv = r.revision;
      // 255차 #791: 게시일이 지난 글을 승인하면 서버가 가장 가까운 빈 게시 칸으로 옮김
      setDone(decision === 'approve' ? (r.rescheduled ? `✓ 승인 · ${whenLabel(r.rescheduled.to)} 게시` : '✓ 승인됨') : comment === AI_REGEN ? 'AI 이미지 요청함' : rv?.version ? `수정본 v${rv.version} 올라감` : '수정 요청 보냄');
      toast.ok(comment === AI_REGEN && decision === 'changes' ? 'AI 이미지 제작을 요청했습니다 — 붙으면 다시 승인 요청이 옵니다' : r.rescheduled ? `승인했습니다 — 게시일이 지나 ${whenLabel(r.rescheduled.to)} 게시로 옮겼습니다` : decideMessage(decision, rv)); setTimeout(onDone, 900); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }
  // #516 (c): 시안 없는 카드 [지금 만들기] = 서버가 브랜드 키트·자료실 사진으로 그려 새 버전(크레딧 0) → 승인 대기
  async function makeNow(redraw = false) {
    setMaking(true);
    try { const r = await api<{ version: number; photo: string | null; template?: string | null }>(`/api/marketing/contents/${c.id}/visual`, { body: redraw ? { redraw: true } : {} });
      toast.ok(`시안을 ${redraw ? '다시 ' : ''}그려 붙였습니다(v${r.version}) — ${[r.template ? `틀: ${r.template}` : '', r.photo ? `사진: ${r.photo}` : '브랜드 색 바탕'].filter(Boolean).join(' · ')}`); onDone(); }
    catch (e: any) { toast.error(e.message); }
    finally { setMaking(false); }
  }
  // 255차 #792: 수정 요청이 아직 AI 수정본으로 안 만들어진 글 [AI 수정본 만들기] · 영상·AI 이미지 다시 만들기 비용 승인 · 영상 → 이미지 카드뉴스(0크레딧)
  const [acting, setActing] = useState<string | null>(null);
  async function act(kind: 'revise' | 'to_cards' | 'approve_regen') {
    setActing(kind);
    try {
      if (kind === 'approve_regen') { await api(`/api/marketing/auto/requests/${c.production!.id}`, { method: 'PATCH', body: { action: 'approve' } }); toast.ok('제작을 승인했습니다 — 다시 만든 영상·이미지가 붙으면 승인 요청이 옵니다'); }
      else { const r = await api<{ revision?: DecideRevision & { kind?: string } }>(`/api/marketing/auto/contents/${c.id}`, { body: { action: kind } }); toast.ok(kind === 'to_cards' ? `이미지 카드뉴스로 다시 만들었습니다${r.revision?.version ? ` — 수정본 v${r.revision.version}` : ''}` : decideMessage('changes', r.revision)); }
      onDone();
    } catch (e: any) { toast.error(e.message); } finally { setActing(null); }
  }
  const unprocessed = c.status === 'changes' && c.last_decision?.decision === 'changes' && c.last_decision.version === c.current_version && !c.production;
  const regenAsk = c.production?.status === 'needs_approval' && c.production.kind.startsWith('regen') && !!c.production.id;
  const cardsAlt = VIDEO_KINDS.includes(c.kind ?? '') && ['instagram', 'facebook'].includes(c.channel);
  // 271차 #811(대표 '마케팅 AI 영상 제작 비용 최소화'): 릴스·쇼츠는 자료실 실제 사진으로 영상(생성 비용 0) — 관리자
  const [slide, setSlide] = useState(false);
  async function slideshow() {
    setSlide(true);
    try { const r = await api<{ photos: number; seconds: number }>('/api/marketing/studio/slideshow', { body: { contentId: c.id } }); toast.ok(`실제 사진 ${r.photos}장으로 ${r.seconds}초 영상을 만드는 중입니다. 다 되면 새 버전으로 올라옵니다`); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setSlide(false); }
  }
  // 273차 #811 1) 앱 화면 녹화: 자료실 '마케팅/화면 녹화' 영상을 골라 자막·끝 화면을 붙임(생성 비용 0)
  const [recs, setRecs] = useState<{ id: string; title: string; at: string; mine: boolean; used: boolean }[] | null>(null);
  async function openRecs() {
    if (recs) { setRecs(null); return; }
    try { setRecs((await api<{ files: { id: string; title: string; at: string; mine: boolean; used: boolean }[] }>(`/api/marketing/studio/screen?contentId=${c.id}`)).files); } catch (e: any) { toast.error(e.message); }
  }
  async function pickRec(fileId: string) {
    setSlide(true);
    try { await api('/api/marketing/studio/screen', { body: { contentId: c.id, fileId } }); toast.ok('녹화 영상에 자막·끝 화면을 붙이는 중입니다. 다 되면 새 버전으로 올라옵니다'); setRecs(null); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setSlide(false); }
  }
  const canAct = canDecide && !done && ['pending', 'changes', 'approved'].includes(c.status);
  const d = c.last_decision;
  const req = c.revision?.request ?? c.reapprove_comment ?? null; const from = c.revision?.from ?? c.reapprove_from ?? null; // #545
  return (
    <article className={cx('rounded-card border bg-white p-3 text-sm shadow-card', late ? 'border-2 border-red-500' : 'border-line')} data-testid="approval-card" data-late={late || undefined}>
      <div className="flex flex-wrap items-center gap-1.5">
        <BrandChip name={c.brand} color={c.brand_color} />
        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800" data-testid="mkt-channel-label">{channelLabel(c.channel, c.kind)}</span>
        <ModeChip mode={c.mode} />
        <StatusChip s={c.status} />
        {late && <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-800" data-testid="approval-late-chip">게시일 지남</span>}
        <span className="text-[11px] text-ink-3">v{c.current_version}</span>
        {rep?.needsPolish && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800" data-testid="approval-polish-badge" title="사람다움 점수가 기준보다 낮습니다 — 상세에서 [AI로 다듬기]">다듬기 필요{rep.human ? ` · ${rep.human.score}점` : ''}</span>}
        {rep?.hook && !rep.hook.pass && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800" data-testid="approval-weak-hook">훅 약함 {rep.hook.score}점</span>}
        {/* #545: '수정본 v3 — 반영한 요청: …'(AI 수정본은 반영한 요청을 버전에, 사람이 올린 수정본은 마지막 수정 요청 메모로) */}
        {(!!c.reapprove_from || !!c.revision?.request) && <span className={cx('max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium', c.revision?.check?.status === 'unmet' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800')} data-testid="mkt-reapprove"
          title={[req, c.revision?.check?.detail].filter(Boolean).join(' — ') || undefined}>수정본 v{c.current_version}{req ? ` — ${requestLabel(c.revision)}: ${req}${requestNote(c.revision) ? ` · ${requestNote(c.revision)}` : ''}` : ` (v${c.reapprove_from} 수정 요청)`}</span>}
        {c.revision?.ai && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800" data-testid="mkt-ai-revision">AI 수정 {c.revision.n}번째{c.revision.parts?.length ? ` · ${partsLabel(c.revision.parts)}` : ''}</span>}
        {/* 요청 C §3-6: 수정본은 원래 게시일 그대로 — 승인 마감이 지나 다음 슬롯으로 옮긴 글만 '원래 m/d → m/d' */}
        {c.quality?.rescheduled && c.scheduled_at && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800" data-testid="approval-rescheduled" title="승인 마감이 지나 다음 슬롯으로 옮겼습니다">원래 {md(c.quality.rescheduled.from)} → {md(c.scheduled_at)}</span>}
        {done && <span className="ml-auto text-xs font-semibold text-emerald-700" data-testid="approval-done">{done}</span>}
      </div>
      <button type="button" onClick={onOpen} className="mt-1 block text-left font-semibold hover:underline" data-testid="mkt-row">{c.title}</button>
      <p className="text-xs text-ink-2">{whenLabel(c.scheduled_at)} 게시{c.deadline && !['published'].includes(c.status) && <> · <span className={late ? 'font-bold text-red-600' : ''} data-testid="mkt-deadline">{late ? '게시일 지남 — 승인하면 가장 가까운 빈 게시 칸으로' : deadlineLabel(c.deadline, c.scheduled_at)}</span></>}</p>
      {late && ['pending', 'changes'].includes(c.status) && <p className="mt-1 rounded-input border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-800" data-testid="approval-late-band">게시일 지남(원래 {whenLabel(c.scheduled_at)}) — {c.status === 'pending' ? '승인하면 가장 가까운 빈 게시 칸으로 옮겨 게시합니다' : '수정본이 올라오면 가장 가까운 빈 게시 칸으로 옮깁니다'}</p>}
      {regenAsk && <div className="mt-1 rounded-input border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900" data-testid="approval-regen-ask">
        <p className="font-semibold">{c.production!.kind === 'regen_video' ? '영상' : 'AI 이미지'} 다시 만들기 — 승인해야 제작합니다</p>
        {c.production!.reason && <p className="mt-0.5" data-testid="approval-regen-reason">{c.production!.reason}</p>}
        {canDecide && !done && <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => act('approve_regen')} disabled={!!acting} data-testid="approval-regen-approve">{acting === 'approve_regen' ? '승인하는 중…' : `승인하고 제작 요청${c.production!.est ? ` · 약 ${c.production!.est}크레딧` : ''}`}</Button>
          {cardsAlt && <Button size="sm" onClick={() => act('to_cards')} disabled={!!acting} data-testid="approval-to-cards">{acting === 'to_cards' ? 'AI 가 만드는 중…' : '이미지 카드뉴스로 바꿔 만들기 · 0크레딧'}</Button>}</div>}
      </div>}
      {canAct && VIDEO_KINDS.includes(c.kind ?? '') && <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-2" data-testid="approval-slideshow-row">
        <Button size="sm" variant="secondary" onClick={slideshow} disabled={slide || !!acting} data-testid="approval-slideshow">{slide ? '만드는 중…' : '실제 사진으로 영상 만들기 · 0원'}</Button>
        <Button size="sm" variant="secondary" onClick={openRecs} disabled={slide || !!acting} data-testid="approval-screen">녹화 파일로 영상 만들기 · 0원</Button>
        <span>자료실의 현장 사진 3~6장이나 앱 화면 녹화에 자막·끝 화면을 붙입니다</span>
        {recs && <ul className="w-full space-y-1 rounded-input border border-line p-1.5" data-testid="approval-screen-list">
          {recs.map((f) => <li key={f.id}><button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-50" onClick={() => pickRec(f.id)} disabled={slide} data-testid="approval-screen-pick">
            <span className="min-w-0 flex-1 truncate">{f.title}</span>{f.mine && <span className="shrink-0 text-violet-700">이 브랜드</span>}{f.used && <span className="shrink-0 text-ink-3">쓴 적 있음</span>}<span className="shrink-0 text-ink-3">{f.at.slice(5, 10).replace('-', '/')}</span></button></li>)}
          {!recs.length && <li className="px-2 py-1 text-ink-3" data-testid="approval-screen-empty">자료실 &apos;마케팅/화면 녹화&apos;에 녹화 파일이 없습니다. 로컬 PC 녹화 실행기로 올려 주세요</li>}
        </ul>}</div>}
      {unprocessed && canDecide && !done && <div className="mt-1 flex flex-wrap items-center gap-2 rounded-input border border-violet-200 bg-violet-50 px-2 py-1.5 text-[11px] text-violet-900" data-testid="approval-revise-pending">
        <span className="min-w-0 flex-1">수정 요청이 아직 AI 수정본으로 만들어지지 않았습니다{c.last_decision?.comment ? ` — "${c.last_decision.comment.slice(0, 60)}"` : ''}</span>
        <Button size="sm" onClick={() => act('revise')} disabled={!!acting} data-testid="approval-revise-now">{acting === 'revise' ? 'AI 가 고치는 중…' : 'AI 수정본 만들기'}</Button></div>}
      {media.length > 0 && !showMedia && <p className="mt-2 text-[11px] text-ink-3" data-testid="approval-media-later">시안 {media.length}장</p>}
      {media.length > 0 && showMedia && (
        <div className="mt-2">
          {/* 요청 C §3-5(대표 10/25 22:20 '승인함에서 전체 장을 넘겨 보기'): 카드뉴스·스토리 프레임·블로그 사진을 카드 안에서 손가락·화살표로 넘김(한 장짜리는 썸네일만) */}
          {media.length > 1 && <div className="mx-auto mb-2 max-w-[280px]" data-testid="approval-pages" data-count={media.length}><Slides media={media} info={c.media_info ?? []} aspect={c.kind === 'story' || c.kind === 'reels' || c.kind === 'shorts' ? 'aspect-[9/16]' : c.channel === 'blog' ? 'aspect-square' : 'aspect-[4/5]'} dots="below" tid="approval-pages" /></div>}
          <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:thin]">{media.map((m, k) => (
            <button key={m} type="button" onClick={() => { setIdx(k); setFull(true); }} className={cx('relative size-20 shrink-0 overflow-hidden rounded-input border', k === 0 ? 'border-violet-400' : 'border-line')} aria-label={`시안 ${k + 1} 크게 보기`}>
              <MediaThumb src={`/api/library/${m}/download?inline=1`} mime={mimeOf(c.media_info, m)} poster={isVideoMime(mimeOf(c.media_info, m)) && posterFrom(c.media_info, m) ? `/api/library/${posterFrom(c.media_info, m)}/download?inline=1` : null} className="size-full object-cover" />{k === 0 && <span className="absolute left-0 top-0 rounded-br bg-violet-600 px-1 text-[10px] text-white">표지</span>}
            </button>))}</div>
          <p className="mt-0.5 text-[11px] text-ink-3">{media.length}장 — 옆으로 넘겨 보기</p>
          {/* #615 ④(대표 10/25): 얼굴이 나온 실사 사진이 붙은 글은 승인 전에 촬영·게시 동의 확인 */}
          {(c.media_info ?? []).some((m) => media.includes(m.id) && m.faces) && <p className="mt-1 rounded-input border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900" data-testid="approval-face-warning">얼굴이 나온 실사 사진이 있습니다 — 촬영·게시 동의를 받은 사진인지 확인한 뒤 승인해 주세요.</p>}
          {media.some((m) => isVideoMime(mimeOf(c.media_info, m))) && <VideoDigestButton fileId={media.find((m) => isVideoMime(mimeOf(c.media_info, m)))!} title={c.title} mode="review" />}
        </div>)}
      {/* 대표 재지적 10/20 18:45 ②: 시안이 없어도 카드 첫 화면에 자리(회색 상자)를 늘 보여 줌 — 제작 중이면 예정 시각
          #516 (c): 시안 없이는 승인할 수 없는 카드(스레드 빼고)는 빨간 띠 '시안 없음' + [지금 만들기](서버 그리기, 크레딧 0) — [승인] 단추는 숨김 */}
      {media.length === 0 && <div className={cx('mt-2 flex items-center gap-3 rounded-input border p-2', noVisual ? 'border-red-300 bg-red-50' : 'border-dashed border-line bg-slate-50')} data-testid="approval-no-media" data-blocked={noVisual || undefined}>
        <div className={cx('flex size-20 shrink-0 items-center justify-center rounded-input text-center text-[11px] leading-tight', noVisual ? 'bg-red-100 font-semibold text-red-800' : 'bg-slate-200 text-ink-2')}>{c.production || (c.auto && !c.produced_at) ? '시안\n제작 중'.split('\n').map((t, i) => <span key={i} className="block">{t}</span>) : '시안 없음'}</div>
        <div className="min-w-0 flex-1 space-y-1">
          {noVisual && <p className="text-xs font-bold text-red-800" data-testid="approval-no-media-band">시안 없음 — 글만으로는 승인할 수 없습니다</p>}
          <p className="text-xs text-ink-2">{c.production ? `${c.production.kind.includes('video') ? '영상' : '이미지'} 제작 요청이 열려 있습니다${c.production.status === 'needs_approval' ? ' (한도 승인 대기)' : ''} — 붙으면 여기에 보입니다` : c.auto && !c.produced_at && c.produce_at ? `AI 제작 예정 ${fmtDateTime(c.produce_at)}` : drawable ? '[지금 만들기]를 누르면 브랜드 키트·자료실 사진으로 바로 그려 붙입니다(크레딧 0)' : '아직 시안이 없습니다 — 상세에서 수정본에 사진을 붙여 주세요'}</p>
          {noVisual && !done && (drawable ? <Button size="sm" onClick={() => makeNow()} disabled={making} data-testid="approval-make-visual">{making ? '그리는 중…' : '지금 만들기'}</Button>
            : VIDEO_KINDS.includes(c.kind ?? '') ? <Link href="/s/marketing/automation" className="inline-block text-xs font-medium text-violet-700 underline" data-testid="approval-production-link">제작 요청 카드 보기 →</Link> : null)}
        </div>
      </div>}
      {/* #497 R06 ⑥: 상세와 같은 '실제 게시 화면' 틀을 카드에서도(기본 접힘 — 승인함 길이 유지) */}
      {(media.length > 0 || c.body) && <button type="button" onClick={() => setLook(!look)} className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-violet-700" aria-expanded={look} data-testid="approval-look">
        {look ? <><ChevronUp size={14} aria-hidden />게시 화면 접기</> : <><ChevronDown size={14} aria-hidden />게시 화면으로 보기</>}</button>}
      {look && <div className="mt-2"><ChannelPreview channel={c.channel} kind={c.kind} brand={c.brand} handle={c.handle} logo={c.brand_logo} color={c.brand_color} title={c.title} body={c.body ?? ''} media={media} info={c.media_info ?? []} /></div>}
      {/* #545: 수정본이면 이전 버전과 나란히(시안·글, 바뀐 줄 표시) */}
      {!simple && !!from && c.current_version > 1 && <button type="button" onClick={() => setCmp(!cmp)} className="ml-3 mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-violet-700" aria-expanded={cmp} data-testid="approval-compare">
        {cmp ? <><ChevronUp size={14} aria-hidden />비교 접기</> : <><ChevronDown size={14} aria-hidden />이전 버전(v{from})과 나란히 비교</>}</button>}
      {cmp && !!from && <VersionCompare id={c.id} from={from} to={c.current_version} />}
      {issues.length > 0 && <p className="mt-1 rounded-input bg-amber-50 px-2 py-1 text-[11px] text-amber-800" data-testid="approval-issues">{issues.join(' · ')}</p>}
      <WhyBox r={c.rationale} compact />
      {/* 대표 재지적 10/20 18:45 ①: 본문은 2줄(PC 4줄)만 보이고 [더보기] 글자 버튼(아이콘+글자)으로 펼침 — 전에는 줄임표(…)만 보여 누를 수 있는지 몰랐음 */}
      {c.body && <div className="mt-2 text-xs">
        <p className={cx('whitespace-pre-wrap text-ink', !bodyOpen && 'line-clamp-2 md:line-clamp-4')} data-testid="approval-body">{c.body}</p>
        <button type="button" onClick={() => setBodyOpen(!bodyOpen)} className="mt-0.5 inline-flex items-center gap-0.5 font-medium text-violet-700" aria-expanded={bodyOpen} data-testid="approval-body-more">{bodyOpen ? <><ChevronUp size={14} aria-hidden />접기</> : <><ChevronDown size={14} aria-hidden />더보기</>}</button>
      </div>}
      {c.version_note && bodyOpen && <p className="mt-1 text-xs text-ink-2">제작 메모: {c.version_note}</p>}
      {d && d.version === c.current_version && <p className="mt-1 text-[11px] text-ink-3" data-testid="mkt-decision-line">{({ approve: '승인', changes: '수정 요청', hold: '보류' } as Record<string, string>)[d.decision] ?? d.decision} · {kst(d.at, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} KST{d.by ? ` · ${d.by}` : ''}{d.comment ? ` · 메모: ${d.comment}` : ''}{c.published_url ? <> · <a href={c.published_url} target="_blank" rel="noopener" className="underline">게시물 열기</a></> : null}</p>}
      {canAct && (mode === 'idle' ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {c.status !== 'approved' && !noVisual && <Button size="sm" onClick={() => decide('approve')} data-testid="card-approve">{c.reapprove_from ? `수정본 v${c.current_version} 승인` : '승인'}</Button>}
          <Button size="sm" variant="secondary" onClick={() => setMode('changes')} data-testid="card-changes">{c.status === 'approved' ? '게시 전 수정 요청' : '수정 요청'}</Button>
          {/* #516 후속: 서버가 그린 시안이 어색하면(바탕 글자 겹침 등) 브랜드 색 바탕으로 무료로 다시 그림(블로그는 대표 이미지만) */}
          {!simple && c.status !== 'approved' && media.length > 0 && c.quality?.visual?.by === 'server' && drawable && <Button size="sm" variant="secondary" onClick={() => makeNow(true)} disabled={making} data-testid="card-redraw">{making ? '그리는 중…' : c.brand_templates ? '다른 틀로 다시 그리기' : '브랜드 색으로 다시 그리기'}</Button>}
          {/* #516 (a): 서버가 그린 시안 → Higgsfield AI 이미지로 바꾸기는 크레딧이 들어 따로(제작 요청 카드·한도 확인) */}
          {!simple && c.auto && c.status !== 'approved' && media.length > 0 && c.quality?.visual?.by === 'server' && drawable && <Button size="sm" variant="secondary" data-testid="card-ai-image"
            onClick={() => confirm(`AI 이미지로 다시 만들면 약 ${AI_REGEN_CREDITS}크레딧이 듭니다(이번 달 한도를 넘으면 한도 승인 뒤 제작). 지금 시안은 그대로 두고 새 이미지가 붙으면 다시 승인 요청이 옵니다. 진행할까요?`) && decide('changes', AI_REGEN)}>AI 이미지로 다시 · 약 {AI_REGEN_CREDITS}크레딧</Button>}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2"><input className={cx(inputCls, 'min-w-0 flex-1')} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="무엇을 고칠지(사유, 두 글자 이상) — AI 가 반영해 다시 올립니다" aria-label="수정 요청 메모" data-testid="card-changes-memo" />
          <Button size="sm" disabled={busy || memo.trim().length < 2} onClick={() => decide('changes')} data-testid="card-changes-send">{busy ? 'AI 가 고치는 중…' : '수정 요청 보내기'}</Button><Button size="sm" variant="secondary" onClick={() => setMode('idle')}>취소</Button></div>
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
