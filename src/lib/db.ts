import postgres from 'postgres';

declare global {
  // eslint-disable-next-line no-var
  var __workosSql: postgres.Sql | undefined;
}

/** 프로세스 전역 커넥션 풀. 사용: const sql = db(); await sql`select 1` */
export function db(): postgres.Sql {
  if (!globalThis.__workosSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL 이 설정되지 않았습니다');
    globalThis.__workosSql = postgres(url, {
      max: Number(process.env.DB_POOL_MAX ?? 5),
      prepare: false, // pgbouncer(트랜잭션 풀링) 호환
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
      transform: { undefined: null },
      // date 컬럼은 'YYYY-MM-DD' 문자열 그대로 (시간대 변환으로 하루 밀리는 문제 방지)
      types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } },
    });
  }
  return globalThis.__workosSql;
}

export type Sql = postgres.Sql | postgres.TransactionSql;
