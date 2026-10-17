import { notFound } from 'next/navigation';
import Link from 'next/link';
import { currentUser } from '@/lib/auth';
import { isSpace, userSpaces } from '@/lib/spaces';
import { SPACE_META } from '@/components/spaceMeta';
import { ssoConfigured } from '@/lib/sso';

export const dynamic = 'force-dynamic';

/** V41 단계 1: 공간 첫 화면. 영업은 단계 2(영업관리 이전)에서, 마케팅은 단계 4(로그인 연결)에서 채움 */
export default async function SpaceHome({ params }: { params: Promise<{ space: string }> }) {
  const { space } = await params;
  const u = await currentUser();
  if (!u || !isSpace(space) || space === 'work' || !(await userSpaces(u)).includes(space)) notFound();
  const m = SPACE_META[space];
  const marketingUrl = process.env.MARKETING_URL || 'https://dazim-hilink-integration.vercel.app/marketing';
  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid={`space-home-${space}`}>
      <h1 className="text-xl font-bold" style={{ color: m.color }}>{m.label}</h1>
      {space === 'sales' ? (
        <section className="rounded-card border border-line bg-white p-5 shadow-card">
          <p className="text-sm text-ink-2">영업관리(문의·리드·거래처·파이프라인·제안/견적·계약·입찰·공고·영업기회)를 이 공간으로 옮기는 중입니다. 옮기기 전까지는 기존 영업관리 사이트를 그대로 쓰세요.</p>
          <p className="mt-3 text-sm text-ink-2">업무·일정·자료·AI 비서는 업무 공간과 같은 것을 함께 씁니다.</p>
          <Link href="/" className="mt-4 inline-block text-sm font-medium underline" style={{ color: m.color }}>업무 공간으로</Link>
        </section>
      ) : (
        <section className="rounded-card border border-line bg-white p-5 shadow-card">
          <p className="text-sm text-ink-2">마케팅 운영실(승인 대기·게시 일정·광고 성과)은 지금 별도 화면입니다. {ssoConfigured() ? '워크인 로그인 그대로 들어갑니다(비밀번호 입력 없음).' : '워크인 로그인 연결 설정 전이라 운영실 비밀번호로 들어갑니다.'}</p>
          <a href={ssoConfigured() ? '/api/sso/marketing' : marketingUrl} target="_blank" rel="noopener" data-testid="marketing-open" className="mt-4 inline-block rounded-input px-4 py-2 text-sm font-medium text-white" style={{ background: m.color }}>마케팅 운영실 열기</a>
        </section>
      )}
    </div>
  );
}
