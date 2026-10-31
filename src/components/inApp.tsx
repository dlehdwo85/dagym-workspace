'use client';
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * 스토어 심사(로컬 10/19 대표): Google Play 결제 정책·Apple 3.1.1 — 앱(Android·iOS 네이티브) 안에서는 디지털 상품 결제 화면·버튼·가격·외부 결제 링크를 보이지 않는다.
 * 앱 판별 = Capacitor 네이티브(또는 앱 user-agent 'WorkInApp'). 첫 그림은 웹과 같게(false) 그린 뒤 바꿈 → 서버 렌더와 어긋나지 않음.
 */
export const isInApp = () => typeof window !== 'undefined' && (Capacitor.isNativePlatform() || /WorkInApp/i.test(navigator.userAgent));
export function useInApp() {
  const [v, setV] = useState(false);
  useEffect(() => setV(isInApp()), []);
  return v;
}
export const IN_APP_BILLING_NOTE = '요금제는 PC 웹(관리자)에서 관리합니다.';
/**
 * #839 아이폰 앱(App Store 심사 10/28 거절 — 4.8 로그인 서비스·3.1.1): 아이폰 앱은 '로그인만'.
 * 카카오·네이버·구글 로그인, 가입·회사 만들기, 무료 체험·요금·앱 밖 결제 안내를 보이지 않는다(안드로이드 앱·웹은 그대로).
 * 판별 = Capacitor 'ios' 또는 앱 표시 'WorkInApp' + 안드로이드 아님(아이패드 WebView 는 맥 표시라 기기 이름으로는 못 가림).
 */
export const isIosApp = () => typeof window !== 'undefined'
  && ((Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') || (/WorkInApp/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent)));
export function useIosApp() {
  const [v, setV] = useState(false);
  useEffect(() => setV(isIosApp()), []);
  return v;
}
export const IOS_ADMIN_NOTE = '회사 관리자에게 문의하세요.';
/** 앱 안 요금 안내 한 줄 — 아이폰 앱은 앱 밖 결제 안내도 하지 않고 관리자 문의만 */
export const billingNote = () => (isIosApp() ? IOS_ADMIN_NOTE : IN_APP_BILLING_NOTE);
