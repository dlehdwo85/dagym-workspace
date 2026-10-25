import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Check } from 'lucide-react';
import { BizFooter } from '@/components/BizFooter';
import { LandingEvents } from '@/components/LandingEvents';
import { LandingHeader } from '@/components/LandingHeader';
import { conversionTags } from '@/lib/conversionTags';
import { LANDING_PAGES, SITE, landingBySlug } from '@/lib/landingPages';

/**
 * #627(대표 10/25 20:05 ①, SEO_AUDIT 2-1 '핵심 키워드 5개 모두 해당 페이지 없음'): 검색어별 소개 페이지 — 중소기업 업무관리 · 전자결재 · 협업툴.
 * 글·FAQ 는 src/lib/landingPages.ts(실제 기능만). 홈과 같은 머리·하단, 가입 버튼 이벤트(data-track)는 LandingEvents 가 받는다.
 */
export const dynamic = 'force-dynamic'; // 하단 사업자 정보가 요청 때 운영 설정을 읽음(BizFooter connection())

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = landingBySlug((await params).slug);
  if (!p) return { title: '워크인' };
  const url = `${SITE}/landing/${p.slug}`;
  return {
    title: p.title, description: p.description, metadataBase: new URL(SITE), alternates: { canonical: `/landing/${p.slug}` }, robots: { index: true, follow: true },
    openGraph: { type: 'website', url, siteName: '워크인', title: p.title, description: p.description, locale: 'ko_KR', images: [{ url: '/landing/og.png', width: 1200, height: 630, alt: '워크인 — 업무·영업·마케팅 한 화면' }] },
    twitter: { card: 'summary_large_image', title: p.title, description: p.description, images: ['/landing/og.png'] },
  };
}

export default async function LandingPage({ params }: Params) {
  const p = landingBySlug((await params).slug);
  if (!p) notFound();
  const tags = await conversionTags().catch(() => null);
  const url = `${SITE}/landing/${p.slug}`;
  const ld = {
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebPage', name: p.title, url, description: p.description, inLanguage: 'ko', isPartOf: { '@type': 'WebSite', name: '워크인', url: SITE } },
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: '워크인', item: `${SITE}/` }, { '@type': 'ListItem', position: 2, name: p.keyword, item: url }] },
      { '@type': 'FAQPage', mainEntity: p.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
  };
  const others = LANDING_PAGES.filter((x) => x.slug !== p.slug);
  return (
    <div className="min-h-screen bg-white text-ink" data-testid="landing-page">
      <LandingEvents ga4={tags?.ga4} ads={tags?.googleAds} naverWa={tags?.naverWa} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <LandingHeader />
      <section className="bg-slate-50 py-12 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <p className="text-sm font-semibold text-brand-700">{p.keyword} · 14일 무료 체험</p>
          <h1 className="mx-auto mt-2 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl" data-testid="landing-h1">{p.h1}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-ink-2 sm:text-lg">{p.intro}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <Link href="/signup" className="inline-flex min-h-[48px] items-center gap-1.5 rounded-input bg-brand-600 px-6 py-3 text-base font-semibold text-white shadow-card hover:bg-brand-700" data-track={`start-${p.slug}`} data-testid="landing-page-start">무료로 시작<ArrowRight className="size-4" /></Link>
            <Link href="/" className="inline-flex min-h-[48px] items-center gap-1.5 rounded-input border border-line bg-white px-6 py-3 text-base font-semibold text-ink-2 hover:bg-slate-100">워크인 소개 보기</Link>
          </div>
          <p className="mt-3 text-xs text-ink-3">웹 · 휴대폰 앱 · 한국어 · 가입 1분</p>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-4 pt-8">
        <figure className="mx-auto -mt-16 max-w-5xl overflow-hidden rounded-card border border-line bg-white shadow-card sm:-mt-20"><img src={p.image.src} alt={p.image.alt} className="w-full" width={1280} height={960} /></figure>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-4 md:grid-cols-3" data-testid="landing-sections">
          {p.sections.map((s) => (
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
          <dl className="mt-6 space-y-3" data-testid="landing-faq">{p.faq.map(([q, a]) => (
            <div key={q} className="rounded-card border border-line bg-white p-4"><dt className="font-semibold">{q}</dt><dd className="mt-1.5 text-sm text-ink-2">{a}</dd></div>
          ))}</dl>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-12 text-center">
        <h2 className="text-2xl font-bold">14일 동안 모든 기능을 써 보세요</h2>
        <p className="mt-1 text-sm text-ink-2">이메일만으로 회사 공간을 만들고, 직원은 링크 하나로 초대합니다. 체험 뒤 요금은 문의로 안내합니다.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/signup" className="inline-flex min-h-[48px] items-center gap-1.5 rounded-input bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700" data-track={`start-${p.slug}-bottom`}>무료로 시작<ArrowRight className="size-4" /></Link>
          <Link href="/#contact" className="inline-flex min-h-[48px] items-center rounded-input border border-line px-6 py-3 font-semibold text-ink-2 hover:bg-slate-100">문의하기</Link>
        </div>
        <nav aria-label="다른 기능 소개" className="mt-8 flex flex-wrap justify-center gap-2 text-sm" data-testid="landing-others">
          {others.map((o) => <Link key={o.slug} href={`/landing/${o.slug}`} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-ink-2 hover:border-brand-600 hover:text-brand-700">{o.keyword}<ArrowRight className="size-3.5" /></Link>)}
          <Link href="/" className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-ink-2 hover:border-brand-600 hover:text-brand-700">워크인 전체 소개<ArrowRight className="size-3.5" /></Link>
        </nav>
      </section>
      <BizFooter />
    </div>
  );
}
