'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from './client';
import { Button, cx, fmtDateTime, inputCls, toast } from './ui';

type Field = [string, string, string, number, number, string];
type View = { rules: Record<string, Record<string, number>>; defaults: Record<string, Record<string, number>>; fields: Field[]; sections: Record<string, string>; updatedAt: string | null };

/** #426 글 품질 규칙 — 플랫폼 숫자는 바뀐다(인스타 해시태그 30 → 5개, 2025-12-18). 저장하면 다음 제작·검사부터(재배포 없음) */
export function PlatformQualityRules() {
  const { data, reload } = useApi<View>('/api/platform/quality-rules');
  const [f, setF] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF(Object.fromEntries(data.fields.map(([s, k]) => [`${s}.${k}`, String(data.rules[s]?.[k] ?? '')]))); }, [data]);
  if (!data) return null;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const body: Record<string, Record<string, number>> = {};
    for (const [s, k] of data!.fields) (body[s] ??= {})[k] = Number(f[`${s}.${k}`]);
    try { await api('/api/platform/quality-rules', { method: 'PUT', body }); toast.ok('글 품질 규칙을 저장했습니다 — 다음 제작·검사부터'); reload(); }
    catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="platform-quality-rules">
      <h2 className="text-sm font-semibold">글 품질 규칙 <span className="ml-1 text-xs font-normal text-ink-3">AI 원고·자막·광고 문구 검사 숫자{data.updatedAt ? ` · 마지막 저장 ${fmtDateTime(data.updatedAt)}` : ' · 지금은 기본값'}</span></h2>
      <p className="mt-0.5 text-[11px] text-ink-3">훅 점수는 나쁜 훅을 거르는 데만 씁니다(통과한 훅끼리는 실제 성과로). 사람다움 점수가 기준 아래면 승인함에 &lsquo;다듬기 필요&rsquo;가 붙습니다. 채널 숫자는 플랫폼 정책이 바뀌면 여기서 고칩니다.</p>
      <form onSubmit={save} className="mt-2 space-y-2">
        {Object.entries(data.sections).map(([s, title]) => (
          <fieldset key={s} className="rounded-input border border-line px-2.5 pb-2 pt-1" data-testid={`qr-sec-${s}`}>
            <legend className="px-1 text-xs font-semibold text-ink-2">{title}</legend>
            <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">{data.fields.filter((x) => x[0] === s).map(([, k, label, min, max, unit]) => {
              const key = `${s}.${k}`; const d = data.defaults[s]?.[k];
              return (
                <label key={key} className="text-xs"><span className="font-medium">{label}</span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <input type="number" inputMode="numeric" min={min} max={max} step="any" className={cx(inputCls, 'h-8 !w-24 py-0 text-xs')} value={f[key] ?? ''} onChange={(e) => setF({ ...f, [key]: e.target.value })} aria-label={`${title} ${label}`} data-testid={`qr-${s}-${k}`} />
                    <span className="text-ink-3">{unit}</span>{String(d) !== f[key] && <span className="text-violet-700">기본 {d}</span>}
                  </span>
                </label>);
            })}</div>
          </fieldset>))}
        <Button size="sm" type="submit" disabled={busy} data-testid="qr-save">저장</Button>
      </form>
    </section>
  );
}
