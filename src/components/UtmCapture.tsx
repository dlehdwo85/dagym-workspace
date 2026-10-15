'use client';
import { useEffect } from 'react';
import { captureUtm } from './conversion';

/** 소개·가입 화면에서 첫 방문 UTM 을 기억(가입 회사의 유입 경로) */
export function UtmCapture() {
  useEffect(() => { captureUtm(); }, []);
  return null;
}
