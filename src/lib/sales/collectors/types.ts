/** #522 원천별 실행 결과 — 받은 줄 수·관련(저장 대상) 수·첫 줄 칸 이름(값은 안 씀)·오류. 하루 한 번 누락 점검이 읽는다 */
export type SourceStat = { label: string; ok: boolean; calls: number; received: number; kept: number; total?: number; keys?: string[]; error?: string; note?: string };
export type CollectorResult = { inserted: number; updated: number; unchanged: number; errors: number; errorLog?: string; summary?: string; providerMode: 'api' | 'web_scrape' | 'file_download' | 'manual'; sources?: Record<string, SourceStat> };
export type CollectorCtx = { fetchImpl: typeof fetch; deadlineMs: number; params?: Record<string, unknown>; now: () => number };
export type Collector = { slug: string; label: string; hourKst: number; againKst?: number | number[] /* 하루 여러 번: 이 시각(들) 이후 한 번씩 더 */; source: string; needs?: string[]; keyReady?: () => Promise<boolean> /* env 말고 설정에 넣은 키 */; note?: string; run(ctx: CollectorCtx): Promise<CollectorResult> };
