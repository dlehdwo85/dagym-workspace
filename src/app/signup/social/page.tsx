'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Building2, Loader2, User } from 'lucide-react';
import { AuthCard } from '@/components/AuthCard';
import { Button, Field, cx, inputCls } from '@/components/ui';
import { ApiError, api } from '@/components/client';
import { CompanyFields } from '@/components/SignupFields';
import { SignupSteps } from '@/components/SignupSteps';
import { conversionTagsConfigured, fireSignupConversion, readUtm, setAdsConsent } from '@/components/conversion';

/** V29 소셜 확인 뒤 2단계 "회사 만들기" — 확인된 이메일이라 확인 메일 없이 바로 시작(동료 초대는 첫 화면 안내에서) */
function SocialSignup() {
  const t = useSearchParams().get('t') ?? '';
  const [info, setInfo] = useState<{ providerLabel: string; email: string; name: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'personal' | 'team'>('team');
  const [f, setF] = useState({ name: '', company: '', size: '', industry: '', industries: [] as string[] });
  const [agree, setAgree] = useState({ terms: false, age14: false, privacy: false, ai: false, marketing: false });
  const [ads, setAds] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/api/auth/oauth/pending?t=${encodeURIComponent(t)}`).then((r) => { setInfo(r); setF((x) => ({ ...x, name: r.name ?? '' })); }).catch((e) => setErr(e.message)); }, [t]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!agree.terms || !agree.privacy || !agree.age14) { setErr('필수 약관에 동의해 주세요'); return; }
    setBusy(true);
    try {
      setAdsConsent(ads);
      await api('/api/auth/oauth/complete', { body: { token: t, name: f.name, mode, company: mode === 'team' ? f.company : undefined, size: mode === 'team' && f.size ? f.size : undefined,
        industry: mode === 'team' && f.industry ? f.industry : undefined, industries: mode === 'team' ? f.industries : undefined, agree: { ...agree, ads }, utm: readUtm() } });
      await fireSignupConversion();
      location.href = '/';
    } catch (e) { setErr(e instanceof ApiError ? e.message : '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'); setBusy(false); }
  }
  if (!info) return err ? <div className="space-y-3 text-sm"><p className="rounded-input border border-red-200 bg-red-50 p-3 text-red-800" role="alert">{err}</p><Link href="/signup" className="font-semibold text-brand-700 underline">가입 화면으로</Link></div>
    : <p className="flex items-center gap-2 text-sm text-ink-2"><Loader2 className="size-4 animate-spin" />확인 중…</p>;
  const box = (k: keyof typeof agree, label: React.ReactNode, req: boolean) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={agree[k]} onChange={(e) => setAgree({ ...agree, [k]: e.target.checked })} aria-label={typeof label === 'string' ? label : k} data-testid={`agree-${k}`} />
      <span><span className={cx('mr-1 text-xs font-semibold', req ? 'text-red-600' : 'text-ink-3')}>{req ? '[필수]' : '[선택]'}</span>{label}</span></label>
  );
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="social-signup">
      <p className="rounded-input bg-brand-50 p-3 text-sm text-brand-800">{info.providerLabel} 계정 <b>{info.email}</b> 확인됨 — 이 이메일이 로그인·업무 이메일·메일 회신 주소가 됩니다.</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="시작 방식">
        {([['team', Building2, '팀으로 시작', '회사·팀·메신저'], ['personal', User, '개인으로 시작', '혼자 쓰는 업무·일정']] as const).map(([k, Icon, ti, d]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} data-testid={`mode-${k}`}
            className={cx('rounded-card border p-3 text-left', mode === k ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-line hover:border-ink-3')}>
            <Icon className="size-5 text-brand-700" /><div className="mt-1 text-sm font-semibold">{ti}</div><div className="text-xs text-ink-2">{d}</div></button>
        ))}
      </div>
      <Field label="이름"><input className={inputCls + ' h-11'} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={50} aria-label="이름" /></Field>
      {mode === 'team' && <CompanyFields v={f} onChange={(v) => setF({ ...f, ...v })} />}
      <div className="space-y-2 rounded-card border border-line p-3">
        {box('terms', <><Link href="/terms" target="_blank" className="underline">이용약관</Link> 동의</>, true)}
        {box('privacy', <><Link href="/privacy" target="_blank" className="underline">개인정보 수집·이용</Link> 동의</>, true)}
        {box('age14', '만 14세 이상입니다', true)}
        {box('ai', <><Link href="/ai-notice" target="_blank" className="underline">AI 기능 이용</Link>(입력 내용이 AI 처리 업체로 전송) 동의</>, false)}
        {box('marketing', '새 기능·혜택 소식 받기', false)}
        {conversionTagsConfigured() && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={ads} onChange={(e) => setAds(e.target.checked)} aria-label="광고 효과 측정" /><span>광고 효과 측정(가입 완료 1회) 동의 <span className="text-ink-3">(선택)</span></span></label>}
      </div>
      {err && <p className="rounded-input border border-red-200 bg-red-50 p-2.5 text-sm text-red-800" role="alert">{err}</p>}
      <Button type="submit" className="h-11 w-full text-[15px]" disabled={busy} data-testid="social-signup-submit">{busy ? <><Loader2 className="animate-spin" />만드는 중…</> : <>무료로 시작<ArrowRight /></>}</Button>
      <p className="text-center text-xs text-ink-3">14일 무료 체험 · 카드 없음 · 다음 화면에서 동료를 초대할 수 있어요</p>
    </form>
  );
}
export default function SocialSignupPage() {
  return <AuthCard title="회사 만들기" sub="회사 정보만 적으면 바로 시작합니다"><SignupSteps at={2} /><Suspense><SocialSignup /></Suspense></AuthCard>;
}
