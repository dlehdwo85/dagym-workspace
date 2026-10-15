import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { listRevenue } from '@/lib/revenue';
import { HIDDEN_BRANDS } from '@/lib/types';

/** 매출 표준 양식 CSV(현장·월·항목) — 앱에서는 blob 내려받기가 안 돼 서버 주소로(점검 2026-10-16) */
export const GET = handler(async ({ req, user }) => {
  const month = /^\d{4}-\d{2}$/.test(req.nextUrl.searchParams.get('month') ?? '') ? req.nextUrl.searchParams.get('month')! : new Date().toISOString().slice(0, 7);
  const brand = req.nextUrl.searchParams.get('brand');
  const { units } = (await listRevenue(user, Number(month.slice(0, 4)))) as unknown as { units: { name: string; brand_id: string }[] };
  const us = units.filter((u) => !HIDDEN_BRANDS.includes(u.brand_id as never) && (!brand || u.brand_id === brand));
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const body = ['현장,월,항목,금액,근거파일명', ...us.flatMap((u) => ['매출', '지출', '회원수', '목표'].map((it) => `${esc(u.name)},${month},${it},,`))].join('\n');
  return new NextResponse('﻿' + body + '\n', { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`매출_${month}.csv`)}` } });
});
