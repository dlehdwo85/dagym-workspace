// 337차(대표 11/02 17:3x ②): 메일·문자 본문에 [날짜] 같은 빈칸이 남아도 보내기를 막지 않음 — 본문 아래 안내 한 줄 + 보내기 전 확인 창(취소하면 돌아가 고침 · 확인하면 그대로 보냄)
import assert from 'node:assert/strict';

export async function mailDate337({ owner, ctx, BASE, SHOTS, sql }) {
  await sql`insert into mail_accounts (tenant, provider, host, port, secure, username, from_email, from_name, password_enc) values ('default', 'naver', 'smtp.naver.com', 465, true, 'office', 'office@mail.test', '시험회사', 'v1.x.y.z')
    on conflict (tenant) do nothing`;
  // 보내기에는 회사 명함(회사 프로필)이 있어야 함 — 혼자 돌 때도 되게 V21 과 같은 프로필을 넣어 둠(있으면 덮어씀)
  await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'hilink', name: 'HI-LINK 시험', phone: '1555-0000', address: '시험시 시험로 36, 8층', website: 'www.hilink.test' });
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '337 빈칸 메일 업무', approvalRequired: false });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByTestId('mail-compose-open').click();
  const c = owner.getByTestId('mail-compose'); await c.waitFor();
  if (await c.getByTestId('mail-company-hilink').count()) await c.getByTestId('mail-company-hilink').click();
  await c.getByTestId('mail-to').pressSequentially('customer@client.test ');
  await c.getByTestId('mail-subject').fill('방문 안내');
  await c.getByTestId('mail-body').fill('안녕하세요.\n\n[날짜]에 방문해 설명드리겠습니다.');
  const hint = c.getByTestId('mail-ph-hint'); await hint.waitFor();
  assert.match(await hint.innerText(), /\[날짜\][\s\S]*보내도 됩니다/);
  // 확인 창에서 [취소] → 안 보내고 창은 그대로
  let msg = '';
  owner.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
  await c.getByTestId('mail-send').click();
  await owner.waitForTimeout(500);
  assert.match(msg, /\[날짜\][\s\S]*그대로 보낼까요/);
  assert.equal((await sql`select count(*)::int as n from outbox where task_id = ${t.id}`)[0].n, 0, '취소하면 안 보냄');
  await c.getByTestId('mail-body').waitFor();
  await owner.screenshot({ path: `${SHOTS}/337-mail-ph-hint.png` });
  // 문자 탭도 같은 안내·확인 창(취소)
  await c.getByTestId('mail-channel-sms').click();
  await c.getByTestId('sms-body').fill('[날짜] 방문 예정입니다.');
  await c.getByTestId('sms-ph-hint').waitFor();
  await c.getByTestId('sms-to').fill('010-0000-0000');
  msg = '';
  owner.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
  await c.getByTestId('sms-open').click();
  await owner.waitForTimeout(500);
  assert.match(msg, /\[날짜\][\s\S]*그대로 보낼까요/);
  // 메일 탭으로 돌아가 [확인] → 그대로 보냄(보관함)
  await c.getByTestId('mail-channel-email').click();
  owner.once('dialog', (d) => d.accept());
  await c.getByTestId('mail-send').click();
  await owner.getByText(/보관함에 넣었습니다/).waitFor();
  assert.equal((await sql`select count(*)::int as n from outbox where task_id = ${t.id}`)[0].n, 1, '확인하면 그대로 보냄');
}
