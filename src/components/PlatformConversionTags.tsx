'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from './client';
import { Button, cx, fmtDateTime, inputCls, toast } from './ui';

type Tags = { googleAds: string; ga4: string; metaPixel: string; naverWa: string };
type View = { tags: Tags; saved: Partial<Tags>; fromEnv: (keyof Tags)[]; updatedAt: string | null };
const FIELDS: { k: keyof Tags; label: string; ph: string; hint: string }[] = [
  { k: 'googleAds', label: 'Google Ads 가입 전환', ph: 'AW-123456789/AbCdEfGhIj', hint: 'Google Ads › 목표 › 전환 › 그 전환 액션 › 태그 설정 › "전환 ID/전환 라벨"' },
  { k: 'ga4', label: 'GA4 측정 ID', ph: 'G-XXXXXXXXXX', hint: '소개 사이트 방문·버튼 클릭 + 가입 sign_up' },
  { k: 'metaPixel', label: 'Meta 픽셀 ID', ph: '123456789012345', hint: '가입 CompleteRegistration' },
  { k: 'naverWa', label: '네이버 공통 인증키', ph: 's_1a2b3c4d5e6f', hint: '프리미엄로그분석 회원가입 전환' },
];

/** #449 가입 전환 태그 — 여기서 넣으면 가입 화면에 바로(재배포 없음). 동의(광고 효과 측정)한 가입만, 회사가 만들어지는 순간 1회 */
export function PlatformConversionTags() {
  const { data, reload } = useApi<View>('/api/platform/conversion-tags');
  const [f, setF] = useState<Tags>({ googleAds: '', ga4: '', metaPixel: '', naverWa: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF({ googleAds: data.saved.googleAds ?? '', ga4: data.saved.ga4 ?? '', metaPixel: data.saved.metaPixel ?? '', naverWa: data.saved.naverWa ?? '' }); }, [data]);
  if (!data) return null;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api('/api/platform/conversion-tags', { method: 'PUT', body: f }); toast.ok('가입 전환 태그를 저장했습니다 — 가입 화면에 바로 적용'); reload(); }
    catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="platform-conversion-tags">
      <h2 className="text-sm font-semibold">가입 전환 태그 <span className="ml-1 text-xs font-normal text-ink-3">저장하면 바로 적용 · 비우면 빌드 환경변수 값{data.updatedAt ? ` · 마지막 저장 ${fmtDateTime(data.updatedAt)}` : ''}</span></h2>
      <p className="mt-0.5 text-[11px] text-ink-3">가입할 때 &lsquo;광고 효과 측정&rsquo;(선택)에 동의한 사람만, 회사가 만들어지는 순간 1번 보냅니다. 광고 클릭 id(gclid·fbclid)는 첫 화면에서 그 브라우저에만 기억했다가 그때 함께 넘깁니다. 업무 화면에는 태그를 넣지 않습니다.</p>
      <form onSubmit={save} className="mt-2 grid gap-2 sm:grid-cols-2">
        {FIELDS.map((x) => (
          <label key={x.k} className="text-xs">
            <span className="font-medium">{x.label}</span>{data.fromEnv.includes(x.k) && <span className="ml-1 text-ink-3">(지금 빌드 값 {data.tags[x.k]})</span>}
            <input className={cx(inputCls, 'mt-1 font-mono text-xs')} value={f[x.k]} onChange={(e) => setF({ ...f, [x.k]: e.target.value })} placeholder={x.ph} aria-label={x.label} data-testid={`ct-${x.k}`} />
            <span className="mt-0.5 block text-[11px] text-ink-3">{x.hint}</span>
          </label>
        ))}
        <div className="sm:col-span-2"><Button size="sm" type="submit" disabled={busy} data-testid="ct-save">저장</Button></div>
      </form>
    </section>
  );
}
