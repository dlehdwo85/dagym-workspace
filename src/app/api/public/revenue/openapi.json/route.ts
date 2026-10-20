import { NextResponse } from 'next/server';

/** Custom GPT Action 설정용 스키마 (비밀값 없음). GPT 편집기 → Actions → "Import from URL" 에 이 주소를 넣는다 */
export const dynamic = 'force-dynamic';
export function GET() {
  if (process.env.FEATURE_GPT_ACTION !== '1') return NextResponse.json({ error: 'not found' }, { status: 404 }); // V13 1번: 기본 꺼짐
  const url = process.env.APP_URL ?? 'https://work-in.dev';
  return NextResponse.json({
    openapi: '3.1.0',
    info: { title: '워크인 매출 입력', version: '1.0.0', description: '현장별 월 실적(매출·지출·회원수·목표)을 워크인에 입력합니다. 입력 전용이며 조회·삭제는 할 수 없습니다.' },
    servers: [{ url }],
    paths: {
      '/api/public/revenue': {
        post: {
          operationId: 'submitMonthlyRevenue',
          summary: '현장별 월 실적 입력 (항목 단위)',
          description: '현장 이름은 워크인 조직 이름과 정확히 같아야 합니다. 오류가 하나라도 있으면 아무것도 저장되지 않고 errors 에 줄 번호(1부터)와 이유가 옵니다. dryRun=true 로 먼저 검사할 수 있습니다.',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['entries'],
            properties: {
              dryRun: { type: 'boolean', description: 'true 면 검사만 하고 저장하지 않음' },
              entries: { type: 'array', maxItems: 500, items: { type: 'object', required: ['site', 'month', 'item', 'amount'], properties: {
                site: { type: 'string', description: '현장 이름 (예: 다짐 강남점)' },
                month: { type: 'string', description: '기준 월 YYYY-MM' },
                item: { type: 'string', enum: ['매출', '지출', '회원수', '목표'] },
                amount: { type: 'integer', minimum: 0, description: '원 단위 정수 (회원수는 명)' },
                sourceFile: { type: 'string', description: '근거 파일 이름 (예: 2026-10 정산표.xlsx)' },
              } } },
            } } } } },
          responses: { '200': { description: '처리 결과', content: { 'application/json': { schema: { type: 'object', properties: {
            ok: { type: 'boolean' }, count: { type: 'integer' }, errors: { type: 'array', items: { type: 'object', properties: { line: { type: 'integer' }, message: { type: 'string' } } } },
          } } } } } },
          security: [{ bearer: [] }],
        },
      },
    },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
  });
}
