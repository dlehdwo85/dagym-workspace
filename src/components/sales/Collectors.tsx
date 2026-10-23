'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { useSalesTerms } from '@/components/session';
import { PortalApplyLink, portalService } from './PortalApply';

type Run = { id: number; slug: string; trigger: string; started_at: string; finished_at: string | null; status: string; inserted: number; updated: number; unchanged: number; errors: number; summary: string | null; error_log: string | null };
type C = { slug: string; label: string; hourKst: number; againKst?: number | number[] | null; hours?: number[]; source: string; bid: boolean; support?: boolean; needs: { key: string; present: boolean }[]; globalEnabled: boolean; enabled: boolean; lastRunAt: string | null; lastStatus: string | null; last: Run | null };
type Data = { canEdit: boolean; platformAdmin: boolean; counts: Record<string, number>; collectors: C[]; runs: Run[] };
const ST: Record<string, [string, string]> = { success: ['성공', 'bg-emerald-50 text-emerald-800'], partial: ['일부', 'bg-amber-50 text-amber-800'], failed: ['실패', 'bg-red-50 text-red-800'], running: ['실행 중', 'bg-blue-50 text-blue-800'], skipped: ['건너뜀', 'bg-slate-100 text-ink-3'] };
const SIDO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const csv = (s: string) => s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);

/** 대표 10/21 08:45 ①: 자동 수집(수집기 12개) — 켜기/끄기·마지막 실행·오류·[지금 수집](관리자) */
export function Collectors() {
  const { data, error, reload } = useApi<Data>('/api/sales/collectors');
  const [busy, setBusy] = useState<string | null>(null); const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  async function toggle(c: C, scope: 'tenant' | 'global') { try { await api('/api/sales/collectors', { method: 'PUT', body: { slug: c.slug, enabled: scope === 'tenant' ? !c.enabled : !c.globalEnabled, scope } }); reload(); } catch (e: any) { toast.error(e.message); } }
  async function run(c: C) { setBusy(c.slug); try { const r = await api<any>(`/api/sales/collectors/${c.slug}/run`, { body: {} }); toast[r.status === 'failed' ? 'error' : 'ok'](`${c.label}: ${r.summary ?? r.status}`); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(null); } }
  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="sales-collectors">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">자동 수집(수집기 {data.collectors.length}개)</h2><span className="text-xs text-ink-2">공고 {total.toLocaleString('ko-KR')}건 보유 · 매일 KST 06~08시 순서대로 하루 한 번(지원사업은 08·14시 두 번)</span></div>
      <p className="mt-1 text-xs text-ink-2">영업관리에서 옮겨 온 수집기입니다. 끄면 이 회사의 당일 다이제스트·오늘 새 공고에서 그 출처가 빠집니다(수집 자체는 공용). 필요한 키가 없는 수집기는 “키 필요”로 표시됩니다.</p>
      <ul className="mt-2 divide-y divide-line text-sm">{data.collectors.map((c) => { const st = c.last ? ST[c.last.status] ?? [c.last.status, 'bg-slate-100'] : null; const missing = c.needs.filter((n) => !n.present && !/선택/.test(n.key)); return (
        <li key={c.slug} className="py-2" data-testid="sales-collector" data-slug={c.slug} data-enabled={c.enabled}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{c.label}</span>
            <span className={cx('rounded-full px-2 py-0.5 text-[11px]', c.bid ? 'bg-violet-50 text-violet-800' : c.support ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-ink-2')}>{c.bid ? '입찰·공고' : c.support ? '지원사업' : '영업 DB'}</span>
            {st && <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', st[1])} data-testid="sales-collector-status">{st[0]}</span>}
            {missing.length > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">키 필요: {missing.map((m) => m.key).join(', ')}</span>}
            {!c.globalEnabled && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-3">플랫폼에서 꺼짐</span>}
            <span className="text-xs text-ink-3">{(c.hours ?? [c.hourKst]).map((h) => `${String(h).padStart(2, '0')}:00`).join('·')} · {c.lastRunAt ? `마지막 ${fmtDateTime(c.lastRunAt)}` : '아직 안 돌음'}</span>
            <span className="ml-auto flex items-center gap-1.5">
              {data.canEdit && <Button size="sm" variant="secondary" onClick={() => run(c)} disabled={busy === c.slug || !c.globalEnabled} data-testid="sales-collector-run">{busy === c.slug ? '수집 중…' : '지금 수집'}</Button>}
              {data.canEdit && <label className={cx('inline-flex min-h-[32px] cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium', c.enabled ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-line bg-white text-ink-3')}><input type="checkbox" className="size-4 accent-brand-600" checked={c.enabled} onChange={() => toggle(c, 'tenant')} aria-label={`${c.label} 사용`} data-testid="sales-collector-toggle" />{c.enabled ? '사용 중' : '사용 안 함'}</label>}
              {data.platformAdmin && <button type="button" className="text-[11px] underline text-ink-3" onClick={() => toggle(c, 'global')}>{c.globalEnabled ? '플랫폼 끄기' : '플랫폼 켜기'}</button>}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ink-3">{c.source}</p>
          {c.last?.summary && <p className={cx('mt-0.5 text-xs', portalService(c.last.summary) ? 'text-amber-900' : 'text-ink-2')} data-testid="sales-collector-summary">{c.last.summary}<PortalApplyLink summary={c.last.summary} /></p>}
          {c.last?.error_log && <details className="mt-0.5 text-xs text-red-700"><summary className="cursor-pointer">오류 {c.last.errors}건</summary><pre className="whitespace-pre-wrap break-all">{c.last.error_log}</pre></details>}
        </li>); })}</ul>
      <details className="mt-2 text-xs" open={open === 'runs'} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open ? 'runs' : null)}><summary className="cursor-pointer text-ink-2">최근 실행 {data.runs.length}건</summary>
        <ul className="mt-1 space-y-0.5" data-testid="sales-collector-runs">{data.runs.map((r) => <li key={r.id} className="text-ink-2">{fmtDateTime(r.started_at)} · {r.slug} · {ST[r.status]?.[0] ?? r.status} · 신규 {r.inserted} 갱신 {r.updated} 변화없음 {r.unchanged}{r.errors ? ` 오류 ${r.errors}` : ''} · {r.trigger === 'manual' ? '수동' : '자동'}</li>)}</ul></details>
    </section>
  );
}

type Prefs = { keywords: string[]; excludes: string[]; regions: string[]; issuers: string[]; item_codes: string[]; amount_min: number | null; amount_max: number | null; digest_enabled: boolean; digest_hour: number; digest_mail: boolean; digest_to: string[] };
type PD = { prefs: Prefs; people: { id: string; name: string; email: string; role: string }[]; last: { day: string; counts: any; items: any[]; mailed: number; notified: number; created_at: string } | null; canEdit: boolean };
/** 대표 10/21 08:45 ②③: 맞춤 설정(21라인 관심검색어·제외어·지역·발주처·물품 코드·금액) + 당일 다이제스트(시각·메일·받는 사람·지금 보내기) */
export function BidPrefs() {
  const T = useSalesTerms(); // #408 업종 템플릿 예시 검색어
  const { data, error, reload } = useApi<PD>('/api/sales/digest/prefs');
  const [f, setF] = useState<Record<string, string> | null>(null); const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  const p = data.prefs;
  const form = f ?? { keywords: p.keywords.join(', '), excludes: p.excludes.join(', '), issuers: p.issuers.join(', '), item_codes: p.item_codes.join(', '), amount_min: p.amount_min == null ? '' : String(p.amount_min), amount_max: p.amount_max == null ? '' : String(p.amount_max), digest_hour: String(p.digest_hour) };
  const set = (k: string, v: string) => setF({ ...form, [k]: v });
  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true);
    try { await api('/api/sales/digest/prefs', { method: 'PUT', body: { keywords: csv(form.keywords), excludes: csv(form.excludes), issuers: csv(form.issuers), itemCodes: csv(form.item_codes), amountMin: form.amount_min ? Number(form.amount_min) : null, amountMax: form.amount_max ? Number(form.amount_max) : null, digestHour: Number(form.digest_hour), ...extra } }); toast.ok('저장했습니다'); setF(null); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function sendNow() { setBusy(true); try { const r = await api<any>('/api/sales/digest/send', { body: {} }); toast.ok(`오늘 다이제스트 ${r.counts?.total ?? 0}건 — 메일 ${r.mailed} · 알림 ${r.notified}`); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }
  const toggleRegion = (s: string) => save({ regions: p.regions.includes(s) ? p.regions.filter((x) => x !== s) : [...p.regions, s] });
  const togglePerson = (id: string) => save({ digestTo: p.digest_to.includes(id) ? p.digest_to.filter((x) => x !== id) : [...p.digest_to, id] });
  return (
    <section className="rounded-card border border-[#BFDBFE] bg-[#EFF6FF]/50 p-4" data-testid="sales-bid-prefs">
      <h2 className="text-sm font-semibold text-[#1D4ED8]">맞춤 공고 설정 · 당일 다이제스트</h2>
      <p className="mt-1 text-xs text-ink-2">21라인 맞춤메일처럼 — 매일 정한 시각에 그날 새로 들어온 공고 중 관심 사업·관심 검색어에 맞는 것을 메일·알림·앱 푸시와 영업 홈 “오늘 새 공고”로 보냅니다. 정정·취소 공고는 따로 표시.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Field label="관심 검색어(쉼표)"><input className={inputCls} value={form.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder={T.examples.keywords} disabled={!data.canEdit} data-testid="prefs-keywords" /></Field>
        <Field label="제외 검색어(쉼표)"><input className={inputCls} value={form.excludes} onChange={(e) => set('excludes', e.target.value)} placeholder={T.examples.excludes} disabled={!data.canEdit} data-testid="prefs-excludes" /></Field>
        <Field label="관심 발주처(쉼표, 비우면 전체)"><input className={inputCls} value={form.issuers} onChange={(e) => set('issuers', e.target.value)} placeholder="LH, 시설관리공단" disabled={!data.canEdit} /></Field>
        <Field label="물품·업종 코드(쉼표, 비우면 전체)"><input className={inputCls} value={form.item_codes} onChange={(e) => set('item_codes', e.target.value)} placeholder="예: 1156, 위탁용역" disabled={!data.canEdit} /></Field>
        <Field label="추정가격 최소(원)"><input className={inputCls} inputMode="numeric" value={form.amount_min} onChange={(e) => set('amount_min', e.target.value.replace(/\D/g, ''))} disabled={!data.canEdit} /></Field>
        <Field label="추정가격 최대(원)"><input className={inputCls} inputMode="numeric" value={form.amount_max} onChange={(e) => set('amount_max', e.target.value.replace(/\D/g, ''))} disabled={!data.canEdit} /></Field>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-xs" data-testid="prefs-regions">{SIDO.map((s) => <button key={s} type="button" disabled={!data.canEdit} onClick={() => toggleRegion(s)} className={cx('rounded-full border px-2 py-0.5', p.regions.includes(s) ? 'border-[#2563EB] bg-white font-semibold text-[#1D4ED8]' : 'border-line bg-white text-ink-2')}>{s}</button>)}<span className="self-center text-ink-3">{p.regions.length ? '' : '지역 제한 없음(전국)'}</span></div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">다이제스트</span>
        {data.canEdit && <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" className="size-4 accent-brand-600" checked={p.digest_enabled} onChange={() => save({ digestEnabled: !p.digest_enabled })} data-testid="prefs-digest-enabled" />매일 보내기</label>}
        <label className="inline-flex items-center gap-1 text-xs">시각 <select className={cx(inputCls, 'h-8 w-auto py-0 text-xs')} value={form.digest_hour} onChange={(e) => set('digest_hour', e.target.value)} disabled={!data.canEdit} data-testid="prefs-digest-hour">{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h.toString().padStart(2, '0')}:00</option>)}</select></label>
        {data.canEdit && <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" className="size-4 accent-brand-600" checked={p.digest_mail} onChange={() => save({ digestMail: !p.digest_mail })} />메일도 보내기</label>}
        <span className="ml-auto flex gap-1.5">{data.canEdit && <Button size="sm" onClick={() => save()} disabled={busy} data-testid="prefs-save">저장</Button>}{data.canEdit && <Button size="sm" variant="secondary" onClick={sendNow} disabled={busy} data-testid="prefs-send-now">지금 보내기</Button>}</span>
      </div>
      <div className="mt-2 text-xs"><span className="text-ink-2">받는 사람(비우면 대표·관리자): </span>{data.people.map((u) => <button key={u.id} type="button" disabled={!data.canEdit} onClick={() => togglePerson(u.id)} className={cx('mr-1 rounded-full border px-2 py-0.5', p.digest_to.includes(u.id) ? 'border-[#2563EB] bg-white font-semibold text-[#1D4ED8]' : 'border-line bg-white text-ink-2')}>{u.name}</button>)}</div>
      {data.last && <p className="mt-2 text-xs text-ink-2" data-testid="prefs-last-digest">마지막 다이제스트 {data.last.day}: 새 공고 {data.last.counts?.new ?? 0} · 정정 {data.last.counts?.amend ?? 0} · 취소 {data.last.counts?.cancel ?? 0} · 메일 {data.last.mailed}{data.last.counts?.mailVia ? <span className="text-ink-3"> ({({ 'email:smtp': '회사 메일 계정', 'email:workin': '워크인 발송', sent: 'Resend', dev: '개발 모드' } as Record<string, string>)[String(data.last.counts.mailVia)] ?? String(data.last.counts.mailVia)})</span> : null}{data.last.counts?.mailError && <span className="text-red-600" title={String(data.last.counts.mailError)}> (메일 실패: {String(data.last.counts.mailError).slice(0, 60)})</span>} · 알림 {data.last.notified}</p>}
    </section>
  );
}
