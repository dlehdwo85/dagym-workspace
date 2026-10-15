'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Building2, CheckCircle2, Loader2, MailCheck, User } from 'lucide-react';
import { AuthCard, PasswordInput } from '@/components/AuthCard';
import { Button, Field, cx, inputCls } from '@/components/ui';
import { ApiError, api } from '@/components/client';
import { captureUtm, conversionTagsConfigured, readUtm, setAdsConsent } from '@/components/conversion';

/** V15 공개 가입: 개인으로 시작 / 팀(회사)으로 시작 → 확인 메일 */
export default function SignupPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'personal' | 'team'>('personal');
  const [f, setF] = useState({ name: '', email: '', password: '', company: '', website: '' });
  const [agree, setAgree] = useState({ terms: false, privacy: false, ai: false, marketing: false });
  const [ads, setAds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; devLink?: string } | null>(null);
  const opened = useRef(Date.now());
  useEffect(() => { captureUtm(); }, []);
  useEffect(() => { api('/api/auth/signup').then((r) => setEnabled(!!r.enabled)).catch(() => setEnabled(false)); }, []);
  const all = agree.terms && agree.privacy && agree.ai && agree.marketing;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!agree.terms || !agree.privacy) { setErr('필수 약관에 동의해 주세요'); return; }
    setBusy(true);
    try {
      setAdsConsent(ads);
      const r = await api('/api/auth/signup', { body: { ...f, company: mode === 'team' ? f.company : undefined, mode, agree: { ...agree, ads }, openedAt: opened.current, utm: readUtm() } });
      setDone(r);
    } catch (e) { setErr(e instanceof ApiError ? e.message : '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'); } finally { setBusy(false); }
  }

  if (enabled === false) return (
    <AuthCard title="가입 준비 중" sub="공개 가입은 곧 열립니다">
      <p className="text-sm text-ink-2">지금은 초대받은 계정만 쓸 수 있습니다.</p>
      <Link href="/login" className="mt-4 inline-block text-sm font-semibold text-brand-700 underline">로그인으로</Link>
    </AuthCard>
  );
  if (done) return (
    <AuthCard title="메일을 확인해 주세요" sub={f.email}>
      <div className="flex gap-3 rounded-card border border-green-200 bg-green-50 p-4 text-sm text-green-900" data-testid="signup-done">
        <MailCheck className="size-5 shrink-0" /><p>{done.message}</p>
      </div>
      {done.devLink && <p className="mt-3 text-xs text-ink-3">개발용 확인 링크: <a href={done.devLink} className="underline" data-testid="dev-verify-link">{done.devLink}</a></p>}
      <p className="mt-4 text-xs text-ink-3">메일이 안 오면 스팸함을 확인하거나, <Link href={`/login?resend=${encodeURIComponent(f.email)}`} className="underline">로그인 화면</Link>에서 다시 받으세요.</p>
    </AuthCard>
  );
  const box = (k: keyof typeof agree, label: React.ReactNode, req: boolean) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={agree[k]} onChange={(e) => setAgree({ ...agree, [k]: e.target.checked })} aria-label={typeof label === 'string' ? label : k} data-testid={`agree-${k}`} />
      <span><span className={cx('mr-1 text-xs font-semibold', req ? 'text-red-600' : 'text-ink-3')}>{req ? '[필수]' : '[선택]'}</span>{label}</span></label>
  );
  return (
    <AuthCard title="14일 무료 체험" sub="카드 등록 없이 비즈니스 기능 전부 · 끝나면 요금제를 고르세요">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="시작 방식">
          {([['personal', User, '개인으로 시작', '혼자 쓰는 업무·일정'], ['team', Building2, '팀으로 시작', '팀·메신저·권한']] as const).map(([k, Icon, t, d]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} data-testid={`mode-${k}`}
              className={cx('rounded-card border p-3 text-left', mode === k ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-line hover:bg-slate-50')}>
              <Icon className="size-5 text-brand-700" /><div className="mt-1 text-sm font-semibold">{t}</div><div className="text-xs text-ink-3">{d}</div>
            </button>
          ))}
        </div>
        {mode === 'team' && <Field label="회사(팀) 이름"><input className={inputCls + ' h-11'} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} required maxLength={60} placeholder="예: 우리상사" aria-label="회사 이름" /></Field>}
        <Field label="이름"><input className={inputCls + ' h-11'} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={50} autoComplete="name" aria-label="이름" /></Field>
        <Field label="이메일"><input className={inputCls + ' h-11'} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="email" aria-label="이메일" /></Field>
        <Field label="비밀번호 (8자 이상)"><PasswordInput value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" minLength={8} /></Field>
        {/* 봇 방지: 사람에게는 안 보이는 칸 */}
        <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden"><label>웹사이트<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} name="website" /></label></div>
        <div className="space-y-2 rounded-card border border-line p-3">
          <label className="flex items-center gap-2 border-b border-line pb-2 text-sm font-semibold"><input type="checkbox" checked={all} onChange={(e) => setAgree({ terms: e.target.checked, privacy: e.target.checked, ai: e.target.checked, marketing: e.target.checked })} aria-label="전체 동의" />전체 동의</label>
          {box('terms', <><Link href="/terms" target="_blank" className="underline">이용약관</Link> 동의</>, true)}
          {box('privacy', <><Link href="/privacy" target="_blank" className="underline">개인정보 수집·이용</Link> 동의</>, true)}
          {box('ai', <><Link href="/ai-notice" target="_blank" className="underline">AI 기능 이용</Link>(입력 내용이 AI 처리 업체로 전송) 동의</>, false)}
          {box('marketing', '새 기능·혜택 소식 받기', false)}
          {conversionTagsConfigured() && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={ads} onChange={(e) => setAds(e.target.checked)} aria-label="광고 효과 측정" data-testid="agree-ads" /><span>광고 효과 측정(가입 완료 1회 — Meta·Google·네이버 태그) 동의 <span className="text-ink-3">(선택)</span></span></label>}
        </div>
        {err && <p className="rounded-input border border-red-200 bg-red-50 p-2.5 text-sm text-red-800" role="alert">{err}</p>}
        <Button type="submit" className="h-11 w-full text-[15px]" disabled={busy || enabled === null} data-testid="signup-submit">{busy ? <><Loader2 className="animate-spin" />가입 중…</> : <>가입하고 확인 메일 받기<ArrowRight /></>}</Button>
        <p className="text-center text-sm text-ink-2">이미 계정이 있나요? <Link href="/login" className="font-semibold text-brand-700 underline">로그인</Link></p>
        <ul className="space-y-1 text-xs text-ink-3"><li className="flex gap-1.5"><CheckCircle2 className="size-3.5" />14일 체험: 10명 · 저장 20GB · AI 300회 · 카드 없음</li><li className="flex gap-1.5"><CheckCircle2 className="size-3.5" />이후 월 2,900원부터 (개인 2,900원 · 팀 1인 3,900원 · 비즈니스 1인 6,900원)</li><li className="flex gap-1.5"><CheckCircle2 className="size-3.5" />고르지 않으면 읽기 전용 — 데이터는 지우지 않고 내보낼 수 있어요</li></ul>
      </form>
    </AuthCard>
  );
}
