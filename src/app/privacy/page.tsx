export const metadata = { title: '개인정보처리방침' };
export const dynamic = 'force-dynamic';

export default function Privacy() {
  const contact = process.env.PRIVACY_CONTACT ?? '(개인정보 보호책임자 연락처 — 운영 설정 PRIVACY_CONTACT 에 등록)';
  const company = process.env.COMPANY_NAME ?? '주식회사 다짐';
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 text-sm leading-relaxed text-slate-800">
      <h1 className="text-xl font-bold">개인정보처리방침</h1>
      <p>{company}(이하 “회사”)는 임직원 전용 업무·일정 관리 서비스(웹·Android·iOS 앱, 이하 “서비스”)를 운영하며 다음과 같이 개인정보를 처리합니다.</p>
      <h2 className="font-semibold">1. 처리 목적</h2>
      <p>임직원 계정 관리, 업무·일정 배정과 협업, 알림 발송, 보안 감사 기록 유지. 서비스는 회사가 초대한 임직원만 이용할 수 있습니다.</p>
      <h2 className="font-semibold">2. 처리 항목</h2>
      <ul className="list-disc pl-5">
        <li>필수: 이름, 회사 이메일, 직책·소속, 권한, 비밀번호(복호화 불가능한 해시로 저장)</li>
        <li>업무 수행 중 생성: 업무·일정·댓글·첨부파일, 변경 이력</li>
        <li>자동 수집: 접속 기록(로그인 시각, IP, 기기 종류), 푸시 알림용 기기 토큰</li>
        <li>현장 QR 신고(회원·방문자): 신고 내용·위치·사진, 선택 또는 민원 회신용 이름·연락처(동의 시), 남용 방지를 위한 접속 IP 의 해시값 — 신고 처리와 결과 회신 목적, 처리 완료 1년 뒤 이름·연락처 파기</li>
        <li>선택(Google Calendar 연동 시): Google 계정 이메일, 사용자가 선택한 캘린더의 일정 정보, 접근 토큰(암호화 저장)</li>
      </ul>
      <h2 className="font-semibold">3. 보유 기간</h2>
      <p>재직 기간 동안 보유하며, 퇴사 시 계정을 즉시 비활성화합니다. 업무 기록은 회사 업무 기록 보존 기준에 따라 보관 후 파기합니다. 감사 기록은 1년간 보관합니다.</p>
      <h2 className="font-semibold">4. 제3자 제공 및 처리 위탁</h2>
      <p>법령에 근거가 있는 경우 외에는 제3자에게 제공하지 않습니다. 서비스 운영을 위해 클라우드 호스팅·데이터베이스·파일 저장·푸시 발송(Google Firebase, Apple) 사업자에게 처리를 위탁할 수 있습니다.</p>
      <h2 className="font-semibold">5. Google 사용자 데이터</h2>
      <p>Google Calendar 데이터는 사용자가 선택한 캘린더를 회사 캘린더와 동기화하는 목적으로만 사용하며, 광고나 다른 목적으로 사용하거나 판매하지 않습니다. 사용자는 설정 화면에서 언제든 연결을 해제할 수 있습니다.</p>
      <h2 className="font-semibold">6. 정보주체의 권리</h2>
      <p>임직원은 본인 정보의 열람·정정·처리정지를 요청할 수 있습니다.</p>
      <h2 className="font-semibold">7. 문의</h2>
      <p>{contact}</p>
      <p className="text-xs text-slate-500">시행일: 2026년 10월 12일</p>
    </main>
  );
}
