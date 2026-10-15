import Link from 'next/link';

/** 사업자 정보: 저장소에는 쓰지 않고 운영 설정(환경 변수)으로만. 비어 있으면 "대표 입력 필요" 자리표시자 */
export function biz() {
  const v = (k: string, label: string) => process.env[k] || `[${label} — 운영 설정 ${k} 입력 필요]`;
  return {
    name: v('COMPANY_NAME', '상호'), ceo: v('COMPANY_CEO', '대표자'), bizNo: v('COMPANY_BIZNO', '사업자등록번호'),
    address: v('COMPANY_ADDRESS', '주소'), phone: v('COMPANY_PHONE', '대표 전화'),
    privacyEmail: v('COMPANY_PRIVACY_EMAIL', '개인정보 문의 이메일'),
    // V34 B: 값이 정해지기 전에는 운영자(대표자)·고객센터로 표시 — 빈칸 자리표시자를 공개 화면에 내보내지 않는다
    officer: process.env.PRIVACY_CONTACT || (process.env.COMPANY_CEO ? `대표이사 ${process.env.COMPANY_CEO} (연락처는 아래 고객센터 이메일·전화)` : '대표이사 (연락처는 아래 고객센터 이메일·전화)'),
    email: process.env.SUPPORT_EMAIL || v('COMPANY_PRIVACY_EMAIL', '문의 이메일'),
  };
}
export const LEGAL_EFFECTIVE = '2026년 10월 21일';

export function LegalDoc({ title, children }: { title: string; children: React.ReactNode }) {
  const b = biz();
  return (
    <main className="mx-auto max-w-2xl space-y-4 bg-white p-6 text-sm leading-relaxed text-slate-800">
      <nav className="flex gap-3 text-xs text-slate-500"><Link href="/" className="font-semibold text-slate-700">워크인</Link><Link href="/terms">이용약관</Link><Link href="/privacy">개인정보 처리방침</Link><Link href="/ai-notice">AI 이용 안내</Link><Link href="/account-deletion">계정 삭제</Link></nav>
      <h1 className="text-xl font-bold">{title}</h1>
      {children}
      <footer className="border-t pt-3 text-xs text-slate-500">
        <p>{b.name} · 대표 {b.ceo} · 사업자등록번호 {b.bizNo}</p><p>{b.address} · 전화 {b.phone} · 문의 {b.email}</p>
        <p>시행일: {LEGAL_EFFECTIVE} (베타)</p>
      </footer>
    </main>
  );
}
export const H = ({ children }: { children: React.ReactNode }) => <h2 className="pt-2 font-semibold">{children}</h2>;
