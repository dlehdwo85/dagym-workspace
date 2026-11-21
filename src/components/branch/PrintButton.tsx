'use client';
import { Printer } from 'lucide-react';

/** #1096 인쇄 화면의 [인쇄·PDF 저장] */
export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-input bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700" data-testid="branch-print"><Printer className="size-4" />인쇄·PDF 저장</button>;
}
