import type { Metadata } from 'next';
import { BizFooter } from '@/components/BizFooter';
import { SITE } from '@/lib/landingPages';

// #627(SEO_AUDIT 2-1): 가입 화면 고유 제목·설명 + 링크 공유 미리보기(OG). 색인은 하지 않는다(루트 noindex 그대로)
const TITLE = '워크인 가입 — 14일 무료 체험 시작';
const DESC = '이메일만으로 회사 공간을 만들고 14일 동안 업무·일정·메신저·전자결재와 영업·마케팅 기능을 모두 써 봅니다.';
export const metadata: Metadata = {
  title: TITLE, description: DESC, metadataBase: new URL(SITE), alternates: { canonical: '/signup' },
  openGraph: { type: 'website', url: `${SITE}/signup`, siteName: '워크인', title: TITLE, description: DESC, locale: 'ko_KR', images: [{ url: '/landing/og.png', width: 1200, height: 630, alt: '워크인 — 업무·영업·마케팅 한 화면' }] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: ['/landing/og.png'] },
};

/** 공개 화면 하단 사업자 정보(서버에서 운영 설정 값으로) */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}<BizFooter /></>;
}
