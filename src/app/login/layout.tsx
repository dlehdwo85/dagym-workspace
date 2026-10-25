import type { Metadata } from 'next';
import { BizFooter } from '@/components/BizFooter';

// #627(SEO_AUDIT 2-1): 로그인 화면 고유 제목·설명(색인은 하지 않음 — 루트 noindex 그대로)
export const metadata: Metadata = { title: '워크인 로그인', description: '워크인 계정으로 로그인합니다. 회사 업무·일정·메신저·영업·마케팅을 한 화면에서.' };

/** 공개 화면 하단 사업자 정보(서버에서 운영 설정 값으로) */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}<BizFooter /></>;
}
