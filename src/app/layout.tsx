import type { Metadata, Viewport } from 'next';
// U-0d Pretendard 를 실제로 내려받도록 포함 (한글 범위별로 필요한 조각만 받는 dynamic subset, 외부 CDN 없음)
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './globals.css';

export const metadata: Metadata = {
  title: '업무·일정 관리 | 다짐 · 하이링크 · BODY LAB',
  description: '사내 업무·일정 관리 서비스',
  manifest: '/manifest.webmanifest',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: '업무일정', statusBarStyle: 'default' },
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#1f3a5f' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
