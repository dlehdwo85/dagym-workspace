import type { Metadata, Viewport } from 'next';
// U-0d Pretendard 를 실제로 내려받도록 포함 (한글 범위별로 필요한 조각만 받는 dynamic subset, 외부 CDN 없음)
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './globals.css';

export const metadata: Metadata = {
  title: '워크인 — 업무·일정 관리',
  description: '워크인 — 회사 업무·일정·메신저를 한곳에서',
  manifest: '/manifest.webmanifest',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: '워크인', statusBarStyle: 'default' },
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/favicon-48.png', sizes: '48x48', type: 'image/png' }], apple: '/apple-touch-icon.png' }, // V13 7번 시안 B
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0F766E' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
