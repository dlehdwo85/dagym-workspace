// #497 R44 'ChatGPT 처럼': AI 비서 답이 글자 단위로 이어서 나옴(쓰는 중 말풍선·커서·[멈춤]) → 끝나면 서식(제목·굵게·목록·표·링크) 그대로
// · 도구 단계에는 무엇을 하는지 한 줄('업무 확인 중…') · 패널(✨)도 같음 · 휴대폰 표 가로 넘침 없음 (가짜 AI 서버 SSE — 실제 모델 속도·품질은 로컬 확인)
import assert from 'node:assert/strict';

export async function aiStream({ browser, desk, owner, BASE, FAKE, SHOTS }) {
  const q = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
  const say = (text, extra = {}) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', ...extra });
  const MD = '## 이번 주 정리\n\n**마감 2건**이 남았습니다. [업무 목록](/tasks)에서 확인하세요.\n\n- 견적서 보내기\n- 회의록 정리\n\n| 업무 | 마감 | 담당 |\n| --- | --- | --- |\n| 견적서 | 금요일 | 대표 |\n| 회의록 | 목요일 | 대표 |\n\n끝까지 확인했습니다.';

  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(BASE + '/assistant');
  const box = owner.getByLabel('AI 에게 요청', { exact: true });
  await box.fill('이번 주 내 업무 정리해줘');
  await q([say(MD, { chunkDelayMs: 250 })]); // 8조각 × 0.25초
  await box.press('Enter');
  // 쓰는 중: 말풍선이 먼저 뜨고 글이 늘어남, [멈춤] 단추, 아직 끝 문장은 없음
  const live = owner.getByTestId('ai-live');
  await live.waitFor();
  await owner.getByTestId('ai-stop').waitFor();
  const first = await live.innerText();
  assert.ok(!first.includes('끝까지 확인했습니다'), '처음엔 일부만');
  await owner.waitForFunction((n) => (document.querySelector('[data-testid=ai-live]')?.textContent?.length ?? 0) > n, first.length);
  await owner.screenshot({ path: `${SHOTS}/241-ai-stream-live.png` });
  // 끝: 정식 답(서식) — 쓰는 중 말풍선은 사라짐
  const ans = owner.getByTestId('ai-answer').filter({ hasText: '끝까지 확인했습니다' });
  await ans.waitFor();
  await live.waitFor({ state: 'detached' });
  await owner.getByRole('button', { name: '보내기' }).waitFor();
  assert.equal(await ans.locator('h3').innerText(), '이번 주 정리');
  assert.equal(await ans.locator('strong').innerText(), '마감 2건');
  assert.equal(await ans.locator('ul li').count(), 2);
  assert.deepEqual(await ans.locator('th').allInnerTexts(), ['업무', '마감', '담당']);
  assert.equal(await ans.locator('tbody tr').count(), 2);
  assert.equal(await ans.locator('a', { hasText: '업무 목록' }).getAttribute('href'), '/tasks');
  assert.ok(!(await ans.innerText()).includes('**'), '굵게 표시(**)가 글자로 남지 않음');
  await ans.screenshot({ path: `${SHOTS}/242-ai-answer-format.png` });

  // 도구 단계: '업무 확인 중…' 한 줄 → 다음 단계 답
  await q([{ content: [{ type: 'tool_use', id: 't1', name: 'search_tasks', input: { query: '견적' } }], stop_reason: 'tool_use' }, say('찾은 업무가 없습니다.', { delayMs: 1500 })]);
  await box.fill('견적 업무 찾아줘');
  await box.press('Enter');
  await owner.getByTestId('ai-live-status').filter({ hasText: '업무 확인 중' }).waitFor();
  await owner.getByTestId('ai-answer').filter({ hasText: '찾은 업무가 없습니다' }).waitFor();

  // 패널(✨)도 같은 흐름
  await owner.goto(BASE + '/tasks');
  await owner.getByTestId('ai-dock-open').click();
  const dock = owner.getByTestId('ai-dock');
  const db = dock.getByLabel('AI 에게 요청 (화면 맥락)');
  await db.fill('패널에서 정리해줘');
  await q([say('패널 답: **굵게**\n\n1. 첫째\n2. 둘째', { chunkDelayMs: 200 })]);
  await db.press('Enter');
  await dock.getByTestId('ai-live').waitFor();
  const pans = dock.getByTestId('ai-answer').filter({ hasText: '패널 답' });
  await pans.waitFor();
  assert.equal(await pans.locator('ol li').count(), 2);
  await dock.getByRole('button', { name: '닫기' }).click();

  // 휴대폰: 표가 있어도 화면 가로 넘침 없음(표만 옆으로 밀림)
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  const m = await mc.newPage();
  await m.goto(BASE + '/assistant');
  const mb = m.getByLabel('AI 에게 요청', { exact: true });
  await mb.fill('표로 정리해줘');
  await q([say('| 아주 긴 칸 이름 하나 | 아주 긴 칸 이름 둘 | 아주 긴 칸 이름 셋 | 아주 긴 칸 이름 넷 |\n| --- | --- | --- | --- |\n| 가 | 나 | 다 | 라 |')]);
  await m.getByRole('button', { name: '보내기' }).tap();
  await m.getByTestId('ai-answer').locator('table').waitFor();
  const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await mc.close();
}
