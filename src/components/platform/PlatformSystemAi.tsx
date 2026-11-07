'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from '../client';
import { Button, Field, inputCls, toast } from '../ui';

type V = { label: string; capKrw: number; month: string; krw: number; calls: number; pct: number | null; byPurpose: { purpose: string; krw: number; calls: number }[] };
const NAMES: Record<string, string> = { sales_support_auto: '지원사업 자동 판단', sales_eligibility_items: '참가자격 항목 정리', sales_eligibility_vision: '사진 공고문 읽기' };
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
/** 382차 #1004(대표 11/07 "지원사업·공고 긁어오는 AI 는 AI 크레딧에 넣지 말고 매일 기본으로"): 자동 수집 AI 는 회사 한도 밖 시스템 몫 — 이번 달 사용·안전 상한 */
export function PlatformSystemAi() {
  const { data, reload } = useApi<V>('/api/platform/ai-system');
  const [cap, setCap] = useState('');
  useEffect(() => { if (data) setCap(String(data.capKrw)); }, [data]);
  if (!data) return null;
  async function save() {
    const n = Number(cap.replace(/[^\d]/g, ''));
    if (!Number.isFinite(n)) return toast.error('숫자로 적어 주세요');
    try { await api('/api/platform/ai-system', { method: 'PUT', body: { capKrw: n } }); toast.ok('상한을 바꿨습니다'); reload(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <section id="ai-system" className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="platform-ai-system">
      <h2 className="text-base font-bold">{data.label}</h2>
      <p className="mt-1 text-xs text-ink-2">지원사업 자동 판단·참가자격 항목 정리·사진 공고문 읽기는 회사 AI 한도에 넣지 않고 매일 돕니다. 안전 상한에 닿으면 그 달은 멈추고 알림을 보냅니다.</p>
      <p className="mt-2 text-sm" data-testid="ai-system-line">{data.month} 이번 달 {data.calls}번 · {won(data.krw)} / 상한 {data.capKrw ? won(data.capKrw) : '없음(멈춤)'}{data.pct !== null ? ` (${data.pct}%)` : ''}</p>
      {!!data.byPurpose.length && <ul className="mt-1 text-xs text-ink-2">{data.byPurpose.map((b) => <li key={b.purpose}>{NAMES[b.purpose] ?? b.purpose} — {b.calls}번 · {won(b.krw)}</li>)}</ul>}
      <div className="mt-2 flex items-end gap-2">
        <Field label="월 안전 상한(원)"><input className={inputCls} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} aria-label="자동 수집 AI 월 상한" data-testid="ai-system-cap" /></Field>
        <Button onClick={save} data-testid="ai-system-save">저장</Button>
      </div>
    </section>
  );
}
