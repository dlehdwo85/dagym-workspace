// 로컬 10/23 #494 A: Meta Graph·Marketing API 버전은 src/lib/metaGraph.ts 한곳(v26.0) — 다른 파일에 graph.facebook.com/vNN 을 다시 박지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../src', import.meta.url));
const walk = (dir, out = []) => { for (const n of readdirSync(dir)) { const p = path.join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(p); } return out; };

test('Meta Graph 버전 = v26.0 한곳 · 다른 파일에 버전 주소 없음', () => {
  assert.match(readFileSync(path.join(root, 'lib/metaGraph.ts'), 'utf8'), /META_GRAPH_VERSION = 'v26\.0'/);
  const hard = walk(root).filter((f) => !f.endsWith(`${path.sep}metaGraph.ts`) && /facebook\.com\/v\d+\.\d+/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hard.map((f) => path.relative(root, f)), [], 'graph.facebook.com/vNN 하드코딩');
});
