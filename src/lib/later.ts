import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { db } from './db';
import { logError } from './log';

/**
 * 정기 실행(tick) 안의 오래 걸리는 AI 제작을 응답 뒤로 돌린다 — 대표 10/24 ① 마케팅 글을 최상 모델로 올린 뒤 글 1건이 30~60초라
 * 그대로 두면 뒤 단계(게시·알림·메일 재시도)가 밀리거나 함수 시간 제한에 끊긴다. 결과·오류는 job_runs(job = 이름)에 남는다.
 * after 를 쓸 수 없는 곳(시험 스크립트 등)은 그 자리에서 이어서 돌린다
 */
export function runLater(job: string, fn: () => Promise<unknown>): 'later' {
  const startedAt = new Date();
  const done = (status: 'ok' | 'error', detail: unknown) => db()`insert into job_runs (job, trigger, status, started_at, finished_at, detail)
    values (${job}, 'tick', ${status}, ${startedAt}, now(), ${db().json((detail ?? {}) as never)})`.catch(() => {});
  const run = () => fn().then((r) => done('ok', r), async (e) => { await logError(job, e); await done('error', { error: String((e as Error)?.message ?? e).slice(0, 300) }); });
  try { after(run); } catch { void run(); }
  return 'later';
}

/** 같은 일을 한 번에 하나만(회사별 마케팅 제작 등). 이미 돌고 있으면 { busy: true } — 잠금은 함수 최대 시간(5분)보다 조금 길게 */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | { busy: true }> {
  const sql = db(); const holder = randomUUID();
  const got = await sql`insert into job_locks (name, locked_until, holder) values (${name}, now() + interval '6 minutes', ${holder})
    on conflict (name) do update set locked_until = excluded.locked_until, holder = excluded.holder where job_locks.locked_until < now() returning 1`;
  if (!got.length) return { busy: true };
  try { return await fn(); } finally { await sql`delete from job_locks where name = ${name} and holder = ${holder}`.catch(() => {}); }
}
export const isBusy = (r: unknown): r is { busy: true } => !!r && typeof r === 'object' && (r as { busy?: unknown }).busy === true;
