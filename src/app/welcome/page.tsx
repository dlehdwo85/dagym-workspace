import Link from 'next/link';
import { ArrowRight, BellRing, CalendarDays, Check, Mic, Sparkles, Users } from 'lucide-react';

export const metadata = { title: '워크인 — 업무·일정·알림을 한 곳에', description: '말로 등록하고 정확한 시간에 알림. 개인 무료, 팀 5명까지 무료.' };

const SHOTS = [
  { src: '/landing/home.png', t: '오늘 할 일과 일정이 한 화면에', d: '마감 위험·오늘 일정·팀 현황을 첫 화면에서' },
  { src: '/landing/tasks.png', t: '담당자별로 한눈에', d: '한 줄로 추가하고, 담당·마감·검토까지 한 흐름' },
  { src: '/landing/calendar.png', t: '업무와 일정을 한 캘린더에', d: '마감 업무가 시간 블록으로, 회의 준비 업무는 자동으로' },
];
const PLANS = [
  { n: '개인', p: '무료', s: '혼자 쓰는 업무·일정', f: ['업무·일정·알림·캘린더 전부', '저장공간 1GB', 'AI 비서 월 20회'] },
  { n: '팀 무료', p: '무료', s: '5명까지', f: ['팀 업무·메신저', '회사 저장 2GB', 'AI 비서 월 30회'], hi: true },
  { n: '팀', p: '1인 월 3,900원', s: '인원 무제한 · 베타 기간 사전 신청', f: ['1인 저장 3GB', '1인 AI 월 50회', '결제 오픈 전까지 과금 없음'] },
];

export default function Welcome() {
  return (
    <div className="min-h-screen bg-white text-ink">
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
        <img src="/icon.svg" alt="" className="size-8" /><span className="text-lg font-bold">워크인</span>
        <nav className="ml-auto flex items-center gap-2 text-sm">
          <a href="#pricing" className="hidden px-2 text-ink-2 hover:text-ink sm:inline">요금</a>
          <Link href="/login" className="rounded-input px-3 py-2 font-semibold text-ink-2 hover:bg-slate-100" data-testid="landing-login">로그인</Link>
          <Link href="/signup" className="rounded-input bg-brand-600 px-3 py-2 font-semibold text-white hover:bg-brand-700">무료로 시작</Link>
        </nav>
      </header>
      <section className="mx-auto max-w-6xl px-4 pb-10 pt-8 text-center sm:pt-16">
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl" data-testid="landing-title">업무·일정·알림을 한 곳에</h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-ink-2 sm:text-lg">말로 등록하고, 정확한 시간에 알림 받으세요.<br className="hidden sm:inline" /> 혼자서도, 팀으로도 바로 시작할 수 있습니다.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <Link href="/signup" className="inline-flex items-center gap-1.5 rounded-input bg-brand-600 px-5 py-3 text-base font-semibold text-white shadow-card hover:bg-brand-700" data-testid="landing-start">무료로 시작<ArrowRight className="size-4" /></Link>
          <Link href="/login" className="rounded-input border border-line px-5 py-3 text-base font-semibold hover:bg-slate-50">로그인</Link>
        </div>
        <p className="mt-3 text-xs text-ink-3">카드 등록 없음 · 웹·Android·iOS</p>
        <ul className="mx-auto mt-10 grid max-w-4xl gap-3 text-left sm:grid-cols-4">
          {[[Mic, '말로 등록', '“내일 3시 거래처 미팅” 한마디면 끝'], [BellRing, '정확한 알림', '휴대폰 앱·웹 푸시로 제때'], [CalendarDays, '업무 = 일정', '마감 업무가 캘린더에 그대로'], [Sparkles, 'AI 비서', '정리·요약·체크리스트를 대신']].map(([I, t, d]: any) => (
            <li key={t} className="rounded-card border border-line p-3"><I className="size-5 text-brand-700" /><div className="mt-1.5 font-semibold">{t}</div><div className="text-sm text-ink-2">{d}</div></li>
          ))}
        </ul>
      </section>
      <section className="bg-slate-50 py-12">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 md:grid-cols-3">
          {SHOTS.map((s) => (
            <figure key={s.src} className="overflow-hidden rounded-card border border-line bg-white shadow-card">
              <img src={s.src} alt={s.t} className="aspect-[4/3] w-full object-cover object-top" loading="lazy" />
              <figcaption className="p-3"><div className="font-semibold">{s.t}</div><div className="text-sm text-ink-2">{s.d}</div></figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-center text-2xl font-bold">요금</h2>
        <p className="mt-1 text-center text-sm text-ink-2">공개 베타 기간에는 결제 없이 쓸 수 있습니다. 팀 요금제는 사전 신청을 받습니다.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3" data-testid="pricing">
          {PLANS.map((p) => (
            <div key={p.n} className={'rounded-card border p-5 ' + (p.hi ? 'border-brand-600 ring-1 ring-brand-600' : 'border-line')}>
              <div className="flex items-center gap-2 font-semibold">{p.n === '개인' ? null : <Users className="size-4" />}{p.n}</div>
              <div className="mt-2 text-2xl font-bold">{p.p}</div><div className="text-sm text-ink-3">{p.s}</div>
              <ul className="mt-4 space-y-1.5 text-sm">{p.f.map((x) => <li key={x} className="flex gap-1.5"><Check className="mt-0.5 size-4 text-emerald-600" />{x}</li>)}</ul>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center"><Link href="/signup" className="inline-flex items-center gap-1.5 rounded-input bg-brand-600 px-5 py-3 font-semibold text-white hover:bg-brand-700">무료로 시작<ArrowRight className="size-4" /></Link></div>
      </section>
      <footer className="border-t border-line py-6 text-center text-xs text-ink-3">
        <Link href="/terms" className="underline">이용약관</Link> · <Link href="/privacy" className="underline">개인정보 처리방침</Link> · <Link href="/ai-notice" className="underline">AI 이용 안내</Link>
      </footer>
    </div>
  );
}
