'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { CHANNELS } from './Marketing';
import { MediaPick } from './MediaPick';

const C = '#7C3AED';
const KIND: Record<string, string> = { feed: '피드', blog: '블로그', reels: '릴스·쇼츠', video: '생성 영상' };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const REQ: Record<string, string> = { image: '이미지', video: '영상', regen_image: '이미지 재생성', regen_video: '영상 재생성', topic: '주제 필요' };
type View = { settings: any; limits: { monthlyCredits: number | null; weeklyCredits: number | null; videoMonthly: number | null; regenMonthly: number | null };
  usage: { weekCredits: number; monthCredits: number; monthVideos: number; monthRegens: number }; plans: Record<string, { label: string; weekly: Record<string, number>; monthlyCredits: number; videoMonthly: number; regenMonthly: number; price: number | null }>;
  rules: any[]; requests: any[]; ledger: any[]; brands: { id: string; name: string; tone: string | null; intro: string | null; products: string | null; weekly_topic: string | null; banned_words: string[]; test_mode: boolean }[]; people: { id: string; name: string; role: string }[]; canEdit: boolean };
const lim = (used: number, max: number | null) => (max === null ? `${used} (한도 없음)` : `${used} / ${max}`);

/** V41 4-3 + V43: 자동 제작 — 요금제·한도·사용량, 일정·마감·알림, 브랜드 키트, 주간 규칙, 제작 요청 카드, 크레딧 원장 */
export function Automation() {
  const { data, error, reload } = useApi<View>('/api/marketing/auto');
  const [rule, setRule] = useState({ brandId: '', channel: 'instagram', kind: 'feed', weekdays: [2, 4] as number[], postTime: '10:00', topicHint: '' });
  const [done, setDone] = useState<Record<string, { credits: string; media: { id: string; title: string }[] }>>({});
  const [topics, setTopics] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [nb, setNb] = useState({ name: '', test: false });
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
  async function addRule(e: React.FormEvent) { e.preventDefault(); try { const r = await api<{ planned: number }>('/api/marketing/auto/rules', { body: { ...rule, brandId: rule.brandId || null, topicHint: rule.topicHint || undefined } }); toast.ok(`규칙 추가 — 앞으로 2주 ${r.planned}칸`); reload(); } catch (er: any) { toast.error(er.message); } }
  async function act(id: string, action: string) {
    const d = done[id];
    try { await api(`/api/marketing/auto/requests/${id}`, { method: 'PATCH', body: { action, ...(topics[id] ? { topic: topics[id] } : {}), ...(action === 'done' && d ? { credits: d.credits === '' ? undefined : Number(d.credits), mediaIds: d.media.map((m) => m.id) } : {}) } }); reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function runNow() { setBusy(true); try { const r = await api<any>('/api/marketing/auto/run', { body: {} }); const bad = r.produced.filter((p: any) => p.error); const ask = r.produced.filter((p: any) => p.needsTopic).length;
    toast.ok(`칸 ${r.planned} · 제작 ${r.produced.length - bad.length - ask}${ask ? ` · 주제 필요 ${ask}` : ''} · 알림 ${r.reminded} · 정리 ${r.expired}`); if (bad.length) toast.error(`제작 실패 ${bad.length}건: ${bad[0].error}`); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }
  const num = (v: string) => (v === '' ? null : Number(v));
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="mkt-automation">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold" style={{ color: C }}>자동 제작</h1>
        {ed && <Button size="sm" variant="secondary" className="ml-auto" onClick={runNow} disabled={busy} data-testid="auto-run">{busy ? '도는 중…' : '지금 한 번 돌리기'}</Button>}</div>
      <p className="text-xs text-ink-2">주간 규칙대로 게시 {s.lead_days}일 전 {s.lead_hour}:00 에 AI 비서가 원고를 쓰고 품질 검사를 통과하면 승인 대기에 올립니다. 이미지·영상은 제작 요청 카드로(실사 사진 + 글자 렌더 우선, 생성 엔진은 계약 후 연결). 승인 마감 = 게시 당일 {s.approval_hour}:00, 알림 = 제작 완료 즉시 + 마감 {s.remind_hours}시간 전({s.quiet_start}~{s.quiet_end}시는 무알림 → 직전 저녁).</p>

      <section className="grid gap-3 sm:grid-cols-4">{([['이번 주 크레딧', lim(data.usage.weekCredits, data.limits.weeklyCredits)], ['이번 달 크레딧', lim(data.usage.monthCredits, data.limits.monthlyCredits)],
        ['이번 달 생성 영상', lim(data.usage.monthVideos, data.limits.videoMonthly)], ['이번 달 재생성', lim(data.usage.monthRegens, data.limits.regenMonthly)]] as [string, string][]).map(([l, v]) => (
        <div key={l} className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="auto-usage"><div className="text-xs text-ink-2">{l}</div><div className="mt-1 text-lg font-bold tabular-nums" style={{ color: C }}>{v}</div></div>))}</section>

      <section className="rounded-card border border-line bg-white p-4 shadow-card">
        <h2 className="text-sm font-semibold">요금제·한도</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">{Object.entries(data.plans).map(([k, p]) => (
          <button key={k} type="button" disabled={!ed} onClick={() => save({ planCode: s.plan_code === k ? null : k })} data-testid={`auto-plan-${k}`}
            className={cx('rounded-input border p-3 text-left text-xs', s.plan_code === k ? 'border-violet-500 bg-violet-50' : 'border-line hover:bg-slate-50')}>
            <div className="text-sm font-semibold">{p.label} <span className="font-normal text-ink-3">· 가격 {p.price ?? '결정 전'}</span></div>
            <div className="mt-1 text-ink-2">주간 {Object.entries(p.weekly).map(([kk, n]) => `${KIND[kk]} ${n}`).join(' · ')}</div>
            <div className="text-ink-2">월 크레딧 {p.monthlyCredits} · 생성 영상 {p.videoMonthly}편 · 재생성 {p.regenMonthly}회</div>
          </button>))}</div>
        {ed && <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <Field label="월 크레딧(비우면 요금제)"><input className={inputCls} type="number" defaultValue={s.monthly_credits ?? ''} onBlur={(e) => save({ monthlyCredits: num(e.target.value) })} /></Field>
          <Field label="주 크레딧(비우면 월÷4.3)"><input className={inputCls} type="number" defaultValue={s.weekly_credits ?? ''} onBlur={(e) => save({ weeklyCredits: num(e.target.value) })} /></Field>
          <Field label="월 생성 영상"><input className={inputCls} type="number" defaultValue={s.video_monthly ?? ''} onBlur={(e) => save({ videoMonthly: num(e.target.value) })} /></Field>
          <Field label="월 재생성"><input className={inputCls} type="number" defaultValue={s.regen_monthly ?? ''} onBlur={(e) => save({ regenMonthly: num(e.target.value) })} /></Field>
        </div>}
      </section>

      {ed && <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="auto-recipients">
        <h2 className="text-sm font-semibold">알림·승인 받는 사람</h2>
        <p className="mt-1 text-xs text-ink-2">고르지 않으면 관리자 전원. 시험 모드 브랜드는 여기와 상관없이 실행한 사람에게만 갑니다.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{data.people.map((p) => { const on = (s.notify_user_ids ?? []).includes(p.id); return (
          <button key={p.id} type="button" aria-pressed={on} data-testid="auto-recipient" onClick={() => save({ notifyUserIds: on ? (s.notify_user_ids ?? []).filter((x: string) => x !== p.id) : [...(s.notify_user_ids ?? []), p.id] })}
            className={cx('rounded-full border px-3 py-1 text-xs', on ? 'border-violet-500 bg-violet-50 font-semibold text-violet-800' : 'border-line')}>{p.name}</button>); })}
          {!!s.notify_user_ids?.length && <button type="button" className="text-xs underline" onClick={() => save({ notifyUserIds: null })}>관리자 전원으로</button>}</div>
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
          <Field label="AI 표기 문구"><input className={inputCls} defaultValue={s.ai_label} onBlur={(e) => e.target.value.trim() && save({ aiLabel: e.target.value.trim() })} /></Field>
          <div className="space-y-1 pt-5 text-xs">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={s.allow_generated_people} onChange={(e) => save({ allowGeneratedPeople: e.target.checked })} />생성 인물 허용</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={s.allow_slideshow} onChange={(e) => save({ allowSlideshow: e.target.checked })} />슬라이드쇼 허용</label>
          </div>
        </div>
      </section>}

      <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="auto-rules">
        <h2 className="text-sm font-semibold">주간 규칙</h2>
        <ul className="mt-2 divide-y divide-line text-sm">{data.rules.map((r) => (
          <li key={r.id} className={cx('flex flex-wrap items-center gap-2 py-2', !r.active && 'opacity-50')} data-testid="auto-rule">
            <span className="font-medium">{r.brand ?? '브랜드 없음'}</span><span className="text-xs text-ink-2">{CHANNELS[r.channel as keyof typeof CHANNELS]} · {KIND[r.kind]} · {(r.weekdays as number[]).map((d) => DOW[d]).join('·')} {r.post_time}{r.topic_hint ? ` · ${r.topic_hint}` : ''}</span>
            {ed && <span className="ml-auto flex gap-1.5"><Button size="sm" variant="secondary" onClick={async () => { await api(`/api/marketing/auto/rules/${r.id}`, { method: 'PATCH', body: { active: !r.active } }); reload(); }}>{r.active ? '멈춤' : '켜기'}</Button>
              <Button size="sm" variant="secondary" onClick={async () => { if (!confirm('규칙을 지울까요? 아직 제작 안 한 칸도 같이 지워집니다.')) return; await api(`/api/marketing/auto/rules/${r.id}`, { method: 'DELETE' }); reload(); }}>지우기</Button></span>}
          </li>))}{!data.rules.length && <li className="py-2 text-xs text-ink-3">규칙이 없습니다 — 예: 인스타그램 피드 화·목 10:00</li>}</ul>
        {ed && <form onSubmit={addRule} className="mt-3 grid gap-2 sm:grid-cols-6" data-testid="auto-rule-form">
          <select className={inputCls} value={rule.brandId} onChange={(e) => setRule({ ...rule, brandId: e.target.value })} aria-label="브랜드"><option value="">브랜드 없음</option>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select className={inputCls} value={rule.channel} onChange={(e) => setRule({ ...rule, channel: e.target.value })} aria-label="채널">{Object.entries(CHANNELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select className={inputCls} value={rule.kind} onChange={(e) => setRule({ ...rule, kind: e.target.value })} aria-label="종류" data-testid="auto-rule-kind">{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span className="flex flex-wrap items-center gap-1">{DOW.map((d, k) => <button key={d} type="button" onClick={() => setRule({ ...rule, weekdays: rule.weekdays.includes(k) ? rule.weekdays.filter((x) => x !== k) : [...rule.weekdays, k] })}
            className={cx('size-7 rounded-full border text-xs', rule.weekdays.includes(k) ? 'border-violet-500 bg-violet-500 text-white' : 'border-line')} aria-pressed={rule.weekdays.includes(k)} aria-label={`${d}요일`}>{d}</button>)}</span>
          <input type="time" className={inputCls} value={rule.postTime} onChange={(e) => setRule({ ...rule, postTime: e.target.value })} aria-label="게시 시각" />
          <Button type="submit" disabled={!rule.weekdays.length} data-testid="auto-rule-add">규칙 추가</Button>
          <input className={cx(inputCls, 'sm:col-span-6')} value={rule.topicHint} onChange={(e) => setRule({ ...rule, topicHint: e.target.value })} placeholder="주제 힌트(선택) — 예: 신규 회원 이벤트, 시설 소개" aria-label="주제 힌트" />
        </form>}
      </section>

      {ed && <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="auto-brands">
        <h2 className="text-sm font-semibold">브랜드 키트</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className={cx(inputCls, 'w-48')} value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBrand(); } }} placeholder="새 브랜드 이름" maxLength={40} aria-label="새 브랜드 이름" data-testid="auto-brand-name" />
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={nb.test} onChange={(e) => setNb({ ...nb, test: e.target.checked })} />시험 모드로</label>
          <Button type="button" size="sm" onClick={addBrand} disabled={!nb.name.trim() || busy} data-testid="auto-brand-add">브랜드 추가</Button>
        </div>
        {!data.brands.length && <p className="mt-2 text-xs text-ink-3">브랜드가 없습니다 — 추가하면 말투·금지어·시험 모드를 정하고 주간 규칙에서 고를 수 있습니다.</p>}
        <ul className="mt-2 space-y-2">{data.brands.map((b) => (
          <li key={b.id} className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_auto]"><span className="pt-2 text-sm font-medium">{b.name}</span>
            <input className={inputCls} defaultValue={b.tone ?? ''} placeholder="말투(예: 친근·전문적)" onBlur={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { tone: e.target.value || null } }).then(reload)} aria-label={`${b.name} 말투`} />
            <input className={inputCls} defaultValue={b.banned_words.join(', ')} placeholder="금지어(쉼표)" onBlur={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { bannedWords: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } }).then(reload)} aria-label={`${b.name} 금지어`} />
            <label className="flex items-center gap-1.5 text-xs" title="알림은 실행한 사람에게만, 승인함에 [시험] 표시, 게시 확인 안 됨"><input type="checkbox" checked={b.test_mode} onChange={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { testMode: e.target.checked } }).then(reload)} data-testid="auto-brand-test" />시험 모드</label>
            <div className="grid gap-2 sm:col-span-4 sm:grid-cols-3 sm:pl-[8.5rem]">
              <textarea className={cx(inputCls, 'min-h-16')} defaultValue={b.intro ?? ''} placeholder="브랜드 소개(무엇을 하는 곳인지)" maxLength={1000} onBlur={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { intro: e.target.value } }).then(reload)} aria-label={`${b.name} 소개`} data-testid="auto-brand-intro" />
              <textarea className={cx(inputCls, 'min-h-16')} defaultValue={b.products ?? ''} placeholder="주력 상품·서비스" maxLength={1000} onBlur={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { products: e.target.value } }).then(reload)} aria-label={`${b.name} 주력 상품`} />
              <textarea className={cx(inputCls, 'min-h-16')} defaultValue={b.weekly_topic ?? ''} placeholder="이번 주 주제(선택)" maxLength={300} onBlur={(e) => api(`/api/marketing/auto/brands/${b.id}`, { method: 'PATCH', body: { weeklyTopic: e.target.value } }).then(reload)} aria-label={`${b.name} 이번 주 주제`} />
            </div></li>))}</ul>
        <p className="mt-2 text-xs text-ink-3">원고 재료: 브랜드 소개·주력 상품·이번 주 주제 + 회사 AI 프로필 + 마케팅 자료실 사진 설명. 재료가 없으면 시안 대신 “주제 필요” 카드로 묻습니다.</p>
      </section>}

      <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="auto-requests">
        <h2 className="text-sm font-semibold">제작 요청 카드</h2>
        <ul className="mt-2 space-y-2">{data.requests.map((q) => (
          <li key={q.id} className={cx('rounded-input border p-3 text-sm', q.status === 'needs_approval' ? 'border-amber-300 bg-amber-50' : 'border-line')} data-testid="auto-request">
            <div className="flex flex-wrap items-center gap-2"><b>{REQ[q.kind]}</b><span className="text-xs text-ink-2">{q.title} · {q.scheduled_at ? fmtDateTime(q.scheduled_at) : ''}{q.kind !== 'topic' && ` · 예상 ${q.est_credits}크레딧`}</span>
              {q.status === 'needs_approval' && <span className="text-xs font-semibold text-amber-800">{q.reason}</span>}</div>
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
    </div>
  );
}
