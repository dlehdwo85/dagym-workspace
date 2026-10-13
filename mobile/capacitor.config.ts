import type { CapacitorConfig } from '@capacitor/cli';

// 앱은 운영 사이트(같은 계정·데이터)를 불러오는 얇은 껍데기 + 네이티브 푸시·딥링크·카메라 첨부.
// APP_URL 을 바꿔 검수(staging) 앱을 따로 만들 수 있다.
const appUrl = process.env.APP_URL ?? 'https://dagym-workspace.vercel.app';

const config: CapacitorConfig = {
  appId: 'kr.co.dagym.workos',
  appName: '워크인',
  webDir: 'www',
  server: {
    url: appUrl,
    cleartext: appUrl.startsWith('http://'),
    allowNavigation: [new URL(appUrl).host],
    errorPath: 'offline.html',
  },
  android: { allowMixedContent: false },
  ios: { contentInset: 'automatic', limitsNavigationsToAppBoundDomains: false },
  plugins: {
    FirebaseMessaging: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};
export default config;
