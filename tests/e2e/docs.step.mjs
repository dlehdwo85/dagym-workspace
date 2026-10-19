// 대표 결정 10/19: 자료실 '워크인 문서' 공동 편집 1차 — 두 브라우저(PC 대표·휴대폰 직원)가 같은 문서를 동시에 고쳐도 같은 글,
// 다른 사람 아바타, 끊긴 쪽(오프라인) 다시 연결 시 합쳐짐, 보기 권한은 입력 막힘, 편집 공유, 기록·되돌리기, Word 내보내기, 360 넘침 없음
import assert from 'node:assert/strict';

// 다른 사람 커서 이름표(collaboration-carets__label)가 글 사이에 끼므로 빼고 읽는다
const PLAIN = `(() => { const el = document.querySelector('[data-testid="doc-editor"]'); if (!el) return ''; const c = el.cloneNode(true); c.querySelectorAll('[class*="collaboration-carets"]').forEach((x) => x.remove()); return c.innerText; })()`;
const text = (pg) => pg.evaluate(PLAIN);
const waitText = async (pg, s, ms = 15000) => { await pg.waitForFunction(([code, x]) => eval(code).includes(x), [PLAIN, s], { timeout: ms }); };

export async function docsCoedit({ browser, owner, staff, ctx, sql, BASE, SHOTS, login }) {
  // 만들기
  await owner.goto(BASE + '/library');
  await owner.getByTestId('library-new-doc').click();
  await owner.getByLabel('문서 제목').fill('E2E 공동 편집 회의록');
  await owner.getByTestId('folder-save').click();
  await owner.waitForURL(/\/library\/doc\//);
  const id = owner.url().split('/').pop();
  await owner.getByTestId('doc-editor').waitFor();
  await owner.getByTestId('doc-status').waitFor();
  const ed = owner.getByTestId('doc-editor');
  await ed.click();
  await owner.keyboard.type('안건 1: 매출 점검');
  await owner.keyboard.press('Enter');
  await owner.screenshot({ path: `${SHOTS}/120-doc-owner.png` });

  // 휴대폰 직원이 같은 문서를 열면 대표 글이 보이고, 직원이 쓴 글이 대표 화면에도
  await staff.goto(`${BASE}/library/doc/${id}`);
  await staff.getByTestId('doc-editor').waitFor();
  await waitText(staff, '안건 1: 매출 점검');
  await staff.getByTestId('doc-editor').click();
  await staff.keyboard.press('End');
  await staff.keyboard.press('Enter');
  await staff.keyboard.type('안건 2: 전단 배포(직원)');
  await waitText(owner, '안건 2: 전단 배포(직원)');
  // 같은 순간 둘이 동시에 다른 줄을 고침 → 둘 다 같은 글
  await ed.click(); await owner.keyboard.press('End'); await owner.keyboard.press('Enter'); await owner.keyboard.type('대표 추가 줄');
  await staff.keyboard.type(' +직원 덧붙임');
  await waitText(owner, '+직원 덧붙임'); await waitText(staff, '대표 추가 줄');
  await owner.waitForTimeout(1500);
  const [t1, t2] = [await text(owner), await text(staff)];
  assert.equal(t1.replace(/\s+/g, ' ').trim(), t2.replace(/\s+/g, ' ').trim(), '두 화면이 같은 글');
  // 보는 사람 아바타(다른 사람만)
  await owner.getByTestId('doc-presence').locator('[title*="이직원"], [aria-label*="이직원"]').first().waitFor({ timeout: 15000 }).catch(async () => {
    assert.match(await owner.getByTestId('doc-presence').getAttribute('title'), /이직원/, '대표 화면에 직원 아바타');
  });
  assert.ok(!(await staff.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), '휴대폰 넘침 없음');
  await staff.screenshot({ path: `${SHOTS}/121-doc-mobile.png` });

  // 오프라인에서 고친 것도 다시 연결되면 합쳐짐
  await staff.context().setOffline(true);
  await staff.keyboard.press('Enter'); await staff.keyboard.type('오프라인에서 쓴 줄');
  await staff.getByTestId('doc-status').filter({ hasText: '연결 끊김' }).waitFor({ timeout: 15000 });
  await staff.context().setOffline(false);
  await waitText(owner, '오프라인에서 쓴 줄', 20000);
  await staff.getByTestId('doc-status').filter({ hasText: '실시간 저장' }).waitFor({ timeout: 15000 });

  // 보기 권한(자료실 메뉴 보기만) 직원은 입력이 막힘 → 편집 공유를 주면 풀림
  await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'library', userId: ctx.staffB.id, level: 'view' });
  const vc = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const viewer = await login(vc, ctx.staffB.email, ctx.staffB.password);
  await viewer.goto(`${BASE}/library/doc/${id}`);
  await viewer.getByTestId('doc-readonly').waitFor();
  assert.equal(await viewer.getByTestId('doc-editor').getAttribute('contenteditable'), 'false', '보기 전용은 입력 막힘');
  await waitText(viewer, '안건 1: 매출 점검');
  await owner.getByTestId('doc-share').click();
  await owner.getByTestId(`doc-share-role-${ctx.staffB.id}`).selectOption('edit');
  await owner.getByTestId('doc-share-save').click();
  await owner.getByText('공유를 저장했습니다').waitFor();
  await viewer.reload();
  await viewer.getByTestId('doc-editor').waitFor();
  await viewer.getByTestId('doc-readonly').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  assert.equal(await viewer.getByTestId('doc-editor').getAttribute('contenteditable'), 'true', '편집 공유 뒤 입력 가능');
  await vc.close();
  await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'library', userId: ctx.staffB.id, level: 'edit' });

  // 기록 → 되돌리기(새 변경으로 반영, 직원 화면에도)
  await owner.getByTestId('doc-history').click();
  await owner.getByTestId('doc-version-mark').click();
  await owner.getByText('지금 상태를 기록했습니다').waitFor();
  await owner.getByTestId('doc-versions').locator('li').first().waitFor();
  await owner.keyboard.press('Escape');
  await ed.click(); await owner.keyboard.press('End'); await owner.keyboard.press('Enter'); await owner.keyboard.type('되돌리기 전 실수 줄');
  await waitText(staff, '되돌리기 전 실수 줄');
  await owner.getByTestId('doc-history').click();
  owner.once('dialog', (d) => d.accept());
  await owner.getByTestId('doc-versions').locator('[data-testid^="doc-restore-"]').first().click();
  await owner.getByText('되돌렸습니다').waitFor();
  await owner.waitForFunction((code) => !eval(code).includes('되돌리기 전 실수 줄'), PLAIN);
  await staff.waitForFunction((code) => !eval(code).includes('되돌리기 전 실수 줄'), PLAIN, { timeout: 15000 });
  assert.ok((await text(staff)).includes('오프라인에서 쓴 줄'), '되돌려도 그 전 내용은 그대로');

  // 자료실 목록: 문서 아이콘·열기 링크, 검색 글자(기록 때 저장) · Word 내보내기 주소
  await staff.goto(BASE + '/library');
  await owner.goto(BASE + '/library?folder=');
  await owner.getByTestId('doc-open').filter({ hasText: 'E2E 공동 편집 회의록' }).first().waitFor();
  const [f] = await sql`select text_content, mime_type from library_files where id = ${id}`;
  assert.equal(f.mime_type, 'application/x-workin-doc'); assert.ok(f.text_content.includes('안건 1: 매출 점검'), '기록 때 검색 글자 저장');
  const r = await owner.request.get(`${BASE}/api/library/docs/${id}/export?format=docx`);
  assert.equal(r.status(), 200); assert.match(r.headers()['content-type'], /wordprocessingml/);
}
