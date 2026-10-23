'use client';
import { useState } from 'react';
import { api } from '@/components/client';
import { cx, inputCls, toast } from '@/components/ui';
import { MediaPick } from './MediaPick';

type Kit = { logoFileId?: string | null; headline?: string | null; cta?: string | null; endColor?: string | null; fontFileId?: string | null };
/** #454 브랜드 키트 — 영상 끝 화면(로고·한 줄·CTA·배경색)과 자막 글꼴(자료실 OTF/TTF, 비우면 Noto Sans KR Bold). 제작의뢰실 영상 합성이 읽는다 */
export function BrandVideoKit({ brand, onSaved }: { brand: { id: string; name: string; color?: string | null; video?: Kit | null }; onSaved: () => void }) {
  const v = brand.video ?? {}; const [color, setColor] = useState(v.endColor ?? brand.color ?? '#111111');
  const save = (body: Kit) => api(`/api/marketing/auto/brands/${brand.id}`, { method: 'PATCH', body: { video: body } }).then(() => { toast.ok('영상 키트를 저장했습니다'); onSaved(); }).catch((e) => toast.error(e.message));
  const sm = cx(inputCls, 'h-8 py-0 text-xs');
  return (
    <div className="grid gap-1.5 text-xs sm:col-span-4 sm:pl-[8.5rem]" data-testid={`brand-video-${brand.name}`}>
      <span className="text-ink-3">영상 끝 화면·자막(제작의뢰실 영상 합성)</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <input className={cx(sm, 'w-56')} defaultValue={v.headline ?? ''} maxLength={30} placeholder="끝 화면 한 줄(비우면 AI 안·브랜드 이름)" onBlur={(e) => e.target.value !== (v.headline ?? '') && save({ headline: e.target.value || null })} aria-label={`${brand.name} 끝 화면 한 줄`} data-testid="brand-video-headline" />
        <input className={cx(sm, 'min-w-56 flex-1')} defaultValue={v.cta ?? ''} maxLength={60} placeholder="CTA(예: 14일 무료 체험 · work-in.dev)" onBlur={(e) => e.target.value !== (v.cta ?? '') && save({ cta: e.target.value || null })} aria-label={`${brand.name} 끝 화면 CTA`} data-testid="brand-video-cta" />
        <label className="flex items-center gap-1">배경색<input type="color" className="h-8 w-10 cursor-pointer rounded border border-line" value={color} onChange={(e) => setColor(e.target.value)} onBlur={() => color !== (v.endColor ?? '') && save({ endColor: color })} aria-label={`${brand.name} 끝 화면 배경색`} /></label>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex items-center gap-1.5"><span>로고</span>{v.logoFileId ? <><img src={`/api/library/${v.logoFileId}/download?inline=1`} alt="" className="h-8 max-w-24 rounded bg-slate-50 object-contain" /><button type="button" className="underline" onClick={() => save({ logoFileId: null })}>빼기</button></>
          : <MediaPick value={[]} onChange={(m) => { const f = m.at(-1); if (f) save({ logoFileId: f.id }); }} label="자료실에서 로고 고르기" />}</div>
        <div className="flex items-center gap-1.5"><span>자막 글꼴</span>{v.fontFileId ? <><span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-800">브랜드 글꼴</span><button type="button" className="underline" onClick={() => save({ fontFileId: null })}>기본 글꼴로</button></>
          : <><span className="text-ink-3">Noto Sans KR Bold</span><MediaPick value={[]} onChange={(m) => { const f = m.at(-1); if (f) save({ fontFileId: f.id }); }} label="글꼴 파일(OTF·TTF) 고르기" /></>}</div>
      </div>
    </div>
  );
}
