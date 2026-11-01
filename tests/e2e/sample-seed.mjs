// 소개 사이트·광고 그림용 일반 B2B 샘플 회사(하늘솔루션, 가상 — 실제 데이터 아님): landing-shots.mjs(306차 #877)·ad-shots.mjs(316차 #886)가 같이 씀.
// 316차: 전자결재(휴가·구매 결재 대기)·메신저(팀방 대화)·공지도 넣음 — 광고 그림 '전자결재'·'협업' 화면용
import { BASE, Client, addDays } from '../helpers.mjs';

/** opts.image(이름, 제목, [r,g,b]) = 시안 그림(브라우저로 그린 제목 카드) — 없으면 단색 PNG */
export async function seedSample(sql, today, opts = {}) {
  const c = new Client('sample');
  const sg = await c.ok('POST', '/api/auth/signup', { email: 'sample@workin.test', password: 'sample-pass-1234', name: '김하늘', mode: 'team', company: '하늘솔루션', agree: { terms: true, age14: true, privacy: true } });
  await c.ok('POST', '/api/auth/verify', { token: sg.devLink.split('/').pop() });
  await c.ok('POST', '/api/onboarding', { title: '대표', done: true });
  const me = await c.ok('GET', '/api/auth/me'); const unit = me.orgUnits[0].id; const tenant = me.user.tenant ?? (await sql`select tenant from users where email = 'sample@workin.test'`)[0].tenant;
  const ppl = []; const staff = []; // 316차: 직원 로그인 그대로(전자결재·메신저)
  for (const [n, e] of [['이서준', 'seojun'], ['박지우', 'jiwoo'], ['최민서', 'minseo']]) {
    const inv = await c.ok('POST', '/api/admin/users', { email: `${e}@workin.test`, name: n, role: 'staff', orgUnitIds: [unit], title: '매니저' });
    const x = new Client(e); await x.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'sample-pass-1234' });
    ppl.push((await x.ok('GET', '/api/auth/me')).user.id);
    staff.push(x);
  }
  const T = [['신제품 소개 자료 최종본 정리', 0, 0, 'high'], ['거래처 미팅 준비 — 견적서 확인', 1, 0, 'urgent'], ['월간 매출 보고서 작성', 2, 1, 'normal'], ['홈페이지 이벤트 배너 교체', 0, 2, 'normal'],
    ['신규 입사자 교육 일정 잡기', 1, 3, 'normal'], ['사무실 비품 주문', 2, -1, 'low'], ['고객 문의 답변 정리', 0, 1, 'high'], ['분기 목표 회의 안건 정리', 1, 4, 'normal']];
  for (const [title, who, d, priority] of T) await c.ok('POST', '/api/tasks', { title, orgUnitId: unit, assigneeId: ppl[who], dueDate: addDays(today, d), priority });
  const cals = (await c.ok('GET', '/api/calendars')).calendars; const cc = cals.find((x) => x.type === 'company') ?? cals[0];
  for (const [title, d, h] of [['주간 팀 회의', 0, 10], ['거래처 미팅', 1, 14], ['신제품 리뷰', 2, 11], ['점심 세미나', 3, 12], ['월간 회고', 4, 16]]) await c.ok('POST', '/api/events', { calendarId: cc.id, title, start: `${addDays(today, d)}T${String(h).padStart(2, '0')}:00:00+09:00`, end: `${addDays(today, d)}T${String(h + 1).padStart(2, '0')}:00:00+09:00` });
  // 영업: 공간 켜기 + 전환 완료 + 샘플 공고·리드(일반 B2B — 306차 #877)
  await c.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant, at: new Date().toISOString(), daily: true })}) on conflict (key) do update set value = excluded.value`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values (${tenant}, true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  const put = (tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
  await put('procurement_notices', { id: 'S1', title: '공공기관 홈페이지 유지관리 용역', issuer: '경기도청', region: '경기', related: true, first_seen_at: today, deadline_at: `${addDays(today, 6)}T10:00:00+09:00`, status: '공고중' });
  await put('procurement_notices', { id: 'S2', title: '사무용 가구 구매', issuer: '수원시', region: '경기', related: true, first_seen_at: today, deadline_at: `${addDays(today, 3)}T14:00:00+09:00`, status: '공고중' });
  await put('procurement_notices', { id: 'S3', title: '청사 시설 청소 용역', issuer: '화성시', region: '경기', related: true, first_seen_at: addDays(today, -40), status: '낙찰', winner_name: '타사', contract_end_date: addDays(today, 70) });
  await c.ok('POST', '/api/sales/work', { kind: 'bid', id: 'S1', status: '연락중', nextDate: today });
  await c.ok('POST', '/api/sales/leads', { name: '가나 물류(가상)', status: '미팅예정', priority: 'high', region: '경기', expectedRevenue: 36000000, nextContactDate: today, force: true, ownerId: ppl[0] });
  await c.ok('POST', '/api/sales/leads', { name: '다라 오피스(가상)', status: '1차연락완료', region: '서울', nextContactDate: addDays(today, 2), force: true, ownerId: ppl[1] });
  await c.ok('POST', '/api/sales/leads', { name: '마바 디자인(가상)', status: '제안서작성중', region: '인천', expectedRevenue: 24000000, nextContactDate: addDays(today, 4), force: true });
  // 마케팅: 공간 켜기 + 브랜드 + 시안 3건(그림 포함)
  await c.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = await c.ok('POST', '/api/marketing/brands', { name: '하늘솔루션' }).catch(() => null);
  const { PNG } = await import('./png.mjs');
  const media = [];
  for (const [name, col] of [['신제품 소개 시안.png', [124, 58, 237]], ['고객 사례 시안.png', [37, 99, 235]], ['연말 안내 시안.png', [15, 118, 110]]]) {
    const lf = await c.ok('POST', '/api/library', { fileName: name, mimeType: 'image/png', size: 100, folder: '마케팅' });
    const buf = opts.image ? await opts.image(name, name.replace(/ 시안\.png$/, ''), col) : PNG(640, 640, col);
    await fetch(BASE + lf.upload.url, { method: 'PUT', headers: { ...lf.upload.headers, 'content-length': String(buf.length) }, body: buf });
    await c.ok('POST', `/api/library/${lf.id}/complete`); media.push(lf.id);
  }
  for (const [i, [title, channel, kind, d, h]] of [['신제품 출시 소식', 'instagram', 'feed', 1, 18], ['고객 사례 소개 영상', 'instagram', 'reels', 2, 12], ['연말 휴무 안내', 'facebook', 'feed', 3, 10]].entries())
    await c.ok('POST', '/api/marketing/contents', { title, channel, kind, brandId: brand?.id, body: `${title} — 이번 주 하늘솔루션 소식을 전해 드립니다. 자세한 내용은 프로필 링크에서 확인하세요.`, mediaIds: [media[i]], scheduledAt: `${addDays(today, d)}T${String(h).padStart(2, '0')}:00:00+09:00` }).catch((e) => console.log('content', e.message));
  // 316차 #886: 전자결재 — 직원이 올린 휴가·구매 결재(대표가 승인할 차례)
  // 결재선(대표 승인 1단계) — 새 회사 대표 화면의 '운영' 메뉴 권한과 상관없이 바로 넣음(샘플 데이터)
  await sql`insert into approval_lines (tenant, name, steps, created_by) values (${tenant}, '본사 결재', ${sql.json([{ label: '대표', type: 'role', role: 'owner' }])}, ${me.user.id})`;
  await staff[0].ok('POST', '/api/approvals/requests', { kind: 'leave', data: { leave_type: '연차', period: { from: addDays(today, 7), to: addDays(today, 8) }, reason: '가족 행사' } }).catch((e) => console.log('approval', e.message));
  await staff[1].ok('POST', '/api/approvals/requests', { kind: 'purchase', data: { item: '회의실 모니터', qty: '1', amount: '320000', reason: '화상회의용' } }).catch((e) => console.log('approval', e.message));
  // 메신저: 팀방 대화 + 공지
  const room = await c.ok('POST', '/api/chat/rooms', { kind: 'group', name: '영업팀', userIds: ppl }).catch(() => null);
  if (room?.id) {
    for (const [who, body] of [[c, '내일 거래처 미팅 자료 오늘 중으로 정리 부탁드려요'], [staff[0], '네, 견적서까지 넣어서 3시까지 올릴게요'], [staff[1], '회의실은 2층 큰 방으로 잡아 두었습니다'], [c, '좋아요. 미팅 끝나면 다음 연락일도 같이 정해 주세요']])
      await who.ok('POST', `/api/chat/rooms/${room.id}/messages`, { body }).catch((e) => console.log('chat', e.message));
  }
  await c.ok('POST', '/api/notices', { title: '11월 전체 회의 안내', body: '첫째 주 월요일 오전 10시, 2층 회의실', important: true, pinned: true }).catch((e) => console.log('notice', e.message));
  return { c, unit, ppl, tenant, room: room?.id ?? null };
}
