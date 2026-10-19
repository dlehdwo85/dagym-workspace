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
