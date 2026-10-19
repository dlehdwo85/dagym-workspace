import { H, LegalDoc, biz } from '@/components/Legal';
import { db } from '@/lib/db';
export const metadata = { title: 'Meta 연동 데이터 삭제' };
export const dynamic = 'force-dynamic';

/** Meta(Facebook·Instagram·Threads) 연동 데이터 삭제 안내 + 확인 코드 조회(Meta 앱 '데이터 삭제 안내 URL'·삭제 콜백의 상태 주소). 로그인 불필요 */
export default async function DataDeletion({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const b = biz();
  const code = String((await searchParams).code ?? '').replace(/[^0-9a-f]/gi, '').slice(0, 32).toLowerCase();
  let found: { created_at: Date; removed: number } | null = null;
  if (code) {
    const [r] = await db()<{ created_at: Date; removed: number }[]>`select created_at, coalesce((detail->>'removed')::int, 0) as removed from audit_logs
      where action = 'mkt_publish.meta_data_deletion' and detail->>'code' = ${code} order by created_at desc limit 1`.catch(() => []);
    found = r ?? null;
  }
  const when = (d: Date) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'short' }).format(d);
  return (
    <LegalDoc title="Meta 연동 데이터 삭제">
      <p>워크인은 고객 회사의 관리자가 직접 연결한 Facebook 페이지·Instagram·Threads 계정에 대해 연결 정보(계정 이름·ID)와 접근 토큰을 저장합니다. 아래 방법 중 하나로 언제든 삭제를 요청할 수 있습니다.</p>
      <H>삭제하는 방법</H>
      <ol className="list-decimal space-y-1 pl-5">
        <li>워크인에서: 마케팅 › 설정 › <b>연결 계정</b>에서 해당 계정의 [끊기]를 누르면 연결 정보와 토큰이 즉시 삭제됩니다.</li>
        <li>Facebook에서: Facebook 설정 › <b>보안 및 로그인</b> › <b>앱 및 웹사이트</b>(또는 비즈니스 통합)에서 &lsquo;워크인&rsquo;을 삭제하면 Meta가 워크인에 삭제 요청을 보내고, 워크인은 그 Facebook 사용자가 연결한 모든 계정 정보를 지운 뒤 확인 코드를 발급합니다.</li>
        <li>이메일로: {b.privacyEmail} 으로 회사 이름과 연결한 계정(페이지·인스타그램 이름)을 보내 주세요.</li>
      </ol>
      <p>요청을 받으면 <b>30일 안에</b> 삭제하며, 1·2번은 즉시 처리됩니다. 이미 게시한 글은 각 플랫폼에 남아 있으므로 필요하면 그 플랫폼에서 직접 지워 주세요. 워크인 안의 게시 기록(게시 주소·시각)은 회사의 업무 기록으로 남습니다.</p>
      <H>삭제 요청 확인</H>
      <form method="get" className="flex flex-wrap gap-2" data-testid="deletion-form">
        <input name="code" defaultValue={code} placeholder="확인 코드" aria-label="확인 코드" className="w-56 rounded border border-slate-300 px-2 py-1" />
        <button type="submit" className="rounded bg-slate-800 px-3 py-1 text-white">조회</button>
      </form>
      {code && (found
        ? <p className="rounded bg-emerald-50 px-3 py-2 text-emerald-900" data-testid="deletion-status">처리 완료 — {when(new Date(found.created_at))}에 연결 정보와 토큰 {found.removed}건을 삭제했습니다(확인 코드 {code}).</p>
        : <p className="rounded bg-amber-50 px-3 py-2 text-amber-900" data-testid="deletion-status">이 확인 코드로 처리된 요청을 찾지 못했습니다. 코드를 다시 확인하거나 {b.privacyEmail} 으로 문의해 주세요.</p>)}
    </LegalDoc>
  );
}
