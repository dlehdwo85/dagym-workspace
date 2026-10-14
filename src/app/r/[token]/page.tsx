'use client';
import { use, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, MapPin, ShieldCheck, X } from 'lucide-react';
import { ApiError, api } from '@/components/client';
import { Button, Field, inputCls } from '@/components/ui';

/** 사진을 긴 변 1600px JPEG 로 줄여 보낸다 (통신량·서버 저장 절약) */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('사진을 읽지 못했습니다');
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

/** B-8 현장 QR 신고 (로그인 없이) */
export default function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ content: '', location: '', name: '', phone: '', website: '', agree: false });
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  useEffect(() => { api(`/api/public/forms/${token}`).then(setInfo).catch((e) => setErr(e.message)); }, [token]);
  const needContact = info?.kind === 'complaint';
  const hasPersonal = !!(f.name || f.phone);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api(`/api/public/forms/${token}`, { body: { content: f.content, location: f.location || undefined, name: f.name || undefined, phone: f.phone || undefined, website: f.website || undefined, agree: f.agree, photo: photo || undefined } });
      setDone(r.receipt);
    } catch (er) { setErr(er instanceof ApiError ? er.message : '전송하지 못했습니다. 잠시 후 다시 시도해 주세요.'); } finally { setBusy(false); }
  }
  return (
    <div className="min-h-screen bg-canvas px-4 py-6">
      <div className="mx-auto max-w-md">
        <div className="mb-5 flex items-center gap-2.5">
          <img src="/icon.svg" alt="" className="size-9" />
          <div><div className="text-xs text-ink-2">{info?.brand ?? '다짐 · 하이링크'}</div><div className="font-bold">{info ? `${info.place} ${info.kindLabel} 신고` : '현장 신고'}</div></div>
        </div>
        {!info && !err && <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-2"><Loader2 className="size-4 animate-spin" />불러오는 중…</div>}
        {!info && err && <div className="rounded-card border border-line bg-white p-6 text-center text-sm" role="alert">{err}</div>}
        {done && (
          <div className="rounded-card border border-line bg-white p-8 text-center shadow-card" data-testid="report-done">
            <CheckCircle2 className="mx-auto size-12 text-green-500" />
            <p className="mt-3 text-lg font-bold">접수되었습니다</p>
            <p className="mt-1 text-sm text-ink-2">접수 번호 <b className="tabular-nums text-ink">{done}</b><br />현장 담당자에게 바로 전달했습니다. 감사합니다.</p>
            <Button variant="secondary" className="mt-5" onClick={() => { setDone(null); setF({ content: '', location: '', name: '', phone: '', website: '', agree: false }); setPhoto(''); }}>다른 내용 신고</Button>
          </div>
        )}
        {info && !done && (
          <form onSubmit={submit} className="space-y-4 rounded-card border border-line bg-white p-5 shadow-card">
            <Field label={info.kind === 'supply' ? '필요한 비품과 수량' : info.kind === 'complaint' ? '불편하신 점' : '고장 내용'}>
              <textarea className={inputCls} rows={4} required minLength={5} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })}
                placeholder={info.kind === 'facility' ? '예: 런닝머신 3번 벨트가 미끄러져요' : info.kind === 'supply' ? '예: 여자 탈의실 수건 부족' : '내용을 자세히 적어 주세요'} />
            </Field>
            <Field label="위치 (선택)">
              <span className="relative block"><MapPin className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
                <input className={inputCls + ' pl-8'} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="예: 2층 유산소존" /></span>
            </Field>
            <div>
              <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" data-testid="report-photo"
                onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { setPhoto(await shrink(file)); } catch (er: any) { setErr(er.message); } }} />
              {photo ? (
                <div className="relative inline-block"><img src={photo} alt="첨부한 사진" className="h-32 rounded-input border border-line object-cover" />
                  <button type="button" onClick={() => setPhoto('')} className="absolute -right-2 -top-2 rounded-full bg-slate-800 p-1 text-white" aria-label="사진 빼기"><X className="size-3.5" /></button></div>
              ) : <Button type="button" variant="secondary" onClick={() => cam.current?.click()}><Camera />사진 첨부 (선택)</Button>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={needContact ? '이름' : '이름 (선택)'}><input className={inputCls} required={needContact} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></Field>
              <Field label={needContact ? '연락처' : '연락처 (선택)'}><input className={inputCls} required={needContact} type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></Field>
            </div>
            {/* 사람에게는 보이지 않는 미끼 입력칸 (자동 등록 방지) */}
            <input tabIndex={-1} autoComplete="off" className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden name="website" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
            {(hasPersonal || needContact) && (
              <label className="flex items-start gap-2 rounded-input bg-slate-50 p-3 text-xs text-ink-2">
                <input type="checkbox" className="mt-0.5 accent-brand-600" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} required />
                <span><b className="text-ink">개인정보 수집·이용 동의 (필수)</b><br />수집 항목: 이름·연락처 · 목적: 신고 처리 결과 회신 · 보관: 처리 완료 후 1년 · 동의하지 않으면 이름·연락처 없이 신고할 수 있습니다{needContact ? '(민원은 회신을 위해 필요)' : ''}. <a href="/privacy" className="underline">개인정보처리방침</a></span>
              </label>
            )}
            {err && <p className="rounded-input bg-red-50 p-3 text-sm text-red-800" role="alert">{err}</p>}
            <Button type="submit" className="h-11 w-full" disabled={busy}>{busy ? <><Loader2 className="animate-spin" />보내는 중…</> : '신고 보내기'}</Button>
            <p className="flex items-center justify-center gap-1 text-[11px] text-ink-3"><ShieldCheck className="size-3.5" />신고 내용은 이 현장 담당자만 봅니다</p>
          </form>
        )}
      </div>
    </div>
  );
}
