/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // V14 21번: 화면이 자기 빌드 커밋을 알아야 새 배포를 감지할 수 있다
  env: { NEXT_PUBLIC_BUILD_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.BUILD_COMMIT ?? '' },
  serverExternalPackages: ['postgres', 'web-push', 'pdfjs-dist', 'sharp'], // sharp: 피드 일관성 이미지 통계(next 동봉)
  // V19 견적서 PDF 한글 글꼴(assets/fonts)을 서버 함수 번들에 포함
  // 로컬 10/21 #133: pdfjs 의 fake worker(pdf.worker.mjs)는 동적 import 라 서버리스 번들 추적에서 빠져 운영 PDF 추출이 전부 실패했음 → 명시 포함
  outputFileTracingIncludes: { '/api/**': ['./assets/fonts/**', './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'] }, // V14 32: PDF 글자 추출(Node legacy 빌드, 번들하지 않음)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/.well-known/(.*)', headers: [{ key: 'Content-Type', value: 'application/json' }] },
      { source: '/apple-app-site-association', headers: [{ key: 'Content-Type', value: 'application/json' }] }, // iOS 앱 링크(루트에도)
    ];
  },
};
export default nextConfig;
