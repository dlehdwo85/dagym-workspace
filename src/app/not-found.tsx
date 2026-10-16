import Link from 'next/link';

/** 로컬 검수 10/17: 없는 주소는 한국어 안내(기본 영어 404 대신) */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center" data-testid="not-found">
      <p className="text-5xl font-bold text-ink-3">404</p>
      <h1 className="text-lg font-semibold text-ink">찾는 화면이 없습니다</h1>
      <p className="text-sm text-ink-2">주소가 바뀌었거나 볼 수 없는 화면입니다.</p>
      <Link href="/" className="mt-2 rounded-input bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">홈으로</Link>
    </main>
  );
}
