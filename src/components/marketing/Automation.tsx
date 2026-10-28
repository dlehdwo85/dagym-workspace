'use client';
import { dtf } from '@/lib/dtf';
import { useInApp } from '@/components/inApp';
import { CompanyAiProfile } from '@/components/CompanyAiProfile';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { CHANNELS } from './Marketing';
import { BrandVideoKit } from './BrandVideoKit';
import { BrandFeedKit, type Feed, type FeedCatalog } from './BrandFeedKit';
import { MediaPick } from './MediaPick';
import { Studio } from './Studio';
import { CarouselStudio } from './Carousel';
import { BrandVoice, type Voice } from './BrandVoice';
import { BrandFacts, type Facts } from './BrandFacts';
import { BrandExamples, type Example } from './BrandExamples';
import { BrandKitAi } from './BrandKitAi';
import { BrandMerge } from './BrandMerge';
import { MktPhotos } from './MktPhotos';
import { MODE_HINT, ModeChip, ModeToggle, asMode, type Mode } from './ModeToggle';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

const C = '#7C3AED';
const KIND: Record<string, string> = { feed: '피드', blog: '블로그', reels: '릴스', shorts: '쇼츠', story: '스토리', video: '생성 영상', photo: '사진 게시물' }; // 요청 C §3-1: 피드 = 카드뉴스 3~5장 · 사진 1장짜리는 '사진 게시물'
const CROSS: Record<string, string> = { facebook: '페이스북', instagram: '인스타그램', threads: '스레드' };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
/** 묶음 기본 시각(src/lib/mktAuto BUNDLE 과 같음) — 로컬 10/20 보완 ②: 브랜드별로 한 번에 바꿀 수 있음 */
const BUNDLE_TIMES: Record<string, string> = { feed: '10:00', shorts: '11:00', reels: '12:00', blog: '13:00', story: '18:00' };
const BUNDLE_KINDS = ['feed', 'shorts', 'reels', 'blog', 'story'];
const REQ: Record<string, string> = { image: '이미지', video: '영상', regen_image: '이미지 재생성', regen_video: '영상 재생성', topic: '주제 필요' };
type Production = { planCode: string | null; planLabel: string | null; monthlyCredits: number | null; usedCredits: number; leftCredits: number | null; images: number | null; videos: number | null; videosLeft: number | null; regensLeft: number | null; weekly: { kind: string; label: string; limit: number; used: number }[]; over: boolean; shortfall: number; extraCreditKrw: number | null; overMessage: string | null };
type View = { full?: boolean; production?: Production | null; settings: any; writeModel?: { tier: string; label: string; model?: string; perDraftKrw?: number; source: 'company' | 'plan' | 'base'; blog?: { label: string; model?: string; perDraftKrw?: number; upgraded: boolean; extraKrw?: number } }; limits: { monthlyCredits: number | null; weeklyCredits: number | null; videoMonthly: number | null; regenMonthly: number | null; aiMonthlyUsd: number | null };
  usage: { weekCredits: number; monthCredits: number; monthVideos: number; monthRegens: number; ai?: { usd: number; requests: number }; companyAiUsd?: number; companyAiLimitUsd?: number; companyAi?: { usedKrw: number; limitKrw: number | null; pct: number | null; resetLabel: string } }; plans: Record<string, { label: string; weekly: Record<string, number>; monthlyCredits: number; videoMonthly: number; regenMonthly: number; price: number | null }>;
  rules: any[]; requests: any[]; ledger: any[]; brands: { id: string; name: string; tone: string | null; intro: string | null; products: string | null; weekly_topic: string | null; banned_words: string[]; test_mode: boolean; voice?: Partial<Voice> | null; facts?: Facts | null; topic_pool?: string[] | null; examples?: Example[] | null; ad_priority?: number | null; ad_share?: number | null; ad_note?: string | null; color?: string | null; video?: Record<string, string | null> | null; feed?: Feed | null; draw?: { color: string | null; from: 'feed' | 'video' | 'brand' | 'company' | null } }[]; people: { id: string; name: string; role: string }[]; canEdit: boolean; feedCatalog?: FeedCatalog };
const lim = (used: number, max: number | null) => (max === null ? `${used} (한도 없음)` : `${used} / ${max}`);

/** V41 4-3 + V43: 자동 제작 — 요금제·한도·사용량, 일정·마감·알림, 브랜드 키트, 주간 규칙, 제작 요청 카드, 크레딧 원장 */
export function Automation() {
  const tabQ = useSearchParams().get('tab'); const tab = tabQ === 'studio' || tabQ === 'cards' ? tabQ : 'rules'; // 대표 10/20 19:00: '제작의뢰실' 탭 · #499-5 '카드뉴스' 탭
  const { data, error, reload } = useApi<View>('/api/marketing/auto');
  const inApp = useInApp(); // 스토어 심사: 앱 안에서는 요금제 링크 없음(요금제 고르기는 사용량·요금제 화면 — 대표 10/27 ⑤)
  const [rule, setRule] = useState({ brandId: '', channel: 'instagram', kind: 'feed', weekdays: [2, 4] as number[], postTime: '10:00', topicHint: '', mode: 'content' as Mode });
  // 로컬 10/20 보완: 묶음은 n일마다(+주말 건너뛰기) 또는 요일 지정(월·수·금), 종류별 시각 한 번에
  const [bundle, setBundle] = useState({ brandId: '', mode: 'interval' as 'interval' | 'weekdays', intervalDays: 3, skipWeekend: false /* 대표 15:40: 기본 끔 */, weekdays: [1, 3, 5] as number[], startDate: dtf('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()), times: { ...BUNDLE_TIMES } });
  async function addBundle(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body = bundle.mode === 'weekdays' ? { brandId: bundle.brandId || null, weekdays: bundle.weekdays, times: bundle.times } : { brandId: bundle.brandId || null, intervalDays: bundle.intervalDays, startDate: bundle.startDate, skipWeekend: bundle.skipWeekend, times: bundle.times };
      const r = await api<{ planned: number }>('/api/marketing/auto/bundle', { body }); toast.ok(`묶음 규칙 5개 추가 — 앞으로 2주 칸 ${r.planned}개`); reload();
    } catch (er: any) { toast.error(er.message); }
  }
  const [done, setDone] = useState<Record<string, { credits: string; media: { id: string; title: string }[] }>>({});
  const [topics, setTopics] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [archived, setArchived] = useState<string | null>(null); // 전면 정리 결과 한 줄
  const [nb, setNb] = useState({ name: '', test: false });
  const [kitVer, setKitVer] = useState<Record<string, number>>({}); // 190차 [AI로 채우기] 저장 뒤 그 브랜드 칸들을 새 값으로 다시 그림(입력 칸은 처음 값만 읽음)
  async function addBrand() {
    const name = nb.name.trim(); if (!name) return;
    setBusy(true);
    try { const r = await api<{ brand: { name: string; test_mode: boolean } }>('/api/marketing/auto/brands', { body: { name, testMode: nb.test } }); setNb({ name: '', test: false }); toast.ok(`브랜드 '${r.brand.name}' 추가${r.brand.test_mode ? '(시험 모드)' : ''}`); reload(); }
    catch (er: any) { toast.error(`브랜드 추가 실패: ${er.message}`); } finally { setBusy(false); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={6} />;
  const s = data.settings; const ed = data.canEdit;
  async function save(patch: Record<string, unknown>) { try { await api('/api/marketing/auto', { method: 'PUT', body: patch }); toast.ok('저장했습니다'); reload(); } catch (e: any) { toast.error(e.message); } }
  // 대표 10/25 22:20 전면 정리(로컬 요청 A): 미게시 글(초안·승인 대기·수정 요청·보류)을 한 번에 '취소'로 보관 — 먼저 건수를 보고(dryRun) 확인 → 실행 → [되돌리기]
  const ARCH_LABEL: Record<string, string> = { draft: '초안', pending: '승인 대기', changes: '수정 요청', hold: '보류', approved: '승인됨' };
  async function archiveAll() {
    setBusy(true);
    try {
      const dry = await api<any>('/api/marketing/contents/archive', { body: { dryRun: true } });
      const parts = Object.entries(dry.byStatus ?? {}).map(([k, n]) => `${ARCH_LABEL[k] ?? k} ${n}`).join(' · ');
      if (!dry.count) { toast.ok('보관할 미게시 글이 없습니다'); return; }
      if (!confirm(`${parts} = 총 ${dry.count}건을 '취소'로 보관합니다. 게시됨·승인됨은 그대로 두고, 원래 상태를 기록해 [되돌리기]로 복원할 수 있습니다. 계속할까요?`)) return;
      const r = await api<any>('/api/marketing/contents/archive', { body: {} });
      setArchived(`${new Date().toLocaleString('ko-KR')} 보관 ${r.count}건(${parts})`); toast.ok(`${r.count}건을 보관했습니다`); reload();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function unarchive() {
    if (!confirm('가장 최근에 보관한 묶음을 원래 상태(초안·승인 대기·수정 요청·보류)로 되돌릴까요?')) return;
    setBusy(true);
    try { const r = await api<any>('/api/marketing/contents/unarchive', { body: {} }); setArchived(`되돌림 ${r.count}건`); toast.ok(`${r.count}건을 되돌렸습니다`); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function addRule(e: React.FormEvent) { e.preventDefault(); try { const r = await api<{ planned: number }>('/api/marketing/auto/rules', { body: { ...rule, brandId: rule.brandId || null, topicHint: rule.topicHint || undefined } }); toast.ok(`규칙 추가 — 앞으로 2주 ${r.planned}칸`); reload(); } catch (er: any) { toast.error(er.message); } }
  async function act(id: string, action: string) {
    const d = done[id];
    try { await api(`/api/marketing/auto/requests/${id}`, { method: 'PATCH', body: { action, ...(topics[id] ? { topic: topics[id] } : {}), ...(action === 'done' && d ? { credits: d.credits === '' ? undefined : Number(d.credits), mediaIds: d.media.map((m) => m.id) } : {}) } }); reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function runNow() { setBusy(true); try { const r = await api<any>('/api/marketing/auto/run', { body: {} }); const bad = r.produced.filter((p: any) => p.error); const ask = r.produced.filter((p: any) => p.needsTopic).length;
    toast.ok(`칸 ${r.planned} · 제작 ${r.produced.length - bad.length - ask}${ask ? ` · 주제 필요 ${ask}` : ''}${r.left ? ` · 남은 ${r.left}건은 다음 실행에` : ''}${r.busy ? ' · 다른 제작이 진행 중이라 이번엔 건너뜀' : ''} · 알림 ${r.reminded} · 정리 ${r.expired}`); if (bad.length) toast.error(`제작 실패 ${bad.length}건: ${bad[0].error}`); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }
  const num = (v: string) => (v === '' ? null : Number(v));
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="mkt-automation">
      <div className="flex gap-1 border-b border-line" role="tablist">{([['rules', '자동 제작'], ['studio', '제작의뢰실'], ['cards', '카드뉴스']] as [string, string][]).map(([k, l]) => <Link key={k} href={k === 'rules' ? '/s/marketing/automation' : `/s/marketing/automation?tab=${k}`} role="tab" aria-selected={tab === k} className={cx('px-3 py-1.5 text-sm', tab === k ? 'border-b-2 font-semibold' : 'text-ink-2')} style={tab === k ? { borderColor: C, color: C } : undefined} data-testid={`auto-tab-${k}`}>{l}</Link>)}</div>
      {tab === 'cards' ? <><h1 className="text-xl font-bold" style={{ color: C }}>카드뉴스</h1><CarouselStudio /></> : tab === 'studio' ? <><h1 className="text-xl font-bold" style={{ color: C }}>제작의뢰실</h1><Studio /></> : <>
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold" style={{ color: C }}>자동 제작</h1>
        {ed && <Button size="sm" variant="secondary" className="ml-auto" onClick={runNow} disabled={busy} data-testid="auto-run">{busy ? '도는 중…' : '지금 한 번 돌리기'}</Button>}</div>
      <p className="text-xs text-ink-2" data-testid="auto-ai-note">AI 원고는 회사 월 AI 예산(이번 달 {data.usage.companyAi ? `${data.usage.companyAi.usedKrw.toLocaleString('ko-KR')}원 / ${data.usage.companyAi.limitKrw === null ? '무제한' : `${data.usage.companyAi.limitKrw.toLocaleString('ko-KR')}원`}` : `$${data.usage.companyAiUsd} / $${data.usage.companyAiLimitUsd}`})과 마케팅 AI 월 한도 중 먼저 닿는 쪽에서 멈추고(예산은 {data.usage.companyAi?.resetLabel ?? '다음 달 1일'}에 다시 채워짐), 받는 사람에게 하루 한 번 알립니다. 영상 제작은 마케팅 크레딧으로 따로 셉니다. 회사 전체 AI 사용은 <a className="underline" href="/admin/usage">관리 → 사용량·요금제</a>(기능별 “마케팅”).</p>
      {data.writeModel && <p className="text-xs text-ink-2" data-testid="auto-write-model">글 모델: <b className="text-ink">{data.writeModel.label}</b>{data.writeModel.model ? ` (${data.writeModel.model}) · 원고 1건 약 ${data.writeModel.perDraftKrw?.toLocaleString('ko-KR')}원` : ''} — {data.writeModel.source === 'company' ? '운영사가 이 회사에 정한 값' : data.writeModel.source === 'plan' ? '마케팅 요금제 기본값' : '기본값'} · 원고·수정본에 쓰고, 품질 검사는 빠른 모델로 합니다.
        {data.writeModel.blog && <span className="block" data-testid="auto-write-model-blog">네이버 블로그(1,800~2,500자·사진 8~15장 형식): <b className="text-ink">{data.writeModel.blog.label}</b>{data.writeModel.blog.model ? ` (${data.writeModel.blog.model}) · 1건 약 ${data.writeModel.blog.perDraftKrw?.toLocaleString('ko-KR')}원` : ''}{data.writeModel.blog.upgraded ? (data.writeModel.blog.extraKrw !== undefined ? ` — 빠른 모델로 쓸 때보다 1건 약 ${data.writeModel.blog.extraKrw.toLocaleString('ko-KR')}원 더(블로그만 상위 모델)` : ' — 블로그만 상위 모델') : ''}</span>}</p>}
      <p className="text-xs text-ink-2">주간 규칙대로 게시 {s.lead_days}일 전 {s.lead_hour}:00 에 AI 마케터가 원고를 쓰고 품질 검사를 통과하면 승인 대기에 올립니다. 이미지·영상은 제작 요청 카드로(실사 사진 + 글자 렌더 우선, 생성 엔진은 계약 후 연결). 승인 마감 = 게시 당일 {s.approval_hour}:00, 알림 = 제작 완료 즉시 + 마감 {s.remind_hours}시간 전({s.quiet_start}~{s.quiet_end}시는 무알림 → 직전 저녁).</p>

      <section className="grid gap-3 sm:grid-cols-5">{([['이번 주 크레딧', lim(data.usage.weekCredits, data.limits.weeklyCredits)], ['이번 달 크레딧', lim(data.usage.monthCredits, data.limits.monthlyCredits)],
        ['이번 달 생성 영상', lim(data.usage.monthVideos, data.limits.videoMonthly)], ['이번 달 재생성', lim(data.usage.monthRegens, data.limits.regenMonthly)],
        data.usage.ai ? ['이번 달 마케팅 AI($)', lim(data.usage.ai.usd, data.limits.aiMonthlyUsd)] : ['이번 달 마케팅 AI', data.usage.companyAi ? `${data.usage.companyAi.usedKrw.toLocaleString('ko-KR')}원 / ${data.usage.companyAi.limitKrw === null ? '무제한' : `${data.usage.companyAi.limitKrw.toLocaleString('ko-KR')}원`}` : '-']] as [string, string][]) /* #602 고객사: 달러 대신 회사 AI 예산(원) */.map(([l, v]) => (
        <div key={l} className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="auto-usage"><div className="text-xs text-ink-2">{l}</div><div className="mt-1 text-lg font-bold tabular-nums" style={{ color: C }}>{v}</div></div>))}</section>

      {/* 대표 10/20 15:40 (#103): 이번 달 남은 제작 n건 + 초과 안내 */}
      {data.production && (
        <section className={cx('rounded-card border p-3 shadow-card', data.production.over ? 'border-red-200 bg-red-50/40' : 'border-violet-200 bg-violet-50/30')} data-testid="auto-production">
          <div className="flex flex-wrap items-center gap-2 text-sm"><b>이번 달 남은 제작</b>
            {data.production.leftCredits === null ? <span className="text-ink-2">마케팅 제작 요금제를 고르면 남은 제작 수가 보입니다</span> : <span className="tabular-nums" data-testid="auto-production-left">크레딧 {data.production.leftCredits} / {data.production.monthlyCredits} → 이미지 <b>{data.production.images}장</b> 또는 영상 <b>{data.production.videos}편</b>{data.production.videosLeft !== null && ` · 생성 영상 ${data.production.videosLeft}편`}{data.production.regensLeft !== null && ` · 재생성 ${data.production.regensLeft}회`}</span>}
            {/* 대표 10/27 ⑤: 요금제 고르기·한도는 사용량·요금제 화면 한곳에서 — 여기는 제작만 */}
            <span className="ml-auto text-xs text-ink-3">{data.production.planLabel ? `${data.production.planLabel} 요금제` : '요금제 없음'}{ed && !inApp && <> · <Link href="/admin/usage#mkt-plan" className="font-semibold text-violet-700 underline" data-testid="auto-plan-link">요금제 보기·바꾸기</Link></>}</span></div>
          {data.production.weekly.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5 text-xs" data-testid="auto-production-weekly">{data.production.weekly.map((w) => <span key={w.kind} className={cx('rounded-full border px-2 py-0.5', w.used >= w.limit ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-line bg-white')}>이번 주 {w.label} {w.used}/{w.limit}</span>)}</div>}
          {data.production.overMessage && <p className="mt-1 text-xs text-red-800" data-testid="auto-production-over">{data.production.overMessage}</p>}
        </section>)}
      {ed && <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="auto-recipients">
        <h2 className="text-sm font-semibold">알림·승인 받는 사람</h2>
        <p className="mt-1 text-xs text-ink-2">고르지 않으면 관리자 전원. 시험 모드 브랜드는 여기와 상관없이 실행한 사람에게만 갑니다.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{data.people.map((p) => { const on = (s.notify_user_ids ?? []).includes(p.id); return (
          <button key={p.id} type="button" aria-pressed={on} data-testid="auto-recipient" onClick={() => save({ notifyUserIds: on ? (s.notify_user_ids ?? []).filter((x: string) => x !== p.id) : [...(s.notify_user_ids ?? []), p.id] })}
            className={cx('rounded-full border px-3 py-1 text-xs', on ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line bg-white')}>{p.name}</button>); })}
          {!!s.notify_user_ids?.length && <Button size="sm" variant="secondary" onClick={() => save({ notifyUserIds: null })}>관리자 전원으로</Button>}</div>
      </section>}

      {ed && <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="auto-schedule">
        <h2 className="text-sm font-semibold">제작·마감·알림</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <Field label="제작: 게시 며칠 전"><input className={inputCls} type="number" min={0} max={14} defaultValue={s.lead_days} onBlur={(e) => save({ leadDays: Number(e.target.value) })} /></Field>
          <Field label="제작 시각(시)"><input className={inputCls} type="number" min={0} max={23} defaultValue={s.lead_hour} onBlur={(e) => save({ leadHour: Number(e.target.value) })} /></Field>
          <Field label="승인 마감(게시 당일 시)"><input className={inputCls} type="number" min={0} max={23} defaultValue={s.approval_hour} onBlur={(e) => save({ approvalHour: Number(e.target.value) })} data-testid="auto-approval-hour" /></Field>
          <Field label="마감 몇 시간 전 알림"><input className={inputCls} type="number" min={0} max={72} defaultValue={s.remind_hours} onBlur={(e) => save({ remindHours: Number(e.target.value) })} /></Field>
          <Field label="무알림 시작(시)"><input className={inputCls} type="number" min={0} max={23} defaultValue={s.quiet_start} onBlur={(e) => save({ quietStart: Number(e.target.value) })} /></Field>
          <Field label="무알림 끝(시)"><input className={inputCls} type="number" min={0} max={23} defaultValue={s.quiet_end} onBlur={(e) => save({ quietEnd: Number(e.target.value) })} /></Field>
          {data.full !== false && <Field label="마케팅 AI 월 한도($, 비우면 요금제)"><input className={inputCls} type="number" min={0} step="0.5" defaultValue={s.ai_monthly_usd ?? ''} onBlur={(e) => save({ aiMonthlyUsd: e.target.value === '' ? null : Number(e.target.value) })} data-testid="auto-ai-limit" /></Field>}
          {/* 대표 10/25 22:20 결정 15-15: 'AI 도움을 받아 제작' 고지 문구는 더 붙이지 않음 — 입력 칸 뺌(예전 글의 줄은 다듬을 때 뗌) */}
          <div className="space-y-1 pt-5 text-xs">
            <label className="flex items-center gap-1.5 font-semibold text-red-700" title="대표 결정(10/25 22:20): 마케팅실 전면 디벨롭 동안 정기 칸 만들기·자동 제작·밤사이 비서·주간 계획·운영 제안 카드를 모두 멈춥니다. 사람이 누르는 [지금 만들기]·[승인 요청]·수정 요청 반영은 그대로. 대표가 새 방향을 승인하면 끄세요."><input type="checkbox" checked={!!s.auto_pause} onChange={(e) => { if (!e.target.checked && !confirm('자동 생성을 다시 켤까요? 대표가 디벨롭한 방향을 승인한 뒤에만 켜세요.')) return; save({ autoPause: e.target.checked }); }} data-testid="auto-pause" />자동 생성 일시정지(대표 방향 승인 전){s.auto_pause ? ' — 지금 멈춤' : ''}</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={s.allow_generated_people} onChange={(e) => save({ allowGeneratedPeople: e.target.checked })} />생성 인물 허용</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={s.allow_slideshow} onChange={(e) => save({ allowSlideshow: e.target.checked })} />슬라이드쇼 허용</label>
            <label className="flex items-center gap-1.5" title="대표 결정(10/24): 브랜드 템플릿이 나올 때까지 정기·밤사이 자동 제작 시안은 승인함에 올리지 않고 초안으로 둡니다. 승인함 아래 '초안 보관'에서 [승인 요청]으로 올릴 수 있습니다."><input type="checkbox" checked={!!s.auto_hold} onChange={(e) => save({ autoHold: e.target.checked })} data-testid="auto-hold" />자동 시안은 초안으로 보관(브랜드 템플릿 전)</label>
            <label className="flex items-center gap-1.5" title="189차(대표 #685): 서버 시안에 쓸 실사가 모자라 브랜드 색으로 남은 칸(표지·카드뉴스 장·스토리 프레임)을 같은 브랜드 실사(얼굴이 보이지 않는 사진)를 참고해 실사풍 사진으로 생성해 채웁니다. 한 글에 2장까지, 이번 주·이번 달 크레딧 한도 안에서만. 생성 사진은 자료실 '마케팅/AI 생성(실사 참고)'에 남고 사진 기록에 'AI 생성'으로 보입니다."><input type="checkbox" checked={!!s.photo_gen} onChange={(e) => save({ photoGen: e.target.checked })} data-testid="auto-photo-gen" />사진이 모자라면 실사 참고로 생성(크레딧)</label>
            <label className="flex items-center gap-1.5" title="대표 결정(10/25 22:20, 요청 C): 영상 제작 방식을 정할 때까지 릴스·쇼츠·생성 영상은 정기 칸을 만들지 않고 자동 제작도 하지 않습니다. 제작의뢰실에서 사람이 의뢰하는 영상은 그대로."><input type="checkbox" checked={s.video_pause !== false} onChange={(e) => save({ videoPause: e.target.checked })} data-testid="auto-video-pause" />릴스·쇼츠·생성 영상 자동 제작 중단(영상 제작 결정 전){s.video_pause !== false ? ' — 지금 멈춤' : ''}</label>
            <label className="flex items-center gap-1.5" title="승인된 최신 버전이 예정 시각이 되면 연결된 계정(인스타·페북·스레드·유튜브)에 워크인 서버가 올립니다. 승인이 곧 게시 결정입니다."><input type="checkbox" checked={!!s.auto_publish} onChange={(e) => save({ autoPublish: e.target.checked })} data-testid="auto-publish" />승인되면 예정 시각에 자동 게시(연결 채널)</label>
          </div>
        </div>
      </section>}

      {ed && <section className="rounded-card border border-red-200 bg-white p-4 shadow-card" data-testid="auto-archive">
        <h2 className="text-sm font-semibold text-red-700">전면 정리 <span className="font-normal text-ink-3">— 대표 10/25 22:20: 미게시 시안 전부 치우고 디벨롭한 방향을 검토받은 뒤 다시 올림</span></h2>
        <p className="mt-1 text-xs text-ink-2">미게시 글(초안·승인 대기·수정 요청·보류)을 한 번에 취소 상태로 보관합니다. 게시됨·승인됨은 그대로. 원래 상태를 기록해 두어 [되돌리기]로 복원할 수 있습니다.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="danger" onClick={archiveAll} disabled={busy} data-testid="auto-archive-run">미게시 글 전부 보관</Button>
          <Button size="sm" variant="secondary" onClick={unarchive} disabled={busy} data-testid="auto-archive-undo">되돌리기(가장 최근 묶음)</Button>
          {archived && <span className="text-xs text-ink-2" data-testid="auto-archive-result">{archived}</span>}
        </div>
      </section>}

      <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="auto-rules">
        <h2 className="text-sm font-semibold">게시 규칙 <span className="font-normal text-ink-3">— 기본값(대표 10/20): 브랜드마다 2~3일에 한 묶음(유튜브 쇼츠 1 · 인스타 릴스 1 · 블로그 1 · 인스타+페이스북 게시물 1 · 인스타+페이스북 스토리 1)</span></h2>
        <p className="mt-1 text-xs text-ink-2" data-testid="auto-rules-daycap">같은 브랜드·채널·형식(피드·릴스·블로그·스토리 따로)은 하루 2건까지 — 3시간 넘게 띄우고, 규칙이 겹쳐 넘치는 칸은 만들지 않습니다(먼저 만든 규칙 우선). 같은 날 같은 주제·같은 사진은 쓰지 않습니다.</p>
        {ed && <form onSubmit={addBundle} className="mt-2 flex flex-wrap items-center gap-2 rounded-input border border-violet-200 bg-violet-50/40 p-2 text-sm" data-testid="auto-bundle-form">
          <span className="text-xs font-medium text-violet-800">묶음 규칙 만들기</span>
          <select className={cx(inputCls, 'h-8 !w-auto')} value={bundle.brandId} onChange={(e) => setBundle({ ...bundle, brandId: e.target.value })} aria-label="묶음 브랜드"><option value="">브랜드 없음</option>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select className={cx(inputCls, 'h-8 !w-auto')} value={bundle.mode} onChange={(e) => setBundle({ ...bundle, mode: e.target.value as 'interval' | 'weekdays' })} aria-label="묶음 방식" data-testid="auto-bundle-mode"><option value="interval">n일마다</option><option value="weekdays">요일 지정</option></select>
          {bundle.mode === 'interval' ? <>
            <select className={cx(inputCls, 'h-8 !w-auto')} value={bundle.intervalDays} onChange={(e) => setBundle({ ...bundle, intervalDays: Number(e.target.value) })} aria-label="묶음 주기" data-testid="auto-bundle-interval"><option value={2}>2일마다</option><option value={3}>3일마다</option></select>
            <input type="date" className={cx(inputCls, 'h-8 !w-auto')} value={bundle.startDate} onChange={(e) => setBundle({ ...bundle, startDate: e.target.value })} aria-label="시작일" />
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={bundle.skipWeekend} onChange={(e) => setBundle({ ...bundle, skipWeekend: e.target.checked })} data-testid="auto-bundle-skip-weekend" />주말 건너뛰기(다음 평일)</label>
          </> : <span className="flex flex-wrap items-center gap-1">{DOW.map((d, k) => <button key={d} type="button" onClick={() => setBundle({ ...bundle, weekdays: bundle.weekdays.includes(k) ? bundle.weekdays.filter((x) => x !== k) : [...bundle.weekdays, k].sort() })}
            className={cx('size-7 rounded-full border text-xs', bundle.weekdays.includes(k) ? 'border-violet-600 bg-violet-600 text-white' : 'border-line bg-white')} aria-pressed={bundle.weekdays.includes(k)} data-testid={`auto-bundle-dow-${k}`}>{d}</button>)}</span>}
          <span className="flex flex-wrap items-center gap-1 text-xs" data-testid="auto-bundle-times">{BUNDLE_KINDS.map((k) => <label key={k} className="flex items-center gap-0.5">{KIND[k]}<input type="time" className={cx(inputCls, 'h-7 !w-auto px-1')} value={bundle.times[k]} onChange={(e) => setBundle({ ...bundle, times: { ...bundle.times, [k]: e.target.value } })} aria-label={`${KIND[k]} 시각`} data-testid={`auto-bundle-time-${k}`} /></label>)}</span>
          <Button type="submit" size="sm" data-testid="auto-bundle-add">묶음 5개 추가</Button>
        </form>}
        {ed && bundleGroups(data.rules).map((g) => <BundleTimes key={g.key} bundleKey={g.key} brand={g.brand} rules={g.rules} onDone={reload} />)}
        <ul className="mt-2 divide-y divide-line text-sm">{data.rules.map((r) => (
          <li key={r.id} className={cx('flex flex-wrap items-center gap-2 py-2', !r.active && 'opacity-50')} data-testid="auto-rule">
            <span className="font-medium">{r.brand ?? '브랜드 없음'}</span><span className="text-xs text-ink-2">{CHANNELS[r.channel as keyof typeof CHANNELS]}{(r.cross_channels ?? []).length ? `+${(r.cross_channels as string[]).map((c) => CROSS[c] ?? c).join('·')}` : ''} · {KIND[r.kind]} · {r.interval_days ? `${r.interval_days}일마다(${r.anchor_date ?? ''}부터${r.skip_weekend ? '·주말 건너뜀' : ''})` : (r.weekdays as number[]).map((d) => DOW[d]).join('·')} {r.post_time}{r.topic_hint ? ` · ${r.topic_hint}` : ''}{r.bundle_key && <span className="ml-1 rounded-full bg-violet-50 px-1.5 text-[10px] text-violet-700">묶음</span>}</span>
            {!ed && <ModeChip mode={r.mode} />}
            {ed && <span className="ml-auto flex flex-wrap items-center gap-1.5"><ModeToggle value={asMode(r.mode)} testId="auto-rule-row-mode" onChange={async (m) => { try { await api(`/api/marketing/auto/rules/${r.id}`, { method: 'PATCH', body: { mode: m } }); toast.ok(m === 'ad' ? '광고형으로 — 아직 안 만든 칸도 광고형으로 만듭니다' : '콘텐츠형으로 — 아직 안 만든 칸도 콘텐츠형으로 만듭니다'); reload(); } catch (e: any) { toast.error(e.message); } }} />
              <Button size="sm" variant="secondary" onClick={async () => { await api(`/api/marketing/auto/rules/${r.id}`, { method: 'PATCH', body: { active: !r.active } }); reload(); }}>{r.active ? '멈춤' : '켜기'}</Button>
              <Button size="sm" variant="secondary" onClick={async () => { if (!confirm('규칙을 지울까요? 아직 제작 안 한 칸도 같이 지워집니다.')) return; await api(`/api/marketing/auto/rules/${r.id}`, { method: 'DELETE' }); reload(); }}>지우기</Button></span>}
          </li>))}{!data.rules.length && <li className="py-2 text-xs text-ink-3">규칙이 없습니다 — 예: 인스타그램 피드 화·목 10:00</li>}</ul>
        {ed && <form onSubmit={addRule} className="mt-3 grid gap-2 sm:grid-cols-6" data-testid="auto-rule-form">
          <select className={inputCls} value={rule.brandId} onChange={(e) => setRule({ ...rule, brandId: e.target.value })} aria-label="브랜드"><option value="">브랜드 없음</option>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select className={inputCls} value={rule.channel} onChange={(e) => setRule({ ...rule, channel: e.target.value })} aria-label="채널">{Object.entries(CHANNELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select className={inputCls} value={rule.kind} onChange={(e) => setRule({ ...rule, kind: e.target.value })} aria-label="종류" data-testid="auto-rule-kind">{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span className="flex flex-wrap items-center gap-1">{DOW.map((d, k) => <button key={d} type="button" onClick={() => setRule({ ...rule, weekdays: rule.weekdays.includes(k) ? rule.weekdays.filter((x) => x !== k) : [...rule.weekdays, k] })}
            className={cx('size-7 rounded-full border text-xs', rule.weekdays.includes(k) ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white')} aria-pressed={rule.weekdays.includes(k)} aria-label={`${d}요일`}>{d}</button>)}</span>
          <input type="time" className={inputCls} value={rule.postTime} onChange={(e) => setRule({ ...rule, postTime: e.target.value })} aria-label="게시 시각" />
          <Button type="submit" disabled={!rule.weekdays.length} data-testid="auto-rule-add">규칙 추가</Button>
          <input className={cx(inputCls, 'sm:col-span-6')} value={rule.topicHint} onChange={(e) => setRule({ ...rule, topicHint: e.target.value })} placeholder="주제 힌트(선택) — 예: 신규 회원 이벤트, 시설 소개" aria-label="주제 힌트" />
          {/* #499-1 용도: 콘텐츠형(참여)·광고형(전환) — AI 가 쓰는 첫 줄·구성과 훅 채점이 다름 */}
          <span className="flex flex-wrap items-center gap-2 text-xs text-ink-2 sm:col-span-6"><span className="font-medium text-ink">용도</span><ModeToggle value={rule.mode} onChange={(m) => setRule({ ...rule, mode: m })} testId="auto-rule-mode" /><span className="text-ink-3">{MODE_HINT[rule.mode]}</span></span>
        </form>}
      </section>

      {ed && <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="auto-brands">
        <h2 className="text-sm font-semibold">브랜드 키트</h2>
        {/* 로컬 10/19: 회사 정보(사업 소개·고객·말투·주의할 점)와 같은 칸 + 'AI 로 정리' — 한 번 정리하면 마케팅 원고·메일 시안·영업 제안서가 함께 씀 */}
        <details className="mt-2 rounded-input border border-line p-2" data-testid="brand-company-ai"><summary className="cursor-pointer text-xs font-medium">회사 소개·말투·주의할 점(모든 브랜드 공통) — AI 로 정리</summary><div className="mt-2"><CompanyAiProfile compact /></div></details>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className={cx(inputCls, 'w-48')} value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBrand(); } }} placeholder="새 브랜드 이름" maxLength={40} aria-label="새 브랜드 이름" data-testid="auto-brand-name" />
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={nb.test} onChange={(e) => setNb({ ...nb, test: e.target.checked })} />시험 모드로</label>
          <Button type="button" size="sm" onClick={addBrand} disabled={!nb.name.trim() || busy} data-testid="auto-brand-add">브랜드 추가</Button>
        </div>
        {!data.brands.length && <p className="mt-2 text-xs text-ink-3">브랜드가 없습니다 — 추가하면 말투·금지어·시험 모드를 정하고 주간 규칙에서 고를 수 있습니다.</p>}
        <ul className="mt-2 space-y-2">{data.brands.map((b) => (
          <li key={`${b.id}:${kitVer[b.id] ?? 0}`} className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_auto]"><span className="pt-2 text-sm font-medium">{b.name}</span>
            <input className={inputCls} defaultValue={b.tone ?? ''} placeholder="말투(예: 친근·전문적)" onBlur={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { tone: e.target.value || null } }).then(reload)} aria-label={`${b.name} 말투`} />
            <input className={inputCls} defaultValue={b.banned_words.join(', ')} placeholder="금지어(쉼표)" onBlur={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { bannedWords: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } }).then(reload)} aria-label={`${b.name} 금지어`} />
            <label className="flex items-center gap-1.5 text-xs" title="알림은 실행한 사람에게만, 승인함에 [시험] 표시, 게시 확인 안 됨"><input type="checkbox" checked={b.test_mode} onChange={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { testMode: e.target.checked } }).then(reload)} data-testid="auto-brand-test" />시험 모드</label>
            <BrandKitAi brand={b} catalog={data.feedCatalog} onSaved={async () => { await reload(); setKitVer((m) => ({ ...m, [b.id]: (m[b.id] ?? 0) + 1 })); }} />
            <div className="grid gap-2 sm:col-span-4 sm:grid-cols-3 sm:pl-[8.5rem]">
              <textarea className={cx(inputCls, 'min-h-16')} defaultValue={b.intro ?? ''} placeholder="브랜드 소개(무엇을 하는 곳인지)" maxLength={1000} onBlur={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { intro: e.target.value } }).then(reload)} aria-label={`${b.name} 소개`} data-testid="auto-brand-intro" />
              <textarea className={cx(inputCls, 'min-h-16')} defaultValue={b.products ?? ''} placeholder="주력 상품·서비스" maxLength={1000} onBlur={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { products: e.target.value } }).then(reload)} aria-label={`${b.name} 주력 상품`} />
              <textarea className={cx(inputCls, 'min-h-16')} defaultValue={b.weekly_topic ?? ''} placeholder="이번 주 주제(선택)" maxLength={300} onBlur={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { weeklyTopic: e.target.value } }).then(reload)} aria-label={`${b.name} 이번 주 주제`} />
            </div>
            {/* 대표 02:30 ③ 광고 예산 브랜드 축: 우선순위(1 = 최우선)·비중(%)·메모(바디랩 지역 한정 등). 비워 두면 이름 기본값(하이링크 40·워크인 35·바디랩 15·다짐 10, 그 외 균등) */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs sm:col-span-4 sm:pl-[8.5rem]" data-testid={`brand-ad-${b.name}`}><span className="text-ink-3">광고 예산</span>
              <input className={cx(inputCls, 'h-8 w-20 py-0 text-xs')} defaultValue={b.ad_priority ?? ''} placeholder="우선순위" inputMode="numeric" onBlur={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { adPriority: e.target.value ? Number(e.target.value) : null } }).then(reload)} aria-label={`${b.name} 광고 우선순위`} data-testid="brand-ad-priority" />
              <input className={cx(inputCls, 'h-8 w-20 py-0 text-xs')} defaultValue={b.ad_share ?? ''} placeholder="비중 %" inputMode="decimal" onBlur={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { adShare: e.target.value ? Number(e.target.value) : null } }).then(reload)} aria-label={`${b.name} 광고 비중`} data-testid="brand-ad-share" />
              <input className={cx(inputCls, 'h-8 min-w-48 flex-1 py-0 text-xs')} defaultValue={b.ad_note ?? ''} placeholder="메모(예: 지역 한정 천안 두정·성정)" maxLength={300} onBlur={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { adNote: e.target.value } }).then(reload)} aria-label={`${b.name} 광고 메모`} data-testid="brand-ad-note" /></div>
            {data.feedCatalog && <BrandFeedKit brand={b} catalog={data.feedCatalog} onSaved={reload} />}
            <BrandVideoKit brand={b} onSaved={reload} />
            <BrandFacts brand={b} onSaved={reload} />
            <BrandExamples brand={b} onSaved={reload} />
            <BrandVoice brand={b} onSaved={reload} />
            <BrandMerge brand={b} brands={data.brands} onDone={reload} /></li>))}</ul>
        <p className="mt-2 text-xs text-ink-3">원고 재료: 브랜드 소개·주력 상품·이번 주 주제(없으면 이번 달 소식 → 주제 풀) + 사실 카드 + 같은 형식 잘 된 예시 글 + 회사 AI 프로필 + 마케팅 자료실 사진의 AI 설명(아래 &lsquo;사진 AI 설명&rsquo;). 재료가 없으면 시안 대신 “주제 필요” 카드로 묻습니다. 말투 프로필은 모든 원고·자막이 읽고, 다 쓴 원고는 글 품질 엔진(훅 점수·사람다움 점수·채널 검사)을 거칩니다.</p>
      </section>}

      {ed && <MktPhotos />}

      <section id="requests" className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="auto-requests">
        <h2 className="text-sm font-semibold">제작 요청 카드</h2>
        <ul className="mt-2 space-y-2">{data.requests.map((q) => (
          <li key={q.id} className={cx('rounded-input border p-3 text-sm', q.status === 'needs_approval' ? 'border-amber-300 bg-amber-50' : 'border-line')} data-testid="auto-request">
            <div className="flex flex-wrap items-center gap-2"><b>{REQ[q.kind]}</b><span className="text-xs text-ink-2">{q.title} · {q.scheduled_at ? fmtDateTime(q.scheduled_at) : ''}{q.kind !== 'topic' && ` · 예상 ${q.est_credits}크레딧`}</span>
              {q.status === 'needs_approval' && <span className="text-xs font-semibold text-amber-800">{q.reason}</span>}</div>
            {q.brief_id && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-800" data-testid="auto-req-brief">제작의뢰실</span>}
            {q.brief && <p className="mt-1 whitespace-pre-wrap text-xs text-ink-2">{q.brief}</p>}
            <div className="mt-2 flex flex-wrap items-end gap-2">
              {q.kind === 'topic' ? (<>
                <input className={cx(inputCls, 'h-8 min-w-0 flex-1 py-1 text-xs')} value={topics[q.id] ?? ''} onChange={(e) => setTopics({ ...topics, [q.id]: e.target.value })} placeholder="이번 글 주제(예: 10월 신규 회원 이벤트)" maxLength={300} aria-label="주제" data-testid="auto-topic" />
                <Button size="sm" onClick={() => act(q.id, 'done')} disabled={(topics[q.id] ?? '').trim().length < 2} data-testid="auto-topic-send">주제 보내기</Button></>)
              : q.status === 'needs_approval' ? (ed && <Button size="sm" onClick={() => act(q.id, 'approve')} data-testid="auto-req-approve">제작 승인</Button>) : (<>
                <MediaPick value={done[q.id]?.media ?? []} onChange={(m) => setDone({ ...done, [q.id]: { credits: done[q.id]?.credits ?? '', media: m } })} />
                <input className={cx(inputCls, 'h-8 w-28 py-1 text-xs')} type="number" placeholder={`사용 ${q.est_credits}`} value={done[q.id]?.credits ?? ''} onChange={(e) => setDone({ ...done, [q.id]: { media: done[q.id]?.media ?? [], credits: e.target.value } })} aria-label="실제 사용 크레딧" />
                <Button size="sm" onClick={() => act(q.id, 'done')} data-testid="auto-req-done">제작 완료</Button></>)}
              <Button size="sm" variant="secondary" onClick={() => act(q.id, 'cancel')}>{q.kind === 'topic' ? '이번 칸 건너뛰기' : '취소'}</Button>
            </div>
          </li>))}{!data.requests.length && <li className="text-xs text-ink-3">열린 제작 요청이 없습니다</li>}</ul>
      </section>

      <section className="rounded-card border border-line bg-white p-4 shadow-card">
        <h2 className="text-sm font-semibold">크레딧 원장(최근 30건)</h2>
        <ul className="mt-2 divide-y divide-line text-xs">{data.ledger.map((l, k) => (
          <li key={k} className="flex gap-2 py-1"><span className="w-28 shrink-0 text-ink-3">{fmtDateTime(l.created_at)}</span><span className="flex-1 truncate">{l.title ?? '—'}{l.version ? ` v${l.version}` : ''} · {l.note}</span><span className="tabular-nums font-medium">{l.credits}</span></li>))}
          {!data.ledger.length && <li className="py-1 text-ink-3">기록 없음</li>}</ul>
      </section>
      </>}
    </div>
  );
}

/** 로컬 10/20 보완 ②: 이미 만든 묶음(브랜드별)의 종류별 게시 시각·요일/주기·주말 건너뛰기를 한 번에 */
function bundleGroups(rules: any[]) {
  const m = new Map<string, { key: string; brand: string; rules: any[] }>();
  for (const r of rules) if (r.bundle_key) { const g = m.get(r.bundle_key) ?? { key: r.bundle_key, brand: r.brand ?? '브랜드 없음', rules: [] as any[] }; g.rules.push(r); m.set(r.bundle_key, g); }
  return [...m.values()];
}
function BundleTimes({ bundleKey, brand, rules, onDone }: { bundleKey: string; brand: string; rules: any[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const first = rules[0];
  const [times, setTimes] = useState<Record<string, string>>(Object.fromEntries(BUNDLE_KINDS.map((k) => [k, (rules.find((r) => r.kind === k)?.post_time ?? BUNDLE_TIMES[k]).slice(0, 5)])));
  const [mode, setMode] = useState<'interval' | 'weekdays'>(first.interval_days ? 'interval' : 'weekdays');
  const [weekdays, setWeekdays] = useState<number[]>(first.interval_days ? [1, 3, 5] : (first.weekdays as number[]));
  const [intervalDays, setIntervalDays] = useState<number>(first.interval_days ?? 3);
  const [skipWeekend, setSkipWeekend] = useState<boolean>(!!first.skip_weekend);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const body = mode === 'weekdays' ? { bundleKey, times, weekdays } : { bundleKey, times, intervalDays, skipWeekend, weekdays: [] };
      const r = await api<{ planned: number }>('/api/marketing/auto/bundle', { method: 'PATCH', body }); toast.ok(`${brand} 묶음을 바꿨습니다 — 앞으로 2주 칸 ${r.planned}개`); setOpen(false); onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="mt-2 rounded-input border border-line p-2 text-xs" data-testid="bundle-group" data-brand={brand}>
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="bundle-group-toggle">
        <span className="rounded-full bg-violet-50 px-1.5 text-[10px] text-violet-700">묶음</span><b>{brand}</b>
        <span className="text-ink-2">{first.interval_days ? `${first.interval_days}일마다${first.skip_weekend ? '·주말 건너뜀' : ''}` : (first.weekdays as number[]).map((d) => DOW[d]).join('·')} · {BUNDLE_KINDS.map((k) => `${KIND[k]} ${(rules.find((r) => r.kind === k)?.post_time ?? '').slice(0, 5)}`).join(' · ')}</span>
        <span className="ml-auto text-violet-700">{open ? '닫기' : '시각·요일 한 번에 바꾸기'}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="bundle-edit">
          <select className={cx(inputCls, 'h-7 !w-auto')} value={mode} onChange={(e) => setMode(e.target.value as 'interval' | 'weekdays')} aria-label="묶음 방식"><option value="interval">n일마다</option><option value="weekdays">요일 지정</option></select>
          {mode === 'interval' ? <>
            <select className={cx(inputCls, 'h-7 !w-auto')} value={intervalDays} onChange={(e) => setIntervalDays(Number(e.target.value))} aria-label="주기"><option value={2}>2일마다</option><option value={3}>3일마다</option></select>
            <label className="flex items-center gap-1"><input type="checkbox" checked={skipWeekend} onChange={(e) => setSkipWeekend(e.target.checked)} data-testid="bundle-skip-weekend" />주말 건너뛰기</label>
          </> : <span className="flex flex-wrap items-center gap-1">{DOW.map((d, k) => <button key={d} type="button" onClick={() => setWeekdays(weekdays.includes(k) ? weekdays.filter((x) => x !== k) : [...weekdays, k].sort())}
            className={cx('size-6 rounded-full border text-[11px]', weekdays.includes(k) ? 'border-violet-600 bg-violet-600 text-white' : 'border-line bg-white')} aria-pressed={weekdays.includes(k)} data-testid={`bundle-dow-${k}`}>{d}</button>)}</span>}
          {BUNDLE_KINDS.map((k) => <label key={k} className="flex items-center gap-0.5">{KIND[k]}<input type="time" className={cx(inputCls, 'h-7 !w-auto px-1')} value={times[k]} onChange={(e) => setTimes({ ...times, [k]: e.target.value })} aria-label={`${KIND[k]} 시각`} data-testid={`bundle-time-${k}`} /></label>)}
          <Button size="sm" onClick={save} disabled={busy} data-testid="bundle-save">저장(제작 전 칸도 옮김)</Button>
        </div>
      )}
    </div>
  );
}
