import { BizFooter } from '@/components/BizFooter';

/** 공개 화면 하단 사업자 정보(서버에서 운영 설정 값으로) */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}<BizFooter /></>;
}
