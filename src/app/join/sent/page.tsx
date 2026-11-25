import Link from 'next/link';
import { AuthCard } from '@/components/AuthCard';

/** #1176 합류 신청 뒤 안내(메일 확인 · 소셜 신청 · 오류) */
export default async function JoinSent({ searchParams }: { searchParams: Promise<{ verified?: string; via?: string; c?: string; error?: string }> }) {
  const q = await searchParams;
  const company = String(q.c ?? '').slice(0, 60);
  return (
    <AuthCard title={q.error ? '확인하지 못했습니다' : '합류 신청을 보냈습니다'}>
      <div className="space-y-3 text-sm" data-testid="join-sent">
        {q.error ? <p className="text-red-700" role="alert">{String(q.error).slice(0, 200)}</p>
          : q.verified ? <p>메일 확인이 끝났습니다. {company ? <b>{company}</b> : '회사'} 관리자에게 합류 신청이 갔습니다 — 승인되면 메일로 알려 드리고, 그때부터 로그인할 수 있습니다.</p>
          : <p>합류 신청을 보냈습니다. 회사 관리자가 승인하면 메일로 알려 드리고, 신청한 소셜 계정으로 로그인할 수 있습니다.</p>}
        <Link href="/login" className="inline-block font-medium text-brand-700 underline">로그인 화면으로</Link>
      </div>
    </AuthCard>
  );
}
