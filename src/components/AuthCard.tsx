export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow">
        <div className="mb-5 text-center">
          <div className="text-xs font-medium text-slate-500">다짐 · 하이링크 · BODY LAB</div>
          <h1 className="mt-1 text-lg font-bold text-brand-700">{title}</h1>
        </div>
        {children}
        <p className="mt-6 text-center text-[11px] text-slate-400"><a href="/privacy" className="underline">개인정보처리방침</a></p>
      </div>
    </div>
  );
}
