'use client';
import { useEffect, useState } from 'react';

/**
 * 상용화 B3(대표 위임 11/24, COMMERCIAL_AUDIT): 소개 화면 요금 — 업무 요금표만 공개, 영업·마케팅은 상담 후 견적.
 * 숫자는 고객 결제 화면과 같은 데이터(/api/public/ai-plans → 업무 w_work 구간)에서 읽는다. 못 받으면 아무것도 그리지 않음(아래 문의 줄은 그대로).
 * 앱(아이폰·안드로이드) 안에서는 소개 화면 자체가 로그인으로 넘어감(middleware APP_NO_PRICING) — 앱에 가격이 보이지 않는다.
 */
type Row = { label: string; upTo: number | null; krw: number; annualKrw: number; perUserKrw: number | null };
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export function LandingWorkPrice() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    fetch('/api/public/ai-plans').then((r) => (r.ok ? r.json() : null)).then((m) => {
      const w = m?.plans?.find((p: { code: string }) => p.code === 'w_work');
      if (Array.isArray(w?.bands) && w.bands.length) setRows(w.bands as Row[]);
    }).catch(() => {});
  }, []);
  if (!rows) return null;
  return (
    <div className="mx-auto mt-6 max-w-md text-left" data-testid="landing-work-price">
      <h3 className="text-sm font-semibold">체험 뒤 업무 요금</h3>
      <p className="mt-0.5 text-xs text-ink-3">회사 단위 · 부가세 포함 · 구간 안에서는 인원이 늘어도 같은 금액</p>
      <table className="mt-2 w-full border-collapse text-sm">
        <thead><tr className="border-b border-line text-xs text-ink-3"><th className="py-1.5 text-left font-medium">인원</th><th className="py-1.5 text-right font-medium">월 결제</th><th className="py-1.5 text-right font-medium">연간 결제(월 환산)</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line last:border-0">
              <td className="py-1.5">{r.label}</td>
              <td className="py-1.5 text-right tabular-nums">{r.perUserKrw ? `1인 ${won(r.perUserKrw)}` : won(r.krw)}</td>
              <td className="py-1.5 text-right tabular-nums text-ink-2">{r.perUserKrw ? `1인 ${won(Math.round(r.annualKrw / 12))}` : won(Math.round(r.annualKrw / 12))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
