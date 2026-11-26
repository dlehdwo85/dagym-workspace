import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { BizFooter } from '@/components/BizFooter';
import { InAppHint } from '@/components/inApp';
import { APP_SHEET_COOKIE, hostSplit } from '@/lib/hostSplit';
import { AppGetBar } from '@/components/AppGetBar';
import { appStoreUrl } from '@/lib/appStore';

// #627(SEO_AUDIT 2-1): 로그인 화면 고유 제목·설명(색인은 하지 않음 — 루트 noindex 그대로)
export const metadata: Metadata = { title: '워크인 로그인', description: '워크인 계정으로 로그인합니다. 회사 업무·일정·메신저·영업·마케팅을 한 화면에서.' };

/** 공개 화면 하단 사업자 정보(서버에서 운영 설정 값으로) */
export default async function Layout({ children }: { children: React.ReactNode }) {
  // 397차 #1023: 앱(WorkInApp)이면 처음 그림부터 앱 모양(가입·체험 문구 없음) · 하단은 약관 링크만(사업자·통신판매 표시는 웹 공개 화면용)
  // 애플 11/15 반려: 앱이 띄운 로그인 브라우저 창(표시 쿠키)에서도 같은 앱 모양
  const inApp = /WorkInApp/i.test((await headers()).get('user-agent') ?? '') || (await cookies()).get(APP_SHEET_COOKIE)?.value === '1';
  // 대표 11/20: 휴대폰 브라우저로 로그인 화면에 온 직원에게 맨 위 띠 '앱 받기'(앱 안·앱이 띄운 창에서는 그리지 않음). 앱 받기 화면은 소개 사이트(www)에 있다
  const hs = hostSplit(); const site = hs.on ? `https://${hs.site}` : '';
  return <InAppHint value={inApp}>{!inApp && <AppGetBar appstore={!!(await appStoreUrl())} base={site} />}{children}<BizFooter linksOnly={inApp} /></InAppHint>;
}
