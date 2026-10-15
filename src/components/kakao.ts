'use client';
/** V28-2A 카카오톡 공유 — Kakao JS SDK(텍스트 템플릿). 키는 NEXT_PUBLIC_KAKAO_JS_KEY(Vercel), 도메인은 카카오 개발자 콘솔 Web 플랫폼에 등록 */
const SDK = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';
const KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY || '';
/** 카카오 텍스트 템플릿 본문 최대 길이 */
export const KAKAO_TEXT_MAX = 200;

/** 키가 있거나(운영) 시험용 가짜 SDK(window.__KAKAO_STUB)가 있으면 사용 가능 */
export function kakaoEnabled() {
  return !!KEY || (typeof window !== 'undefined' && !!(window as any).__KAKAO_STUB);
}

let loading: Promise<any> | null = null;
function loadKakao(): Promise<any> {
  const w = window as any;
  if (w.__KAKAO_STUB) return Promise.resolve(w.__KAKAO_STUB);
  if (w.Kakao?.isInitialized?.()) return Promise.resolve(w.Kakao);
  loading ??= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = SDK; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => { try { if (!w.Kakao.isInitialized()) w.Kakao.init(KEY); ok(w.Kakao); } catch (e) { fail(e); } };
    s.onerror = () => { loading = null; fail(new Error('카카오 SDK 를 불러오지 못했습니다')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** 본문이 길면 앞부분만(카카오 제한), 나머지는 복사해 붙여넣게 한다 */
export function kakaoText(body: string) {
  const t = body.trim();
  return t.length <= KAKAO_TEXT_MAX ? { text: t, cut: false } : { text: `${t.slice(0, KAKAO_TEXT_MAX - 1)}…`, cut: true };
}

/** 카카오톡 공유 창 열기(휴대폰: 카카오톡 앱, PC: 카카오 공유 창). link 는 등록한 도메인 안이어야 한다 */
export async function shareKakao(o: { text: string; url: string; buttonTitle: string }) {
  const K = await loadKakao();
  K.Share.sendDefault({ objectType: 'text', text: kakaoText(o.text).text, link: { mobileWebUrl: o.url, webUrl: o.url }, buttonTitle: o.buttonTitle });
}
