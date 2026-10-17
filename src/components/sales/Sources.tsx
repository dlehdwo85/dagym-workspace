'use client';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Skeleton, cx, inputCls, toast } from '@/components/ui';

type S = { code: string; name: string; provider: string; grp: string; category: string; refresh: string; enabled: boolean; common: boolean; keywords: string[]; regions: string[]; excludes: string[]; total: number; attribution: string; last_run_at: string | null };
type Sug = { rules: string[]; sources: string[]; keywords: string[]; regions: string[]; via: string; askKeywords: boolean };
const SIDO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const csv = (s: string) => s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);

/** V41 단계 3 데이터 설정: AI 자동 세팅(업태·종목·지역 → 원천·검색어 추천 → [이대로 켜기]) + 원천별 켜기·검색어·지역·제외어 */
export function Sources() {
  const { data, error, reload } = useApi<{ sources: S[]; settings: { industry: string | null; region: string | null } | null; canEdit: boolean }>('/api/sales/sources');
  const [ind, setInd] = useState(''); const [reg, setReg] = useState('');
  const [sug, setSug] = useState<Sug | null>(null); const [busy, setBusy] = useState(false); const [kw, setKw] = useState('');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={6} />;
  const groups = [...new Set(data.sources.map((s) => s.grp))];
  async function suggest() {
    setBusy(true);
    try { const r = await api<Sug>('/api/sales/sources/suggest', { body: { industry: ind || data!.settings?.industry || '', region: reg || data!.settings?.region || undefined } }); setSug(r); setKw(r.keywords.join(', ')); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function apply() {
    try { await api('/api/sales/sources/apply', { body: { sources: sug!.sources, keywords: csv(kw), regions: sug!.regions } }); toast.ok('추천대로 켰습니다 — 내일 아침부터 영업기회가 들어옵니다'); setSug(null); reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function save(s: S, patch: Partial<{ enabled: boolean; keywords: string[]; regions: string[]; excludes: string[] }>) {
    try { await api(`/api/sales/sources/${s.code}`, { method: 'PUT', body: { enabled: s.enabled, ...patch } }); reload(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="space-y-4" data-testid="sales-sources">
      <h1 className="text-xl font-bold text-[#2563EB]">데이터 설정</h1>
      {data.canEdit && (
        <section className="rounded-card border border-[#BFDBFE] bg-[#EFF6FF] p-4" data-testid="sales-ai-setup">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[#1D4ED8]"><Sparkles className="size-4" />AI 자동 세팅</h2>
          <p className="mt-1 text-xs text-ink-2">사업자등록증의 업태·종목(또는 하는 일)과 영업 지역을 넣으면 맞는 공공데이터와 검색어를 골라 드립니다. 켜기 전에 고칠 수 있습니다.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
            <input className={inputCls} value={ind} onChange={(e) => setInd(e.target.value)} placeholder={data.settings?.industry ?? '예: 서비스업 / 건물청소·시설관리'} aria-label="업태·종목" data-testid="sales-industry" />
            <select className={inputCls} value={reg} onChange={(e) => setReg(e.target.value)} aria-label="영업 지역"><option value="">{data.settings?.region ?? '전국'}</option>{SIDO.map((s) => <option key={s}>{s}</option>)}</select>
            <Button onClick={suggest} disabled={busy} data-testid="sales-suggest">{busy ? '고르는 중…' : '추천받기'}</Button>
          </div>
          {sug && (
            <div className="mt-3 space-y-2 rounded-input bg-white p-3 text-sm" data-testid="sales-suggestion">
              {sug.askKeywords ? <p className="text-xs text-amber-800">맞는 업종 규칙이 없어 공통 원천만 켭니다. 파는 것을 검색어 3개로 적어 주세요.</p> : <p className="text-xs text-ink-2">맞는 업종: {sug.rules.join(' · ')}</p>}
              <p className="text-xs">켤 원천 {sug.sources.length}개: {sug.sources.map((c) => data.sources.find((s) => s.code === c)?.name ?? c).join(', ')}</p>
              <Field label="검색어(쉼표로)"><input className={inputCls} value={kw} onChange={(e) => setKw(e.target.value)} data-testid="sales-keywords" /></Field>
              <p className="text-xs text-ink-2">지역: {sug.regions.join(', ') || '전국'}</p>
              <Button onClick={apply} data-testid="sales-apply">이대로 켜기</Button>
            </div>
          )}
        </section>
      )}
      {groups.map((g) => (
        <section key={g} className="rounded-card border border-line bg-white p-3 shadow-card">
          <h2 className="mb-2 text-sm font-semibold">{g}</h2>
          <ul className="divide-y divide-line">{data.sources.filter((s) => s.grp === g).map((s) => (
            <li key={s.code} className="py-2 text-sm" data-testid={`source-${s.code}`}>
              <div className="flex items-center gap-2">
                <input type="checkbox" className="size-4" checked={s.enabled} disabled={!data.canEdit} onChange={(e) => save(s, { enabled: e.target.checked })} aria-label={`${s.name} 켜기`} />
                <span className="min-w-0 flex-1"><span className="font-medium">{s.name}</span>{s.common && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-ink-2">공통</span>}<span className="block text-[11px] text-ink-3">{s.provider} · {s.refresh} 갱신 · 모은 것 {s.total.toLocaleString('ko-KR')}건</span></span>
              </div>
              {s.enabled && data.canEdit && (
                <div className="mt-1.5 grid gap-1.5 pl-6 sm:grid-cols-3">
                  <input className={cx(inputCls, 'h-8 py-1 text-xs')} defaultValue={s.keywords.join(', ')} placeholder="검색어(쉼표)" onBlur={(e) => save(s, { keywords: csv(e.target.value) })} aria-label={`${s.name} 검색어`} />
                  <input className={cx(inputCls, 'h-8 py-1 text-xs')} defaultValue={s.regions.join(', ')} placeholder="지역(예: 서울, 경기)" onBlur={(e) => save(s, { regions: csv(e.target.value) })} aria-label={`${s.name} 지역`} />
                  <input className={cx(inputCls, 'h-8 py-1 text-xs')} defaultValue={s.excludes.join(', ')} placeholder="제외어(쉼표)" onBlur={(e) => save(s, { excludes: csv(e.target.value) })} aria-label={`${s.name} 제외어`} />
                </div>
              )}
            </li>))}</ul>
        </section>
      ))}
      <p className="text-[11px] text-ink-3">공공데이터는 워크인이 하루 한 번 모아 모든 회사가 같이 씁니다(출처: 각 기관, 공공데이터포털). 회사마다 다른 것은 켠 원천·검색어·지역과 진행 상태·메모뿐입니다. 광고성 문자·메일 일괄 발송 기능은 없습니다.</p>
    </div>
  );
}
