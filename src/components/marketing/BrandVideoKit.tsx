'use client';
import { useState } from 'react';
import { api } from '@/components/client';
import { cx, inputCls, toast } from '@/components/ui';
import { MediaPick } from './MediaPick';

type Kit = { logoFileId?: string | null; headline?: string | null; cta?: string | null; endColor?: string | null; fontFileId?: string | null;
  /** 209차 #666 ⑤ 출연진 고정 */ castFileId?: string | null; castEn?: string | null; castKind?: 'generated' | 'real' | null; castConsent?: boolean; castConsentAt?: string | null;
  /** 271차 #811 릴스·쇼츠 영상 만드는 방법 */ method?: 'photos' | 'screen' | 'ai' | null;
  /** 288차 #814-2 시안 사진 · 293차 scenes */ photoSource?: 'brand' | 'screen' | 'scenes' | 'any' | null };
/** #454 브랜드 키트 — 영상 끝 화면(로고·한 줄·CTA·배경색)과 자막 글꼴(자료실 OTF/TTF, 비우면 Noto Sans KR Bold). 제작의뢰실 영상 합성이 읽는다 */
export function BrandVideoKit({ brand, onSaved }: { brand: { id: string; name: string; color?: string | null; video?: Kit | null }; onSaved: () => void }) {
  const v = brand.video ?? {}; const [color, setColor] = useState(v.endColor ?? brand.color ?? '#111111');
  const [castKind, setCastKind] = useState<'generated' | 'real'>('generated'); const [consent, setConsent] = useState(false);
  const save = (body: Kit) => api(`/api/marketing/auto/brands/${brand.id}`, { method: 'PATCH', body: { video: body } }).then(() => { toast.ok('영상 키트를 저장했습니다'); onSaved(); }).catch((e) => toast.error(e.message));
  const sm = cx(inputCls, 'h-8 py-0 text-xs');
  return (
    <div className="grid gap-1.5 text-xs sm:col-span-4 sm:pl-[8.5rem]" data-testid={`brand-video-${brand.name}`}>
      {/* 271차 #811(대표 10/29 'AI 영상 비용 최소화'): 자동 시안의 릴스·쇼츠를 무엇으로 만들지 — 실제 사진·화면 녹화는 생성 비용 0 */}
      <label className="flex flex-wrap items-center gap-1.5" data-testid="brand-video-method-row">
        <span>릴스·쇼츠 영상 만드는 방법</span>
        <select className={cx(sm, 'w-auto')} value={v.method ?? ''} onChange={(e) => save({ method: (e.target.value || null) as Kit['method'] })} aria-label={`${brand.name} 영상 만드는 방법`} data-testid="brand-video-method">
          <option value="">정하지 않음(제작 요청 카드)</option>
          <option value="photos">자료실 실제 사진으로 영상 · 0원</option>
          <option value="screen">앱 화면 녹화 · 0원</option>
          <option value="ai">AI 영상 · 크레딧</option>
        </select>
        <span className="text-ink-3">{v.method === 'photos' ? '원고가 나오면 이 브랜드 현장 사진 3~6장을 천천히 움직여 자막·끝 화면을 붙입니다. 사진이 3장이 안 되면 제작 요청 카드로 남습니다' : v.method === 'screen' ? '녹화 파일을 자료실 마케팅/화면 녹화에 올려 붙입니다' : ''}</span>
      </label>
      {/* 288차 #814-2(대표 10/31 '브랜드 사진 폴더 밖 사진은 못 쓰게 · 워크인은 앱 화면 녹화·캡처만'): 표지·카드 장·블로그 본문에 쓸 사진 */}
      <label className="flex flex-wrap items-center gap-1.5" data-testid="brand-photo-source-row">
        <span>시안에 쓸 사진</span>
        <select className={cx(sm, 'w-auto')} value={v.photoSource ?? 'brand'} onChange={(e) => save({ photoSource: e.target.value as Kit['photoSource'] })} aria-label={`${brand.name} 시안에 쓸 사진`} data-testid="brand-photo-source">
          <option value="brand">이 브랜드 사진만(기본)</option>
          <option value="screen">앱 화면 캡처만 — 실사 안 씀</option>
          <option value="scenes">앱 화면 + 출입·업무 장면 실사만</option>
          <option value="any">이름 없는 사진도 씀(예전 방식)</option>
        </select>
        <span className="text-ink-3">{(v.photoSource ?? 'brand') === 'brand' ? `자료실 폴더·파일 이름·태그·설명에 '${brand.name}'(또는 다른 표기)이 든 사진만 씁니다 — 브랜드가 하나뿐인 회사는 모든 사진` : v.photoSource === 'screen' ? "표지·카드 장은 브랜드 색·휴대폰/노트북 틀, 블로그 본문은 자료실 '영상 화면 캡처'의 이 브랜드 화면만 씁니다" : v.photoSource === 'scenes' ? '이 브랜드 화면 캡처와, AI 사진 설명이 출입·입장·얼굴 인식 단말이나 컴퓨터·휴대폰으로 업무·앱을 쓰는 장면인 실사만 씁니다(현장·시설 사진은 안 씀)' : '브랜드 이름이 없는 사진도 씁니다(다른 브랜드 이름이 든 사진은 뒤로)'}</span>
      </label>
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
      {/* 209차 #666 ⑤ 출연진 고정: 주인공 사진으로 장면마다 첫 사진 → 영상(같은 사람이 모든 장면에) */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="brand-video-cast">
        <span>주인공</span>
        {v.castFileId ? <><img src={`/api/library/${v.castFileId}/download?inline=1`} alt="" className="size-8 rounded-full bg-slate-50 object-cover" />
          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-800" data-testid="brand-video-cast-kind-label">{v.castKind === 'real' ? `실존 인물 · 광고 사용 동의${v.castConsentAt ? ` ${v.castConsentAt.slice(0, 10)}` : ''}` : '생성 인물'}</span>
          <button type="button" className="underline" onClick={() => save({ castFileId: null, castKind: null })}>빼기</button></>
          : <>
            <select className={cx(sm, 'w-auto')} value={castKind} onChange={(e) => { setCastKind(e.target.value as 'generated' | 'real'); setConsent(false); }} aria-label={`${brand.name} 주인공 종류`} data-testid="brand-video-cast-kind"><option value="generated">생성 인물(AI로 만든 사람)</option><option value="real">실존 인물</option></select>
            {castKind === 'real' && <label className="flex items-center gap-1"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="brand-video-cast-consent" />사진 속 사람에게 광고 사용 동의를 받았습니다</label>}
            {(castKind === 'generated' || consent) && <MediaPick value={[]} onChange={(m) => { const f = m.at(-1); if (f) save({ castFileId: f.id, castKind, castConsent: castKind === 'real' ? consent : undefined }); }} label="자료실에서 주인공 사진 고르기" />}</>}
        <input className={cx(sm, 'min-w-64 flex-1')} defaultValue={v.castEn ?? ''} maxLength={300} placeholder="주인공 묘사(선택, 영어로 — 예: a Korean woman in her 30s, short black hair, navy cardigan)" onBlur={(e) => e.target.value !== (v.castEn ?? '') && save({ castEn: e.target.value || null })} aria-label={`${brand.name} 주인공 묘사`} data-testid="brand-video-cast-en" />
      </div>
      <span className="text-ink-3">주인공 사진이 있으면 장면마다 이 사람으로 첫 사진을 만든 뒤 영상으로 만듭니다 — 모든 장면에 같은 사람이 나옵니다(운영 설정이 켜져 있을 때).</span>
    </div>
  );
}
