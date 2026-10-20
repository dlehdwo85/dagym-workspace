import Link from 'next/link';
import { connection } from 'next/server';

/** 공개 화면(소개·로그인·가입) 하단 사업자 정보 — 네이버 비즈채널 검수·전자상거래법 표시. 값은 운영 환경 변수로만(저장소에 쓰지 않음), 없는 칸은 빼고 보여 줌 */
export async function BizFooter({ className }: { className?: string }) {
  await connection(); // 빌드 때가 아니라 요청 때 운영 설정 값을 읽음(값을 바꾸면 다시 배포 없이 반영)
  const e = process.env;
  const items: [string, string | undefined][] = [
    ['상호', e.COMPANY_NAME], ['대표', e.COMPANY_CEO], ['사업자등록번호', e.COMPANY_BIZNO],
    ['통신판매업 신고번호', e.COMPANY_MAIL_ORDER_NO || '신고 진행 중'], ['주소', e.COMPANY_ADDRESS],
    ['전화', e.COMPANY_PHONE], ['이메일', e.SUPPORT_EMAIL || e.COMPANY_PRIVACY_EMAIL],
  ];
  return (
    <footer className={['border-t border-line bg-white px-4 py-6 text-center text-[11px] leading-5 text-ink-3', className].filter(Boolean).join(' ')} data-testid="biz-footer">
      <img src="/brand/lockup-light.svg" alt="WorkIn 워크인" className="mx-auto mb-2 h-6" width={200} height={60} />
      <p className="mx-auto max-w-3xl">{items.filter(([, v]) => v).map(([k, v], n) => <span key={k}>{n > 0 && <span aria-hidden> · </span>}{k} {v}</span>)}</p>
      <p className="mt-1.5">
        <Link href="/terms" className="underline">이용약관</Link> · <Link href="/privacy" className="font-semibold underline">개인정보처리방침</Link> · <Link href="/account-deletion" className="underline">계정 삭제</Link> · <Link href="/ai-notice" className="underline">AI 이용 안내</Link>
      </p>
    </footer>
  );
}
