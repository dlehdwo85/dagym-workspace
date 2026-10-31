'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Check, Minus, X } from 'lucide-react';
import { api } from '@/components/client';
import { Button, cx, inputCls } from '@/components/ui';

type Item = { key: string; label: string; ok: boolean | null; detail: string };
type Row = { id: string; brand: string; channel: string; kind: string | null; title: string; status: string; scheduledAt: string | null; items: Item[]; pass: number; total: number };
type Data = { rows: Row[]; summary: { key: string; label: string; fail: number; of: number }[] };

/** 칸 순서 — 피드·스토리·블로그 항목을 한 표에(그 글에 없는 항목은 '—') */
const COLS: [string, string][] = [['cover', '표지 사진·화면·도표'], ['kicker', '표지 머리말'], ['count', '장 수'], ['photoShare', '사진 장 절반+'], ['photos', '본문 사진 3장+'],
  ['cta', '마지막 장 행동'], ['heads', '소제목 ■'], ['hook', '첫 줄 훅'], ['tags', '해시태그 끝에'], ['audit', '사진 검사']];
const KIND: Record<string, string> = { feed: '피드', story: '스토리', blog: '블로그', reels: '릴스', shorts: '쇼츠', video: '영상' };
const STATUS: Record<string, string> = { pending: '승인 대기', changes: '수정 요청', draft: '초안', approved: '승인됨' };

/**
 * 295차 #835(대표 10/31 '레퍼런스를 안 한 느낌'): 레퍼런스 대조표 — 승인 대기·수정 요청 글을 레퍼런스 기준(카드뉴스 사례형 구성)과 나란히.
 * 열 때만 읽음(글마다 사진 검사를 하므로). 칸을 누르거나 길게 누르면 까닭(detail)이 보임 — 휴대폰에서도 칸 아래 작은 글씨로 보임
 */
export function RefCheck() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [brand, setBrand] = useState('');
  const [failOnly, setFailOnly] = useState(false);
  async function load() {
    setBusy(true); setErr('');
    try { setData(await api<Data>('/api/marketing/refcheck')); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const brands = data ? [...new Set(data.rows.map((r) => r.brand).filter(Boolean))] : [];
  const rows = (data?.rows ?? []).filter((r) => (!brand || r.brand === brand) && (!failOnly || r.pass < r.total));
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="refcheck">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">레퍼런스 대조표</h2>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={load} disabled={busy} data-testid="refcheck-load">{busy ? '읽는 중…' : data ? '다시 읽기' : '대조표 열기'}</Button>
      </div>
      <p className="mt-1 text-xs text-ink-2">승인 대기·수정 요청 글을 레퍼런스 기준과 나란히 봅니다 — 표지에 사진·화면·도표, 표지 머리말(시리즈 이름), 카드뉴스 4~8장, 사진 장 절반 이상, 마지막 장 행동 권유, 첫 줄 훅, 해시태그는 끝에, 사진 검사(흔들림·브랜드 밖·겹침).</p>
      {err && <p className="mt-2 text-sm text-red-700" role="alert">{err}</p>}
      {data && (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5" data-testid="refcheck-summary">
            {data.summary.map((s) => (
              <span key={s.key} className={cx('rounded-full border px-2 py-0.5 text-xs', s.fail ? 'border-red-200 bg-red-50 text-red-800' : 'border-line bg-canvas text-ink-2')}>
                {s.label} 미통과 <b className="tabular-nums">{s.fail}</b>/{s.of}
              </span>
            ))}
            {!data.rows.length && <span className="text-xs text-ink-3">대조할 글이 없습니다(승인 대기·수정 요청 0건)</span>}
          </div>
          {data.rows.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <select className={cx(inputCls, 'h-8 w-auto text-xs')} value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="브랜드" data-testid="refcheck-brand">
                <option value="">브랜드 전체 ({data.rows.length})</option>
                {brands.map((b) => <option key={b} value={b}>{b} ({data.rows.filter((r) => r.brand === b).length})</option>)}
              </select>
              <label className="flex items-center gap-1 text-ink-2"><input type="checkbox" checked={failOnly} onChange={(e) => setFailOnly(e.target.checked)} />미통과 있는 글만</label>
            </div>
          )}
          {rows.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-xs" data-testid="refcheck-table">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="py-1.5 pr-2 font-medium">글</th>
                    {COLS.map(([, l]) => <th key={l} className="px-1 py-1.5 text-center font-medium">{l}</th>)}
                    <th className="px-1 py-1.5 text-center font-medium">통과</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-line/60 align-top" data-testid="refcheck-row" data-id={r.id}>
                      <td className="max-w-[220px] py-1.5 pr-2">
                        <Link href={`/s/marketing/approvals?c=${r.id}`} className="line-clamp-2 font-medium text-ink hover:underline">{r.title}</Link>
                        <div className="text-[11px] text-ink-3">{[r.brand, KIND[r.kind ?? ''] ?? r.kind, STATUS[r.status] ?? r.status, r.scheduledAt ? new Date(r.scheduledAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }) : ''].filter(Boolean).join(' · ')}</div>
                      </td>
                      {COLS.map(([k]) => {
                        const it = r.items.find((i) => i.key === k) ?? (k === 'cover' ? r.items.find((i) => i.key === 'video') : undefined);
                        return (
                          <td key={k} className="px-1 py-1.5 text-center" title={it?.detail} data-testid={`refcheck-${k}`} data-ok={it ? String(it.ok) : 'na'}>
                            {!it ? <span className="text-ink-3">—</span>
                              : it.ok === null ? <Minus className="mx-auto size-4 text-ink-3" aria-label="대조 안 함" />
                                : it.ok ? <Check className="mx-auto size-4 text-green-600" aria-label="통과" /> : <X className="mx-auto size-4 text-red-600" aria-label="미통과" />}
                            {it && it.ok !== true && <div className="mx-auto mt-0.5 max-w-[110px] text-[10px] leading-tight text-ink-3">{it.detail}</div>}
                          </td>
                        );
                      })}
                      <td className="px-1 py-1.5 text-center tabular-nums">{r.pass}/{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
