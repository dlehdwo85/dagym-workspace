import Link from 'next/link';
import { H, LegalDoc, biz } from '@/components/Legal';
import { DeletionRequestForm } from '@/components/DeletionRequestForm';
export const metadata = { title: '계정 삭제 안내' };
export const dynamic = 'force-dynamic';

/** V28-5 Google Play·App Store "계정 삭제" 안내 웹 주소 — 앱 안 탈퇴 경로 + 로그인 없이 삭제 요청 */
export default function AccountDeletion() {
  const b = biz();
  return (
    <LegalDoc title="워크인 계정 삭제 안내">
      <p>워크인(개발자: {b.name}) 계정과 데이터를 지우는 방법입니다.</p>
      <H>1. 앱·웹에서 바로 탈퇴 (직접 가입한 계정)</H>
      <ol className="list-decimal space-y-1 pl-5">
        <li>워크인 앱 또는 웹에 로그인합니다.</li>
        <li>오른쪽 위 내 이름(사진)을 누르고 <b>설정</b>으로 갑니다.</li>
        <li><b>계정</b> → <b>회원 탈퇴</b>를 열고 확인 문구 &ldquo;탈퇴합니다&rdquo;를 입력해 탈퇴합니다. 공간을 만든 대표는 <b>공간 삭제</b>도 할 수 있습니다.</li>
      </ol>
      <H>2. 회사가 초대한 계정</H>
      <p>회사(관리자)가 만든 계정은 회사가 관리합니다. 앱 <b>설정 → 계정 → 계정 삭제 요청</b>을 누르면 회사 관리자와 워크인 개인정보 담당에게 요청이 갑니다. 아래 양식으로도 요청할 수 있습니다.</p>
      <H>3. 로그인할 수 없을 때 — 삭제 요청</H>
      <DeletionRequestForm />
      <p className="text-xs text-slate-500">또는 이메일 {b.privacyEmail} 로 요청할 수 있습니다. 본인 확인 후 영업일 기준 7일 안에 처리하고 결과를 알려 드립니다.</p>
      <H>4. 지워지는 것 · 남는 것</H>
      <ul className="list-disc pl-5">
        <li>지워짐: 이름·이메일·비밀번호·2단계 인증·연결된 소셜 로그인·푸시 알림 기기 정보·Google 캘린더 연결. 혼자 쓰던 공간은 업무·일정·파일까지 삭제(복구 기간 30일 뒤 완전 삭제).</li>
        <li>회사 공간에 남는 것: 회사 업무 기록 속 작성 내용은 &ldquo;탈퇴한 사용자&rdquo;로 표시되어 회사에 남습니다(회사 업무 기록 보존).</li>
        <li>법령에 따라 보관: 결제 기록 5년(전자상거래법), 접속·보안 기록 1년 — 기간이 지나면 파기합니다.</li>
      </ul>
      <p className="text-xs text-slate-500">자세한 내용은 <Link href="/privacy" className="underline">개인정보 처리방침</Link>을 참고하세요.</p>
    </LegalDoc>
  );
}
