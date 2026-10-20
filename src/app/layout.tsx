import type { Metadata, Viewport } from 'next';
// U-0d Pretendard 를 실제로 내려받도록 포함 (한글 범위별로 필요한 조각만 받는 dynamic subset, 외부 CDN 없음)
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './globals.css';

export const metadata: Metadata = {
  title: '워크인 — 업무·일정 관리',
  description: '워크인 — 회사 업무·일정·메신저를 한곳에서',
  manifest: '/manifest.webmanifest',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: '워크인', statusBarStyle: 'default', startupImage: '/splash-2732.png' },
  // 대표 10/20 로고 17차-3D S3 확정(자산 docs/handoff/brand/workin-s3): 아이콘·파비콘·애플 터치·스플래시 전부 S3
  icons: { icon: [{ url: '/favicon.ico', sizes: '48x48 32x32 16x16' }, { url: '/icon.svg', type: 'image/svg+xml' }, { url: '/favicon-48.png', sizes: '48x48', type: 'image/png' }, { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' }], apple: '/apple-touch-icon.png' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0F766E' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
