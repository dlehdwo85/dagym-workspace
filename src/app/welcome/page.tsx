import Link from 'next/link';
import type { Metadata } from 'next';
import { LandingEvents } from '@/components/LandingEvents';
import { BizFooter } from '@/components/BizFooter';
import { ArrowRight, BellRing, Briefcase, Check, Download, Mail, Megaphone, Mic, Phone, Sparkles, TrendingUp, Users } from 'lucide-react';

/**
 * 워크인 소개 사이트(대표 10/20 16:45): work-in.dev 루트(로그인 전) — 로그인하면 홈(middleware). 앱은 로그인 화면.
 * H1 "업무도, 영업도, 마케팅도 한 화면에서" · 5명 무료 · [무료로 시작]/[앱 다운로드] · 세 공간 소개 · AI 비서 · 도입 3단계 · 요금(5명 무료만) · 문의 · 푸터(개인정보·계정 삭제·운영사) · JSON-LD·OG · UTM·sign_up/CompleteRegistration/tel 이벤트 · 390px.
 */
const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://work-in.dev';
const PLAY = 'https://play.google.com/store/apps/details?id=kr.co.dagym.workos';
const APPSTORE = process.env.NEXT_PUBLIC_APPSTORE_URL || '';
const CONTACT_MAIL = 'dagym-in@naver.com';
const TITLE = '워크인 — 업무도, 영업도, 마케팅도 한 화면에서';
const DESC = '업무·일정·메신저에 영업(리드·입찰·제안)과 마케팅(시안 승인·자동 제작·광고)까지 한 화면에서. 5명까지 무료, 카드 등록 없음. 웹·Android·iOS.';
export const metadata: Metadata = {
  title: TITLE, description: DESC, metadataBase: new URL(SITE), alternates: { canonical: '/' }, robots: { index: true, follow: true },
  openGraph: { type: 'website', url: SITE, siteName: '워크인', title: TITLE, description: DESC, locale: 'ko_KR', images: [{ url: '/landing/og.png', width: 1200, height: 630, alt: '워크인 — 업무·영업·마케팅 한 화면' }] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: ['/landing/og.png'] },
};

const SPACES = [
  { key: 'work', name: '업무', color: '#0F766E', icon: Briefcase, img: '/landing/tasks.png', t: '업무·일정·메신저·결재', d: '한 줄로 업무를 추가하고 담당·마감·검토까지 한 흐름. 마감 업무가 캘린더에 그대로, 알림은 정확한 시간에.',
    f: ['담당자별 업무 목록 · 체크리스트 · 댓글', '캘린더 = 업무 + 일정(주·월, 휴대폰 스와이프)', '메신저 · 공지 · 자료실 · 휴가·지출 결재'] },
  { key: 'sales', name: '영업', color: '#2563EB', icon: TrendingUp, img: '/landing/sales.png', t: '리드·입찰·제안·계약', d: '공공 입찰·신규 단지·시설 DB를 자동으로 모으고, 상태를 바꾸면 담당자 업무가 저절로 생깁니다. 오늘 연락할 곳이 홈에 한눈에.',
    f: ['오늘 할 일 7묶음 · 입찰 마감 D-1 자동 업무', '리드 13칸 · 상담 기록 · 타임라인 · CSV', '제안·계약·ROI · 계약만료·재입찰 역산'] },
  { key: 'marketing', name: '마케팅', color: '#7C3AED', icon: Megaphone, img: '/landing/marketing.png', t: '시안 승인·자동 제작·광고', d: '피드·블로그·릴스 원고를 AI가 묶음으로 만들고, 대표는 승인함에서 [승인]만. 사람 승인 없이 밖으로 나가는 것은 없습니다.',
    f: ['승인함 — 썸네일·게시 화면 미리보기·마감', '브랜드별 게시 묶음(주말 건너뛰기) · 콘텐츠 캘린더', '네이버·구글 광고 성과 · 월간 보고'] },
];
const STEPS = [['가입 1분', '이메일만으로 회사 공간을 만듭니다. 카드 등록 없음.'], ['직원 초대', '링크 하나로 초대. 부서·팀과 권한은 소속에서 자동.'], ['공간 켜기', '영업·마케팅은 필요할 때 관리자가 켭니다. 안 쓰는 회사는 업무만.']];
const AI_DEMO = [['내일 3시 거래처 미팅 잡아 줘', '내일 15:00 “거래처 미팅” 일정을 만들고 30분 전 알림을 걸었습니다. 준비 업무도 하나 만들까요?'], ['이번 주 연락할 리드 알려 줘', '다음 연락일이 이번 주인 리드 4곳입니다 — 판교 레이크(수), 광교 호수마을(목)… 첫 연락 업무를 담당자에게 만들었습니다.'], ['10월 블로그 원고 초안 써 줘', '브랜드 키트의 말투로 원고 2편을 만들어 승인함에 올렸습니다. 표지·본문 사진을 붙이면 승인 요청됩니다.']];

export default function Welcome() {
  const ld = {
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'Organization', name: '워크인', url: SITE, logo: `${SITE}/icon-512.png`, email: CONTACT_MAIL },
      { '@type': 'SoftwareApplication', name: '워크인', applicationCategory: 'BusinessApplication', operatingSystem: 'Web, Android, iOS', url: SITE, description: DESC,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW', description: '5명까지 무료' }, featureList: '업무·일정·메신저·결재, 영업(리드·입찰·제안·계약), 마케팅(시안 승인·자동 제작·광고), AI 비서' },
    ],
  };
  return (
    <div className="min-h-screen bg-white text-ink" data-testid="landing">
      <LandingEvents />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
        <img src="/icon.svg" alt="" className="size-8" /><span className="text-lg font-bold">워크인</span>
        <nav className="ml-auto flex items-center gap-1.5 text-sm">
          <a href="#spaces" className="hidden px-2 text-ink-2 hover:text-ink sm:inline">기능</a>
          <a href="#pricing" className="hidden px-2 text-ink-2 hover:text-ink sm:inline">요금</a>
          <a href="#contact" className="hidden px-2 text-ink-2 hover:text-ink sm:inline">문의</a>
          <Link href="/login" className="rounded-input px-3 py-2 font-semibold text-ink-2 hover:bg-slate-100" data-testid="landing-login">로그인</Link>
          <Link href="/signup" className="rounded-input bg-brand-600 px-3 py-2 font-semibold text-white hover:bg-brand-700" data-track="start-top">무료로 시작</Link>
        </nav>
      </header>
      <section className="mx-auto max-w-6xl px-4 pb-8 pt-6 text-center sm:pt-14">
        <p className="text-sm font-semibold text-brand-700">5명까지 무료 · 카드 등록 없음</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-5xl" data-testid="landing-title">업무도, 영업도, 마케팅도<br className="sm:hidden" /> 한 화면에서</h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-ink-2 sm:text-lg">직원은 업무와 일정을, 영업팀은 리드와 입찰을, 마케팅은 시안 승인과 광고를 — 회사마다 켜고 끄는 세 공간을 한 계정으로. AI 비서가 등록·요약·초안을 돕습니다.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <Link href="/signup" className="inline-flex min-h-[48px] items-center gap-1.5 rounded-input bg-brand-600 px-6 py-3 text-base font-semibold text-white shadow-card hover:bg-brand-700" data-testid="landing-start" data-track="start">무료로 시작<ArrowRight className="size-4" /></Link>
          <a href="#app" className="inline-flex min-h-[48px] items-center gap-1.5 rounded-input border border-line px-6 py-3 text-base font-semibold hover:bg-slate-50" data-testid="landing-app" data-track="app">앱 다운로드<Download className="size-4" /></a>
        </div>
        <p className="mt-3 text-xs text-ink-3">웹 · Android · iOS · 시간대 Asia/Seoul · 한국어</p>
        <figure className="mx-auto mt-10 max-w-5xl overflow-hidden rounded-card border border-line shadow-card"><img src="/landing/home.png" alt="워크인 홈 — 이번 주 일정·업무·영업·마케팅 요약" className="w-full" width={1280} height={960} /></figure>
        <ul className="mx-auto mt-8 grid max-w-4xl gap-3 text-left sm:grid-cols-4">
          {([[Mic, '말로 등록', '“내일 3시 미팅” 한마디면 끝'], [BellRing, '정확한 알림', '앱·웹 푸시, 알람처럼 울리기'], [Users, '권한·부서', '부서 › 팀, 격리 팀, 결재선'], [Sparkles, 'AI 비서', '요약·초안·리드 제안']] as [typeof Mic, string, string][]).map(([I, t, d]) => (
            <li key={t} className="rounded-card border border-line p-3"><I className="size-5 text-brand-700" /><div className="mt-1.5 font-semibold">{t}</div><div className="text-sm text-ink-2">{d}</div></li>))}
        </ul>
      </section>
      {/* 세 공간 */}
      <section id="spaces" className="bg-slate-50 py-12">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-2xl font-bold">세 공간, 한 계정</h2>
          <p className="mt-1 text-center text-sm text-ink-2">업무는 기본. 영업·마케팅은 관리자가 켜면 사이드바와 휴대폰 탭이 그 공간 메뉴로 바뀝니다.</p>
          <div className="mt-8 space-y-8" data-testid="landing-spaces">{SPACES.map((s, i) => (
            <article key={s.key} className={'grid items-center gap-5 md:grid-cols-2 ' + (i % 2 ? 'md:[&>figure]:order-2' : '')} data-testid={`landing-space-${s.key}`}>
              <figure className="overflow-hidden rounded-card border border-line bg-white shadow-card"><img src={s.img} alt={`${s.name} 공간 화면`} className="aspect-[4/3] w-full object-cover object-left-top" loading="lazy" width={1280} height={960} /></figure>
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: s.color }}><s.icon className="size-3.5" />{s.name}</span>
                <h3 className="mt-2 text-xl font-bold">{s.t}</h3><p className="mt-1 text-sm text-ink-2">{s.d}</p>
                <ul className="mt-3 space-y-1.5 text-sm">{s.f.map((x) => <li key={x} className="flex gap-1.5"><Check className="mt-0.5 size-4 shrink-0" style={{ color: s.color }} />{x}</li>)}</ul>
              </div>
            </article>))}</div>
        </div>
      </section>
      {/* AI 비서 */}
      <section className="mx-auto max-w-6xl px-4 py-12" data-testid="landing-ai">
        <div className="grid items-center gap-6 md:grid-cols-2">
          <div><span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800"><Sparkles className="size-3.5" />AI 비서</span>
            <h2 className="mt-2 text-2xl font-bold">말하면 업무·일정이 되고, 물으면 회사 상황을 답합니다</h2>
            <p className="mt-2 text-sm text-ink-2">업무·일정·리드·시안을 읽고 만드는 회사 전용 비서. 문자·견적서·메일은 시안까지만 — 보내는 것은 사람이 누릅니다. 회사 자료는 AI 학습에 쓰이지 않고, 사용량은 회사·사람별로 한도를 둡니다.</p>
            <ul className="mt-3 space-y-1.5 text-sm">{['업무 등록·요약·체크리스트 · 회의 메모 → 후속 업무', '리드 다음 연락 제안 · 입찰 요약 · 제안서 초안', '마케팅 원고·시안 묶음 제작 → 승인함', '밤사이 비서(승인된 범위만) → 아침 브리핑'].map((x) => <li key={x} className="flex gap-1.5"><Check className="mt-0.5 size-4 shrink-0 text-brand-700" />{x}</li>)}</ul></div>
          <div className="space-y-3 rounded-card border border-line bg-slate-50 p-4">{AI_DEMO.map(([q, a]) => (
            <div key={q} className="space-y-1.5"><p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-3 py-2 text-sm text-white">{q}</p><p className="w-fit max-w-[90%] rounded-2xl rounded-bl-sm border border-line bg-white px-3 py-2 text-sm">{a}</p></div>))}</div>
        </div>
      </section>
      {/* 도입 3단계 */}
      <section className="bg-slate-50 py-12">
        <div className="mx-auto max-w-6xl px-4"><h2 className="text-center text-2xl font-bold">도입 3단계</h2>
          <ol className="mt-6 grid gap-3 sm:grid-cols-3" data-testid="landing-steps">{STEPS.map(([t, d], i) => <li key={t} className="rounded-card border border-line bg-white p-4"><span className="flex size-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span><div className="mt-2 font-semibold">{t}</div><div className="text-sm text-ink-2">{d}</div></li>)}</ol></div>
      </section>
      {/* 요금: 5명 무료만 */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-12 text-center">
        <h2 className="text-2xl font-bold">요금</h2>
        <div className="mx-auto mt-6 max-w-md rounded-card border border-brand-600 p-6 ring-1 ring-brand-600" data-testid="pricing">
          <div className="text-sm font-semibold text-brand-700">무료</div><div className="mt-1 text-4xl font-bold">0원</div><div className="text-sm text-ink-3">5명까지 · 기간 제한 없음 · 카드 등록 없음</div>
          <ul className="mt-4 space-y-1.5 text-left text-sm">{['업무·일정·캘린더·메신저·결재·자료실 전부', '영업·마케팅 공간 켜기 가능', 'AI 비서(회사 월 한도) · 앱 알림'].map((x) => <li key={x} className="flex gap-1.5"><Check className="mt-0.5 size-4 text-green-600" />{x}</li>)}</ul>
          <Link href="/signup" className="mt-5 inline-flex items-center gap-1.5 rounded-input bg-brand-600 px-5 py-3 font-semibold text-white hover:bg-brand-700" data-track="start-pricing">무료로 시작<ArrowRight className="size-4" /></Link>
        </div>
        <p className="mt-3 text-xs text-ink-3">6명 이상·더 큰 저장 공간·AI 한도가 필요하면 아래로 문의해 주세요.</p>
      </section>
      {/* 앱 다운로드 */}
      <section id="app" className="bg-slate-50 py-12">
        <div className="mx-auto max-w-6xl px-4 text-center"><h2 className="text-2xl font-bold">앱으로도</h2><p className="mt-1 text-sm text-ink-2">푸시 알림·말로 등록·바탕화면 위젯은 앱에서. 계정은 웹과 같습니다.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2" data-testid="landing-stores">
            <a href={PLAY} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[48px] items-center gap-2 rounded-input bg-ink px-5 py-3 font-semibold text-white" data-track="play">Google Play</a>
            {APPSTORE ? <a href={APPSTORE} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[48px] items-center gap-2 rounded-input bg-ink px-5 py-3 font-semibold text-white" data-track="appstore">App Store</a>
              : <span className="inline-flex min-h-[48px] items-center rounded-input border border-line px-5 py-3 text-sm text-ink-2">App Store 심사 중</span>}
          </div></div>
      </section>
      {/* 문의 */}
      <section id="contact" className="mx-auto max-w-6xl px-4 py-12 text-center" data-testid="landing-contact">
        <h2 className="text-2xl font-bold">문의</h2><p className="mt-1 text-sm text-ink-2">도입 상담·6명 이상 요금·기능 요청은 메일로 보내 주세요. 영업일 하루 안에 답합니다.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <a href={`mailto:${CONTACT_MAIL}?subject=${encodeURIComponent('워크인 문의')}`} className="inline-flex min-h-[48px] items-center gap-2 rounded-input bg-brand-600 px-5 py-3 font-semibold text-white" data-track="mail"><Mail className="size-4" />{CONTACT_MAIL}</a>
          {process.env.COMPANY_PHONE && <a href={`tel:${process.env.COMPANY_PHONE.replace(/[^0-9+]/g, '')}`} className="inline-flex min-h-[48px] items-center gap-2 rounded-input border border-line px-5 py-3 font-semibold" data-track="tel" data-testid="landing-tel"><Phone className="size-4" />{process.env.COMPANY_PHONE}</a>}
        </div>
      </section>
      <BizFooter />
    </div>
  );
}
