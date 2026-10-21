export type CollectorResult = { inserted: number; updated: number; unchanged: number; errors: number; errorLog?: string; summary?: string; providerMode: 'api' | 'web_scrape' | 'file_download' | 'manual' };
export type CollectorCtx = { fetchImpl: typeof fetch; deadlineMs: number; params?: Record<string, unknown>; now: () => number };
export type Collector = { slug: string; label: string; hourKst: number; source: string; needs?: string[]; note?: string; run(ctx: CollectorCtx): Promise<CollectorResult> };
