/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // V14 21번: 화면이 자기 빌드 커밋을 알아야 새 배포를 감지할 수 있다
  env: { NEXT_PUBLIC_BUILD_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.BUILD_COMMIT ?? '' },
  serverExternalPackages: ['postgres', 'web-push', 'pdfjs-dist'], // V14 32: PDF 글자 추출(Node legacy 빌드, 번들하지 않음)
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
