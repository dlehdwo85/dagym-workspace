# 청약홈 분양정보 신규단지 수집기 — 영업관리 세션 인계 사본

원본: dlehdwo85/sales-os 브랜치 handoff/applyhome-supply-collector 19ccaa1 (운영 브랜치 미반영). 대표 지시(10/18)로 개발 일원화 → **sales-os 에는 배포하지 않고 워크인 영업 공간(V41 단계 2·3) 수집기로 옮겨 구현**. data.go.kr 15098547 활용신청은 10/17 이미 승인(대표 작업 불필요), 키는 DATA_GO_KR_SERVICE_KEY 공용.

워크인 구현 메모: 업종 중립 수집(수집기에서 거르지 않음) → 공용 원천 표, 회사별 필터는 데이터 설정. 실 API 확인 필요: 아파트 상세 cond[RCRIT_PBLANC_DE::GTE] 날짜 형식(문서 없음, YYYY-MM-DD 로 보내고 기간 재필터).

---

# 인계: 신규단지 자동 수집기(청약홈 분양정보) — 개발 완료, 배포 전

- 대표 요청(2026-10-18): 신규단지(building_sales_pipeline)를 자동으로 채우는 수집기. 상업화 전제라 아파트만 모으지 않고 업종 중립으로 모은다.
- 인계 사유(2026-10-18 대표 지시): "업무관리로 개발중이던 내용 전부 넘겨라 거기서 진행하겠다"
- 브랜치: `handoff/applyhome-supply-collector`. 운영 브랜치에는 아직 넣지 않았다.

## 만든 것
- `lib/collectors/applyhome_supply.ts`: 청약홈 분양정보 조회 서비스(data.go.kr 15098547, odcloud)에서 세 종류를 조회한다.
  - 대상: 아파트 / 오피스텔·도시형·민간임대·생활숙박 / 공공지원민간임대
  - 기간: 매일 최근 30일. 처음 채울 때는 POST body `{"days":365}`로 길게 받는다.
  - 칸: 시행사(BSNS_MBY_NM), 시공사(CNSTRCT_ENTRPS_NM), 공급세대, 입주예정월(→ 그 달 1일), 모집공고번호, 접수·발표·계약일·분양문의(메모)
  - 영업시작일은 모집공고일(공식 값, 'confirmed')로 둔다. 추정 날짜는 만들지 않는다.
  - 우선순위: 처음 넣을 때만 정한다(1000세대 이상 high, 300세대 이상 medium). 그 뒤에는 사람이 바꾼 값을 유지한다.
- `supabase/functions/_shared/buildings.ts`: 적재 판단(허용 칸 검증, 신규/변경/변화없음 계획).
- `supabase/functions/collector-write/index.ts`: `upsert_buildings_bulk` 동작을 추가했다. `scripts/build-edge-bundle.mjs`에는 buildings.ts를 넣었다.
- `lib/collectors/edge-writer.ts`의 `upsertBuildingsBulk`, `registry.ts` 등록, `vercel.json` 크론 `20 22 * * *`(UTC, 한국시간 07:20)
- `supabase/migrations/0038_applyhome_supply.sql`: data_source_master에 `applyhome_supply` 등록
- `scripts/tests/applyhome-supply.test.mjs`: 단위 테스트 5개. 전체 212개 통과, tsc 통과

## 남은 일 (이 순서로)
1. **Edge 함수 배포를 가장 먼저 한다.** `node scripts/build-edge-bundle.mjs`로 번들을 만들고 줄끝을 LF로 맞춘다. 맞춘 결과의 sha256은 `12483ee3ce0b832d…`다.
   - 현재 운영에 배포된 번들은 `ef59ecaa6df56a9e…`(HEAD 2f74e84 기준)이다.
   - 대시보드 Monaco 편집기에서 바꾸면 줄끝 차이가 생긴다. 반드시 LF로 바꾼 뒤 해시를 비교한다.
2. 마이그레이션 0038을 실행한다(data_source_master 1행 추가).
3. 운영 브랜치에 넣는다. 이 순서를 지키지 않으면 크론이 `unknown action`으로 실패한다.
4. 대표 작업: 공공데이터포털에서 '한국부동산원_청약홈 분양정보 조회 서비스'(15098547) 활용신청을 한다. 키는 기존 DATA_GO_KR_SERVICE_KEY를 같이 쓴다.
   - 활용신청 전에는 수집 결과가 `-4 등록되지 않은 인증키`로 실패한다. 키 값은 기록에 남지 않는다.
5. 처음 채우기: `POST /api/collectors/applyhome_supply/run`에 body `{"days":365}`
6. 실 API로 확인할 것: 아파트 상세의 `cond[RCRIT_PBLANC_DE::GTE]` 날짜 형식은 문서에 없다. 지금은 YYYY-MM-DD로 보내고, 클라이언트에서 기간을 다시 거른다.

## 상업화 메모
청약홈 데이터는 업종과 상관없이 쓸 수 있다(인테리어·가전·이사·보안·커뮤니티 운영 등). 회사별 대상(규모·유형·지역)은 워크인의 회사 설정에서 거르게 하고, 수집기는 거르지 않는다.
