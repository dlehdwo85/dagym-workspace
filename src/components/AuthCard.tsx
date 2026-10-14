'use client';
import { useState } from 'react';
import { CalendarDays, CheckCircle2, Eye, EyeOff, ShieldCheck, TriangleAlert, Users } from 'lucide-react';
import { inputCls } from './ui';


/** 로그인·초대·재설정 공통 틀: 왼쪽 회사 소개, 오른쪽 입력 */
export function AuthCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-canvas">
      <section className="relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden bg-brand-800 p-10 text-white lg:flex" aria-hidden>
        <div className="absolute -right-24 -top-24 size-80 rounded-full bg-accent-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-orange-500/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <img src="/icon.svg" alt="" className="size-10" />
          <div><div className="text-lg font-bold">워크인</div><div className="text-xs text-slate-400">업무 · 일정 · 알림을 한 곳에</div></div>
        </div>
        <div className="relative">
          <h2 className="text-[28px] font-bold leading-snug tracking-tight">말로 등록하고,<br />정확한 시간에 알림 받기.</h2>
          <ul className="mt-8 space-y-4 text-sm text-slate-300">
            <li className="flex items-center gap-3"><CheckCircle2 className="size-5 text-emerald-400" />업무 배정 · 완료 확인 · 결재까지 한 흐름으로</li>
            <li className="flex items-center gap-3"><CalendarDays className="size-5 text-sky-400" />회사·부서·현장 일정과 마감일을 한 캘린더에</li>
            <li className="flex items-center gap-3"><Users className="size-5 text-orange-300" />혼자서도, 팀으로도 — 무료로 시작</li>
          </ul>
        </div>
        <div className="relative text-xs text-slate-400">개인 무료 · 팀 5명까지 무료</div>
      </section>
      <section className="flex flex-1 flex-col items-center justify-center p-5">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <img src="/icon.svg" alt="" className="size-9" />
            <div><div className="font-bold text-brand-700">워크인</div><div className="text-xs text-ink-2">업무 · 일정 · 알림을 한 곳에</div></div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {sub && <p className="mt-1.5 text-sm text-ink-2">{sub}</p>}
          <div className="mt-7">{children}</div>
          <p className="mt-10 flex items-center justify-center gap-1.5 text-center text-xs text-ink-3">
            <ShieldCheck className="size-3.5" />회사 계정 전용 · <a href="/privacy" className="underline hover:text-ink-2">개인정보처리방침</a>
          </p>
        </div>
      </section>
    </div>
  );
}

/** 비밀번호 입력: 보기 토글 + Caps Lock 경고 */
export function PasswordInput({ value, onChange, autoComplete = 'current-password', minLength, id }: { value: string; onChange: (v: string) => void; autoComplete?: string; minLength?: number; id?: string }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const capsCheck = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false);
  return (
    <div>
      <div className="relative">
        <input id={id} className={inputCls + ' h-11 pr-11'} type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} minLength={minLength}
          onChange={(e) => onChange(e.target.value)} onKeyUp={capsCheck} onKeyDown={capsCheck} onBlur={() => setCaps(false)} required />
        <button type="button" onClick={() => setShow(!show)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-3 hover:text-ink-2"
          aria-label={show ? '입력 내용 숨기기' : '입력 내용 보기'} aria-pressed={show}>
          {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
        </button>
      </div>
      {caps && <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-amber-700"><TriangleAlert className="size-3.5" />Caps Lock 이 켜져 있습니다</p>}
    </div>
  );
}
