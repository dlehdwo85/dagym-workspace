'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { AuthCard } from '@/components/AuthCard';
import { api } from '@/components/client';

/** 가입 확인 링크 → 확인 + 바로 로그인 → 첫 화면(온보딩) */
export default function VerifyPage() {
  const { token } = useParams<{ token: string }>();
  const [err, setErr] = useState<string | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return; once.current = true;
    api('/api/auth/verify', { body: { token } }).then(() => { location.href = '/'; }).catch((e) => setErr(e.message)); // #449 전환은 가입(회사 생성) 순간에 이미 보냄
  }, [token]);
  return (
    <AuthCard title="이메일 확인" sub="가입을 마무리하고 있습니다">
      {err ? <div className="space-y-3 text-sm"><p className="rounded-input border border-red-200 bg-red-50 p-3 text-red-800" role="alert">{err}</p><Link href="/login" className="font-semibold text-brand-700 underline">로그인 화면으로</Link></div>
        : <p className="flex items-center gap-2 text-sm text-ink-2"><Loader2 className="size-4 animate-spin" />확인 중…</p>}
    </AuthCard>
  );
}
