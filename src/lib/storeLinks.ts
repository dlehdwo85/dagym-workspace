/**
 * 스토어 주소 한 곳 — 소개 화면 · 앱 받기 화면(/app) · 휴대폰 띠가 함께 쓴다(대표 11/20 "주소 하나로 직원이 앱부터 받게").
 * Google Play 는 출시됨(대표 11/19) → 공개 주소가 기본값. App Store 는 심사 통과 뒤 NEXT_PUBLIC_APPSTORE_URL 만 넣으면 켜진다(값을 바꾸면 재배포).
 * 클라이언트 묶음에도 들어가므로 Node 전용 모듈을 들이지 않는다.
 */
export const PLAY_URL = process.env.NEXT_PUBLIC_PLAY_URL || 'https://play.google.com/store/apps/details?id=kr.co.dagym.workos';
export const APPSTORE_URL = process.env.NEXT_PUBLIC_APPSTORE_URL || '';
/** 직원에게 알려 줄 짧은 주소(경로) — 호스트는 소개 사이트(SITE) */
export const APP_GET_PATH = '/app';
/** 전체 주소(소개 사이트 호스트 — NEXT_PUBLIC_SITE_URL, 기본 www). 안내 글·메일에 적는다 */
export const APP_GET_URL = `${(process.env.NEXT_PUBLIC_SITE_URL || 'https://www.work-in.dev').replace(/\/+$/, '')}${APP_GET_PATH}`;

export type Device = 'android' | 'ios' | 'pc';
/** 기기 가름: 아이패드(맥 표시)·그 밖은 PC 로 — PC 화면은 QR 과 두 스토어를 함께 보여 줘 어느 쪽이든 닿는다 */
export function deviceOf(ua: string): Device {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'pc';
}
/** 관리자가 초대 링크와 함께 붙여 보내는 안내 글(카카오톡·문자) */
export const inviteGuideText = (link: string, appGetUrl: string) =>
  `워크인 초대입니다.\n① 아래 링크에서 비밀번호를 정하세요(7일 안).\n${link}\n② 휴대폰 앱을 받아 같은 이메일·비밀번호로 로그인하세요.\n${appGetUrl}`;
