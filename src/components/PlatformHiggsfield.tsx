'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from './client';
import { Button, Field, cx, inputCls, toast } from './ui';

type Model = { id: string; kind: 'image' | 'video'; name: string; credits: number; usd?: number | null; enabled: boolean; note?: string };
type S = { enabled: boolean; hasKey: boolean; base: string; models: Model[]; pricing: 'credits' | 'usd'; usdKrw: number; updatedAt: string | null };
/** 플랫폼 운영 — Higgsfield 생성 연동(대표 10/20 제작의뢰실 3): 키는 여기서만(암호화 보관, 다시 보여 주지 않음), 모델 표(이미지·영상·크레딧)는 숫자만 바꿈. 켜기 전에는 제작의뢰실이 제작 요청 카드로 넘김 */
export function PlatformHiggsfield() {
  const { data, reload } = useApi<S>('/api/platform/higgsfield');
  const [key, setKey] = useState(''); const [models, setModels] = useState<Model[]>([]); const [base, setBase] = useState(''); const [pricing, setPricing] = useState<'credits' | 'usd'>('credits'); const [usdKrw, setUsdKrw] = useState(1400);
  useEffect(() => { if (data) { setModels(data.models); setBase(data.base); setPricing(data.pricing); setUsdKrw(data.usdKrw); } }, [data]);
  if (!data) return null;
  async function save(body: Record<string, unknown>, msg: string) { try { await api('/api/platform/higgsfield', { method: 'PUT', body }); toast.ok(msg); setKey(''); reload(); } catch (e: any) { toast.error(e.message); } }
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="platform-higgsfield">
      <h2 className="text-base font-bold">Higgsfield 생성 연동 <span className={cx('ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', data.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-ink-2')}>{data.enabled ? '켜짐' : data.hasKey ? '키 있음 · 꺼짐' : '키 없음'}</span></h2>
      <p className="mt-1 text-xs text-ink-2">제작의뢰실 [생성]이 여기 키로 이미지·영상을 만들어 각 회사 자료실에 저장합니다. 꺼져 있으면 제작 요청 카드(프롬프트·참고 사진)로 넘어가 사람이 만듭니다. 키 값은 저장 뒤 다시 보이지 않습니다.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <Field label="API 키(바꿀 때만)"><input className={inputCls} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={data.hasKey ? '저장됨 — 바꾸려면 입력' : 'hf_…'} aria-label="API 키" data-testid="hf-key" /></Field>
        <Field label="API 주소"><input className={inputCls} value={base} onChange={(e) => setBase(e.target.value)} aria-label="API 주소" /></Field>
        <div className="flex items-end"><Button size="sm" onClick={() => save({ ...(key ? { apiKey: key } : {}), base }, '저장했습니다')} data-testid="hf-save">저장</Button></div>
        <div className="flex items-end"><Button size="sm" variant="secondary" onClick={() => save({ enabled: !data.enabled }, data.enabled ? '껐습니다' : '켰습니다')} disabled={!data.hasKey} data-testid="hf-toggle">{data.enabled ? '연동 끄기' : '연동 켜기'}</Button></div>
      </div>
      {/* 로컬 10/20 22:30 ⑤: API 는 console.higgsfield.ai 선불 달러 종량제(구독 크레딧 사용 불가) → 단가(USD) 열 + 표시 단위 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="text-ink-2">표시 단위</span>
        <select className={cx(inputCls, 'h-7 w-auto py-0 text-xs')} value={pricing} onChange={(e) => setPricing(e.target.value as 'credits' | 'usd')} aria-label="비용 표시 단위" data-testid="hf-pricing"><option value="credits">크레딧/건</option><option value="usd">달러 종량제(USD)</option></select>
        <span className="text-ink-2">환율(원/$)</span><input className={cx(inputCls, 'h-7 w-20 py-0 text-xs')} type="number" value={usdKrw} onChange={(e) => setUsdKrw(Number(e.target.value))} aria-label="환율" data-testid="hf-usdkrw" />
        <span className="text-ink-3">이미지 = 장당 USD, 영상 = 초당 USD(의뢰 길이 × 초). 선불 충전은 console.higgsfield.ai</span></div>
      <table className="mt-2 w-full text-xs" data-testid="hf-models"><thead className="text-left text-ink-2"><tr><th className="p-1">모델</th><th className="p-1">종류</th><th className="p-1">이름</th><th className="p-1">크레딧/건</th><th className="p-1">USD(장당·초당)</th><th className="p-1">사용</th></tr></thead>
        <tbody>{models.map((m, i) => <tr key={m.id} className="border-t border-line"><td className="p-1 font-mono">{m.id}</td><td className="p-1">{m.kind === 'video' ? '영상' : '이미지'}</td><td className="p-1"><input className={cx(inputCls, 'h-7 py-0 text-xs')} value={m.name} onChange={(e) => setModels(models.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} aria-label={`${m.id} 이름`} /></td>
          <td className="p-1"><input className={cx(inputCls, 'h-7 w-20 py-0 text-xs')} type="number" step="0.5" value={m.credits} onChange={(e) => setModels(models.map((x, k) => (k === i ? { ...x, credits: Number(e.target.value) } : x)))} aria-label={`${m.id} 크레딧`} data-testid={`hf-credits-${m.id}`} /></td>
          <td className="p-1"><input className={cx(inputCls, 'h-7 w-24 py-0 text-xs')} type="number" step="0.001" value={m.usd ?? ''} onChange={(e) => setModels(models.map((x, k) => (k === i ? { ...x, usd: e.target.value === '' ? null : Number(e.target.value) } : x)))} aria-label={`${m.id} 달러 단가`} data-testid={`hf-usd-${m.id}`} /></td>
          <td className="p-1"><input type="checkbox" checked={m.enabled} onChange={(e) => setModels(models.map((x, k) => (k === i ? { ...x, enabled: e.target.checked } : x)))} aria-label={`${m.id} 사용`} /></td></tr>)}</tbody></table>
      <div className="mt-2 flex justify-end"><Button size="sm" variant="secondary" onClick={() => save({ models, pricing, usdKrw }, '모델 표를 저장했습니다')} data-testid="hf-models-save">모델 표·단위 저장</Button></div>
    </section>
  );
}
