// 범용화 5단계 '금칙어 검사' — 화면·응답·메일·AI 지시문에 나가는 글자에 기본 회사(운영사) 표현이 새로 들어오지 않게 막는다.
//
// 무엇을 보나: src/ 아래 .ts·.tsx 의 문자열·템플릿 글·JSX 글(주석과 정규식은 보지 않음)에서
//   brand  = 운영사·브랜드 이름(다짐·하이링크·바디랩…)
//   domain = 그 업종의 말(단지·입주민·관리사무소·세대수·회원 민원…)
// 을 세어, 기준 파일(scripts/words-baseline.json)의 파일별 개수와 견준다.
//
// 지금 있는 것은 기본 회사 전용 분기·기본 회사 자료·공고 수집 규칙처럼 일부러 둔 것이라 기준 파일에 개수로 적어 두었다.
// 개수가 늘거나 새 파일에 생기면 실패한다 →
//   · 다른 회사도 보는 글이면: 용어 사전(src/lib/terms.ts · src/lib/sales/terms.ts)으로 옮긴다
//   · 기본 회사 전용 분기에 일부러 넣은 것이면: `node scripts/check-words.mjs --write` 로 기준을 고치고 커밋 설명에 이유를 적는다
// 개수가 줄면 통과(기준을 낮추라고 알려 줌 — `--write`).
//
// 쓰는 법:  node scripts/check-words.mjs            검사(늘면 종료 코드 1)
//           node scripts/check-words.mjs --write    지금 개수로 기준 파일을 다시 씀
//           node scripts/check-words.mjs --list src/lib/forms.ts   그 파일의 걸린 줄 보기
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE = join(ROOT, 'scripts', 'words-baseline.json');
export const WORDS = {
  brand: /다짐|DAGYM|하이\s?링크|HILINK|바디\s?랩|BODY ?LAB|두정동/g,
  domain: /입주민|입주자\s?대표\s?회의|관리\s?사무소|단지|세대수|회원 민원|주민\s?공동\s?시설|위탁\s?운영|커뮤니티 시설/g,
};
/** 제품 이름·흔한 말에 섞여 걸리는 것 — 세지 않는다: '다짐'이 들어간 일반 낱말은 없음(운영사 이름) · '산업단지'·'단지 내'도 업종 말이라 그대로 셈 */
const SKIP_DIRS = new Set(['node_modules', '.next', 'fonts']);

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name); const st = statSync(p);
    if (st.isDirectory()) files(p, out); else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}
/** 파일 하나: 문자열·템플릿 글·JSX 글에서 걸린 자리 [{ cat, line, word, text }] */
export function scan(path, source = readFileSync(path, 'utf8')) {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits = [];
  const add = (node, text) => {
    for (const [cat, re] of Object.entries(WORDS)) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(text))) hits.push({ cat, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, word: m[0], text: text.replace(/\s+/g, ' ').trim().slice(Math.max(0, m.index - 20), m.index + m[0].length + 20) });
    }
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) add(node, node.text);
    else if (ts.isJsxText(node)) add(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}
const key = (p) => relative(ROOT, p).split(sep).join('/');
function count() {
  const out = {};
  for (const f of files(join(ROOT, 'src'))) {
    const h = scan(f); if (!h.length) continue;
    const c = {}; for (const x of h) c[x.cat] = (c[x.cat] ?? 0) + 1;
    out[key(f)] = c;
  }
  return out;
}

const args = process.argv.slice(2);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (args[0] === '--list') {
    const f = join(ROOT, args[1] ?? ''); if (!args[1] || !existsSync(f)) { console.error('파일 경로를 주세요: --list src/…'); process.exit(2); }
    for (const h of scan(f)) console.log(`${args[1]}:${h.line}  [${h.cat}] ${h.word}  …${h.text}…`);
    process.exit(0);
  }
  const now = count();
  const total = (o) => Object.values(o).reduce((a, c) => ({ brand: a.brand + (c.brand ?? 0), domain: a.domain + (c.domain ?? 0) }), { brand: 0, domain: 0 });
  if (args[0] === '--write') {
    const sorted = Object.fromEntries(Object.keys(now).sort().map((k) => [k, now[k]]));
    writeFileSync(BASELINE, JSON.stringify({ note: '금칙어 검사 기준 — 파일별 지금 개수. 손으로 고치지 말고 `node scripts/check-words.mjs --write`.', files: sorted }, null, 1) + '\n');
    const t = total(now); console.log(`기준 저장: 파일 ${Object.keys(now).length}개 · brand ${t.brand} · domain ${t.domain}`);
    process.exit(0);
  }
  if (!existsSync(BASELINE)) { console.error('기준 파일이 없습니다 — node scripts/check-words.mjs --write'); process.exit(2); }
  const base = JSON.parse(readFileSync(BASELINE, 'utf8')).files;
  const up = [], down = [];
  for (const [f, c] of Object.entries(now)) for (const cat of Object.keys(WORDS)) {
    const a = c[cat] ?? 0, b = base[f]?.[cat] ?? 0;
    if (a > b) up.push({ f, cat, a, b }); else if (a < b) down.push({ f, cat, a, b });
  }
  for (const [f, c] of Object.entries(base)) if (!now[f]) for (const cat of Object.keys(c)) down.push({ f, cat, a: 0, b: c[cat] });
  const t = total(now), tb = total(base);
  console.log(`금칙어 검사: 파일 ${Object.keys(now).length}개 · brand ${t.brand}(기준 ${tb.brand}) · domain ${t.domain}(기준 ${tb.domain})`);
  if (down.length) console.log(`줄어든 곳 ${down.length}개 — 기준을 낮추려면 --write: ${down.slice(0, 6).map((x) => `${x.f}[${x.cat}] ${x.b}→${x.a}`).join(' · ')}${down.length > 6 ? ' …' : ''}`);
  if (!up.length) { console.log('통과 — 새로 들어온 기본 회사 표현 없음'); process.exit(0); }
  console.error(`\n실패 — 기본 회사 표현이 늘어난 곳 ${up.length}개:`);
  for (const x of up) {
    console.error(`  ${x.f}  [${x.cat}] ${x.b} → ${x.a}`);
    for (const h of scan(join(ROOT, x.f)).filter((h) => h.cat === x.cat).slice(0, 12)) console.error(`      ${h.line}: ${h.word}  …${h.text}…`);
  }
  console.error('\n다른 회사도 보는 글이면 용어 사전(src/lib/terms.ts · src/lib/sales/terms.ts)으로 옮기고, 기본 회사 전용 분기에 일부러 넣은 것이면 --write 로 기준을 고친 뒤 커밋 설명에 이유를 적어 주세요.');
  process.exit(1);
}
