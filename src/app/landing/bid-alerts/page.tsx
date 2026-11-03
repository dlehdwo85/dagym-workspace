import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { BidAlertForm } from '@/components/BidAlertForm';
import { BizFooter } from '@/components/BizFooter';
import { LandingEvents } from '@/components/LandingEvents';
import { LandingHeader } from '@/components/LandingHeader';
import { BID_ALERT_COPY, bidAlertOptions } from '@/lib/bidAlerts';
import { conversionTags } from '@/lib/conversionTags';
import { SITE } from '@/lib/landingPages';

/**
 * #949(대표 승인 11/04 03:4x '광고로만 유입'): 광고 유입용 무료 미끼 — 입찰 공고 아침 메일 무료 구독 소개 페이지.
 * 이메일·관심 지역·관심 분야만 받고 [무료로 받기]. 회사 가입·카드 없음. 문구는 kit-ko-copy(과장·확인 안 된 숫자 없음, 요금은 14일 무료 체험 사실만).
 * 앱 안에서는 이 주소가 로그인으로 가므로(#942 middleware /landing/*) 앱에는 보이지 않는다.
 */
export const dynamic = 'force-dynamic';
const C = BID_ALERT_COPY;
const TITLE = '입찰 공고 아침 메일 무료 구독 — 관심 지역·분야 새 공고를 매일 아침 한 통으로 | 워크인';
const DESC = '나라장터·아파트 관리 입찰·협력사 모집 공고 가운데 관심 지역·분야에 맞는 새 공고를 매일 아침 메일로. 이메일만 적으면 되고 회사 가입·카드가 없습니다.';
export const metadata: Metadata = {
  title: TITLE, description: DESC, metadataBase: new URL(SITE), alternates: { canonical: '/landing/bid-alerts' }, robots: { index: true, follow: true },
  openGraph: { type: 'website', url: `${SITE}/landing/bid-alerts`, siteName: '워크인', title: TITLE, description: DESC, locale: 'ko_KR', images: [{ url: '/landing/og.png', width: 1200, height: 630, alt: '워크인 — 업무·영업·마케팅을 한 화면에서' }] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: ['/landing/og.png'] },
};
const SECTIONS = [
  { title: '어떤 공고가 오나요', body: '나라장터 입찰, 아파트(K-apt) 관리 입찰, 협력사 모집 공고를 정해진 시간마다 모읍니다. 그중 신청할 때 고른 지역·분야에 맞는 새 공고만 고릅니다.',
    points: ['관심 지역(시·도)·관심 분야 기준', '하루 최대 10건 · 새 공고가 없는 날은 보내지 않음', '취소된 공고·마감 지난 공고는 뺌'] },
  { title: '메일에 담기는 것', body: '공고마다 제목, 발주처, 지역, 마감 일시(남은 날), 원문 링크를 한 줄씩 적습니다. 원문 링크를 누르면 공고 사이트로 바로 갑니다.',
    points: ['제목 · 발주처 · 지역', '마감 일시와 D-day', '원문 바로 가기'] },
  { title: '팀과 함께 관리하려면', body: '워크인 영업 공간에서는 같은 공고를 담당자·마감일·첨부가 든 업무로 넘기고, 참가자격·현장설명회까지 함께 봅니다. 14일 무료 체험으로 시작할 수 있습니다.',
    points: ['공고 → 담당·마감·첨부가 든 업무', '참가자격 절 읽기 · 현장설명회 일정', '14일 무료 체험(웹 가입)'] },
];
const FAQ: [string, string][] = [
  ['비용이 드나요?', '아침 메일은 무료입니다. 회사 가입이나 카드 등록 없이 이메일만으로 받습니다.'],
  ['언제 오나요?', '매일 아침 7시쯤, 새 공고가 있는 날에만 한 통이 갑니다. 새 공고가 없으면 그날은 보내지 않습니다.'],
  ['그만 받으려면?', '메일 맨 아래 [수신 거부]를 한 번 누르면 바로 멈추고, 이메일 주소는 30일 안에 지웁니다.'],
  ['내 정보는 어디에 쓰나요?', '이메일 주소는 이 메일을 보내는 데만 씁니다. 다른 목적으로 쓰거나 다른 곳에 넘기지 않습니다.'],
];
export default async function BidAlertsLanding() {
  const tags = await conversionTags().catch(() => null);
  const opt = bidAlertOptions();
  const url = `${SITE}/landing/bid-alerts`;
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', name: TITLE, url, description: DESC, inLanguage: 'ko', isPartOf: { '@type': 'WebSite', name: '워크인', url: SITE } },
    { '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] };
  return (
    <div className="min-h-screen break-keep bg-white text-ink [overflow-wrap:anywhere]" data-testid="landing-page">
      <LandingEvents ga4={tags?.ga4} ads={tags?.googleAds} naverWa={tags?.naverWa} page="bid-alerts" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <LandingHeader />
      <section className="bg-slate-50 py-12 sm:py-16">
        <div className="mx-auto grid max-w-6xl items-start gap-8 px-4 md:grid-cols-2">
          <div className="text-center md:text-left">
            <p className="text-sm font-semibold text-brand-700">{C.kicker}</p>
            <h1 className="mt-2 text-balance text-3xl font-bold leading-tight tracking-tight sm:text-4xl" data-testid="landing-h1">{C.h1}</h1>
            <p className="mt-4 text-base text-ink-2 sm:text-lg">{C.intro}</p>
            <ul className="mt-5 space-y-1.5 text-sm text-ink-2">
              {['이메일만 적으면 끝 — 회사 가입·카드 없음', '관심 지역·분야에 맞는 새 공고만, 하루 최대 10건', '메일 맨 아래 한 번 누르면 수신 거부'].map((x) => <li key={x} className="flex gap-1.5 md:justify-start justify-center"><Check className="mt-0.5 size-4 shrink-0 text-brand-700" />{x}</li>)}
            </ul>
          </div>
          <BidAlertForm regions={opt.regions} fields={opt.fields} consent={C.consent} button={C.button} done={C.done} />
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-4 md:grid-cols-3" data-testid="landing-sections">
          {SECTIONS.map((s) => (
            <article key={s.title} className="rounded-card border border-line bg-white p-5 shadow-card">
              <h2 className="text-lg font-bold">{s.title}</h2>
              <p className="mt-2 text-sm text-ink-2">{s.body}</p>
              <ul className="mt-3 space-y-1.5 text-sm">{s.points.map((x) => <li key={x} className="flex gap-1.5"><Check className="mt-0.5 size-4 shrink-0 text-brand-700" />{x}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>
      <section className="bg-slate-50 py-12">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-center text-2xl font-bold">자주 묻는 질문</h2>
          <dl className="mt-6 space-y-3" data-testid="landing-faq">{FAQ.map(([q, a]) => (
            <div key={q} className="rounded-card border border-line bg-white p-4"><dt className="font-semibold">{q}</dt><dd className="mt-1.5 text-sm text-ink-2">{a}</dd></div>
          ))}</dl>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-12 text-center">
        <h2 className="text-2xl font-bold">공고를 팀 업무로 바로 넘기려면</h2>
        <p className="mt-1 text-sm text-ink-2">워크인 영업 공간은 공고를 담당·마감·첨부가 든 업무로 넘기고, 참가자격과 현장설명회까지 함께 봅니다. 14일 무료 체험, 웹에서 가입합니다.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/signup?utm_source=bid_alert&utm_medium=landing&utm_campaign=bid-alerts" className="inline-flex min-h-[48px] items-center gap-1.5 rounded-input bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700" data-track="start-bid-alerts" data-testid="landing-page-start">14일 무료 체험<ArrowRight className="size-4" /></Link>
          <Link href="/landing/bid-collection" className="inline-flex min-h-[48px] items-center rounded-input border border-line px-6 py-3 font-semibold text-ink-2 hover:bg-slate-100">입찰 정보 자동 수집 소개</Link>
        </div>
      </section>
      <BizFooter />
    </div>
  );
}
