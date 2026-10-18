'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton } from '@/components/ui';
import { CHANNELS } from './Marketing';

const C = '#7C3AED';
const PROVIDER: Record<string, string> = { naver: '네이버', google: 'Google', meta: 'Meta' };
const LEDGER: Record<string, string> = { text: '원고', generate_image: '이미지', generate_video: '영상', regen_image: '이미지 재생성', regen_video: '영상 재생성', adjust: '조정' };
const usd = (v: number) => (v > 0 && v < 1 ? String(Math.round(v * 10000) / 10000) : (Math.round(v * 100) / 100).toFixed(2));
const n = (v: number) => Math.round(v).toLocaleString('ko-KR');
const shift = (m: string, d: number) => { const [y, mo] = m.split('-').map(Number); const t = new Date(Date.UTC(y, mo - 1 + d, 1)); return t.toISOString().slice(0, 7); };

/** 상용화 ⑧ 월간 마케팅 보고 — [PDF 저장] = 브라우저 인쇄(PDF 로 저장) */
export function MonthlyReport() {
  const sp = useSearchParams();
  const [month, setMonth] = useState<string | null>(sp.get('month'));
  const { data, error, reload } = useApi<any>(`/api/marketing/report${month ? `?month=${month}` : ''}`, [month]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={6} />;
  const r = data;
  const card = (label: string, value: string, sub?: string) => (
    <div className="rounded-card border border-line bg-white p-3 shadow-card print:shadow-none" data-testid="report-card"><div className="text-xs text-ink-2">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums" style={{ color: C }}>{value}</div>{sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}</div>);
  return (
    <div className="space-y-4" data-testid="mkt-report">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold" style={{ color: C }}>{r.company} {r.month} 마케팅 월간 보고</h1>
        <span className="ml-auto flex items-center gap-1 print:hidden">
          <Button size="sm" variant="secondary" onClick={() => setMonth(shift(r.month, -1))} aria-label="이전 달">‹</Button>
          <Button size="sm" variant="secondary" onClick={() => setMonth(shift(r.month, 1))} disabled={r.month >= r.thisMonth} aria-label="다음 달">›</Button>
          <Button size="sm" onClick={() => window.print()} data-testid="report-print">PDF 저장(인쇄)</Button>
        </span>
      </div>
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {card('게시', `${r.posts.published}건`, `예정 ${r.posts.scheduled} · 취소 ${r.posts.canceled}`)}
        {card('승인', `${r.approvals.approved}건`, `수정 요청 ${r.approvals.changes} · 보류 ${r.approvals.held}${r.approvals.avg_hours != null ? ` · 평균 ${r.approvals.avg_hours}시간` : ''}`)}
        {card('자동 제작', `${r.auto.produced}건`, `품질 검사 미통과 ${r.auto.quality_failed}`)}
        {card('광고 비용', `${n(r.ads.total.cost_krw)}원`, `클릭 ${n(r.ads.total.clicks)} · CTR ${r.ads.total.ctr}% · CPC ${n(r.ads.total.cpc)}원`)}
        {card('전화 문의', `${r.calls.total}건`, `영업 리드 ${r.calls.leads}`)}
        {card('크레딧·AI', `${r.credits.total}`, `마케팅 AI 약 ${n(r.ai.krw)}원 · ${r.ai.requests}회`)}
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-card border border-line bg-white p-4 shadow-card print:shadow-none"><h2 className="text-sm font-semibold">채널별 게시</h2>
          <ul className="mt-2 space-y-1 text-sm">{r.posts.byChannel.map((c: any) => <li key={c.channel} className="flex justify-between"><span>{CHANNELS[c.channel as keyof typeof CHANNELS] ?? c.channel}</span><b className="tabular-nums">{c.n}</b></li>)}
            {!r.posts.byChannel.length && <li className="text-xs text-ink-3">게시 확인된 글이 없습니다</li>}</ul></section>
        <section className="rounded-card border border-line bg-white p-4 shadow-card print:shadow-none"><h2 className="text-sm font-semibold">광고 성과(매체별)</h2>
          <table className="mt-2 w-full text-xs"><thead className="text-ink-2"><tr><th className="text-left">매체</th><th className="text-right">노출</th><th className="text-right">클릭</th><th className="text-right">비용</th><th className="text-right">전환</th></tr></thead>
            <tbody>{r.ads.byProvider.map((a: any) => <tr key={a.provider}><td>{PROVIDER[a.provider] ?? a.provider}</td><td className="text-right tabular-nums">{n(a.impressions)}</td><td className="text-right tabular-nums">{n(a.clicks)}</td><td className="text-right tabular-nums">{n(a.cost_krw)}원</td><td className="text-right tabular-nums">{a.conversions}</td></tr>)}</tbody></table>
          {!r.ads.byProvider.length && <p className="mt-2 text-xs text-ink-3">연결된 광고 계정의 기록이 없습니다</p>}</section>
        <section className="rounded-card border border-line bg-white p-4 shadow-card print:shadow-none"><h2 className="text-sm font-semibold">크레딧 원장(종류별)</h2>
          <ul className="mt-2 space-y-1 text-sm">{r.credits.byKind.map((k: any) => <li key={k.kind} className="flex justify-between"><span>{LEDGER[k.kind] ?? k.kind} <span className="text-xs text-ink-3">{k.n}건</span></span><b className="tabular-nums">{k.credits}</b></li>)}
            {!r.credits.byKind.length && <li className="text-xs text-ink-3">기록 없음</li>}</ul>
          <p className="mt-2 text-xs text-ink-3">마케팅 AI ${usd(r.ai.usd)} (원 환산 약 {n(r.ai.krw)}원)</p></section>
      </div>
      <p className="text-xs text-ink-3">시험 모드 브랜드 콘텐츠는 빠집니다. 승인 소요 = 그 버전이 올라온 때부터 승인까지. 매월 1일 오전 지난달 보고를 받는 사람에게 알림(메일 설정 시 메일도)으로 보냅니다.</p>
    </div>
  );
}
