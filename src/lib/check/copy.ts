/**
 * 「점검」 화면 글 — 한곳에 모은다(나중에 다른 말로 바꾸기 쉽게 열쇠로).
 * 이름은 프롬프트 B 의 표 그대로: 점검 · 점검 가이드 · 점검 항목 · 양호 기준 · 놓치기 쉬운 곳 · 보완 시 조치.
 * 쓰지 않는 말: 검수 · 감사 · 합격/불합격 · 재지시 · 지적. 직원에게 가는 글은 '무엇을·어디를' 중심의 정중한 요청형.
 * 특정 회사·업종 낱말은 넣지 않는다(업종 낱말은 템플릿 자료에만).
 */
export const CHECK_COPY = {
  menu: '점검',
  sub: '무엇을 어떻게 확인하고, 어떤 상태가 양호한지 정해 둡니다.',
  subShared: '우리 회사가 정한 양호 기준입니다.',
  tabs: { run: '점검하기', guide: '점검 가이드', shared: '직원 공유 양호 기준', setup: '분야·공간', report: '리포트' },
  search: '항목 이름·양호 기준 찾기',
  all: '전체',
  category: '분야', placeType: '공간 유형', uncategorized: '분야 없음',
  add: '항목 추가',
  emptyTitle: '아직 점검 항목이 없습니다',
  emptyHint: '예: 출입구 바닥 — 먼지·물기 없음',
  emptyFiltered: '조건에 맞는 항목이 없습니다',
  sharedEmptyTitle: '공유된 양호 기준이 아직 없습니다',
  sharedEmptyHint: '관리자가 점검 항목에서 "직원에게 공유"를 켜면 여기에 보입니다.',
  sharedBadge: '직원 공유',
  item: {
    new: '점검 항목 추가', edit: '점검 항목',
    title: '점검 항목 이름', titleHint: '예: 출입구 바닥',
    method: '확인 방법', methodNote: '확인 방법 설명(선택)', methodNoteHint: '예: 비스듬히 보기',
    pass: '양호 기준', passHint: '예: 먼지·물기·이물 없음',
    photos: '기준 사진', photosHint: '양호한 모습을 찍어 두면 누구나 같은 눈으로 봅니다(6장까지).', photoAdd: '사진 추가', photosAfterSave: '저장한 뒤 기준 사진을 올릴 수 있습니다.',
    blind: '놓치기 쉬운 곳', blindHint: '한 줄에 하나씩. 예: 매트 아래',
    fix: '보완 시 조치', fixHint: '예: 즉시 청소', dueDays: '기본 기한(일)', external: '외부 업체·건물 관리처에 연락이 필요함',
    cycle: '권장 주기', cycleNone: '정하지 않음',
    places: '적용 공간 유형', placesHint: '고르지 않으면 모든 공간',
    units: '적용할 곳', unitsAll: '전체', unitsSome: '일부만',
    share: '직원에게 공유', shareHint: '양호 기준·놓치기 쉬운 곳·기준 사진만 직원이 봅니다(조치·근거 메모는 안 보임).',
    basis: '근거 메모(선택)', basisHint: '왜 이 기준인지 — 관리자만 봅니다.',
    active: '사용 중',
    reason: '고친 까닭(선택)', reasonHint: '개정 이력에 남습니다.',
    history: '개정 이력', version: (n: number) => `${n}판`,
    save: '저장', saved: '저장했습니다', revised: (n: number) => `저장했습니다 — ${n}판`,
  },
  export: { copy: '글자로 복사', copied: '양호 기준을 복사했습니다', print: '인쇄·PDF 저장', heading: '양호 기준' },
  setup: {
    categories: '점검 분야', categoryAdd: '분야 추가', categoryHint: '분야는 2단계까지 만들 수 있습니다.',
    placeTypes: '공간 유형', placeTypeAdd: '공간 유형 추가',
    places: '곳별 공간', placeAdd: '공간 추가', placesHint: '실제 공간 이름을 적어 둡니다. 예: 2층 화장실',
    courses: '점검 코스', coursesHint: '공간 유형을 도는 순서입니다. 항목은 그 공간 유형에 걸린 점검 항목이 자동으로 들어갑니다.', courseAdd: '코스 이름(예: 아침 점검)', courseOrder: '돌 순서대로 공간 유형을 눌러 주세요',
    templates: '템플릿', templatesHint: '업종에 맞는 점검 항목 묶음을 더 넣을 수 있습니다. 넣은 뒤 우리 회사에 맞게 고치세요.', install: '넣기', installed: '넣음',
    installedMsg: (name: string, n: number) => `${name} 템플릿을 넣었습니다 — 항목 ${n}개`,
  },
};
/** 직원 공유용 글(복사·내보내기): 항목마다 이름 · 양호 기준 · 놓치기 쉬운 곳 */
export function sharedText(items: { title: string; category_name: string | null; pass_criteria: string; blind_spots: string[] }[]) {
  const out: string[] = [CHECK_COPY.export.heading, ''];
  let cat: string | null | undefined;
  for (const it of items) {
    if (it.category_name !== cat) { cat = it.category_name; out.push(`■ ${cat ?? CHECK_COPY.uncategorized}`); }
    out.push(`· ${it.title}: ${it.pass_criteria || '-'}`);
    if (it.blind_spots?.length) out.push(`  놓치기 쉬운 곳 — ${it.blind_spots.join(', ')}`);
  }
  return out.join('\n');
}
