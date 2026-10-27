'use client';
import { useSalesTerms } from '@/components/session';
import { cx } from '@/components/ui';
import { stageKeyOf, stageName } from '@/lib/sales/terms';

/**
 * 207차(#461, SALES_LEADS_REVAMP 2-3 '단계 = 칩(회사 설정 단계명·색)'): 리드 단계의 화면 이름·색·숨김(회사 설정 › 데이터 설정).
 * 저장 값(단계 키)은 그대로 — 화면에 보일 때만 회사 이름으로 바꾼다. 숨긴 단계는 고르는 칸에서만 빠진다(그 단계에 있는 거래처는 그대로 보임)
 */
export function useStages() {
  const cfg = useSalesTerms().stages;
  return {
    cfg,
    name: (k: unknown) => stageName(cfg, k),
    /** 고를 수 있는 단계(숨긴 단계 빼고, 지금 단계는 남김) */
    pickable: (keys: readonly string[], cur?: string | null) => keys.filter((k) => !cfg?.[k]?.hidden || k === cur),
    hidden: (k: string) => !!cfg?.[k]?.hidden,
    keyOf: (v: string) => stageKeyOf(cfg, v),
  };
}
/** 단계 칩 — 회사가 색을 정했으면 그 색(흰 글자), 아니면 예전 파란 칩 */
export function StageChip({ k, className }: { k: unknown; className?: string }) {
  const cfg = useSalesTerms().stages;
  if (k === null || k === undefined || k === '') return null;
  const c = cfg?.[String(k)];
  return c?.color
    ? <span className={cx('rounded-full px-1.5 text-[11px] font-medium text-white', className)} style={{ background: c.color }} data-stage={String(k)}>{c.label}</span>
    : <span className={cx('rounded-full bg-[#EFF6FF] px-1.5 text-[11px] text-[#1D4ED8]', className)} data-stage={String(k)}>{stageName(cfg, k)}</span>;
}
