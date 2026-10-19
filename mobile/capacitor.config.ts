import type { CapacitorConfig } from '@capacitor/cli';

// 앱은 운영 사이트(같은 계정·데이터)를 불러오는 얇은 껍데기 + 네이티브 푸시·딥링크·카메라 첨부.
// APP_URL 을 바꿔 검수(staging) 앱을 따로 만들 수 있다.
const appUrl = process.env.APP_URL ?? 'https://www.work-in.dev';

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
  // 스토어 심사(10/19): 웹이 앱 안인지 알아보는 표시(결제 화면 숨김) — isNativePlatform 과 함께 씀
  appendUserAgent: 'WorkInApp',
  android: { allowMixedContent: false },
  // V14 51: 끌어당김 때 상단 흰/검정 띠 방지 — 웹이 safe-area 만큼 머리줄을 내리므로 네이티브 inset 은 끈다
  ios: { contentInset: 'never', backgroundColor: '#ffffff', limitsNavigationsToAppBoundDomains: false },
  plugins: {
    FirebaseMessaging: { presentationOptions: ['badge', 'sound', 'alert'] },
    // 예약(로컬) 알림도 워크인 단색 아이콘·초록 강조색
    LocalNotifications: { smallIcon: 'ic_stat_workin', iconColor: '#0F766E' },
    // Android 15+ edge-to-edge: 상태바·내비게이션 바 높이를 CSS 변수(--safe-area-inset-*)로 넣어 머리줄·하단 탭이 겹치지 않게.
    // style LIGHT = 밝은 바탕용(어두운 상태바 글자) — 앱 머리줄이 흰색
    SystemBars: { insetsHandling: 'css', style: 'LIGHT', initialViewportFitValueHint: 'cover' },
  },
};
export default config;
