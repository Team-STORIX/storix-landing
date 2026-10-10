import { publicApiRequest } from '../../lib/apiClient.js'
import { createResponseAsserts, invalidResponse } from '../../lib/apiAssert.js'

const APP_EVENT_STATUSES = new Set(['SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELED'])

const assert = createResponseAsserts('이벤트')

function parseAppEvent(result) {
  assert.object(result, '이벤트 상세 응답이 올바르지 않습니다.')

  if (!Number.isSafeInteger(result.id) || result.id <= 0) {
    throw invalidResponse('이벤트 응답의 id 값이 올바르지 않습니다.')
  }

  const status = assert.nonEmptyString(result.status, 'status')
  if (!APP_EVENT_STATUSES.has(status)) {
    throw invalidResponse('지원하지 않는 이벤트 상태입니다.', 'UNSUPPORTED_EVENT_STATUS')
  }

  return {
    id: result.id,
    name: assert.nonEmptyString(result.name, 'name'),
    description: assert.nonEmptyString(result.description, 'description'),
    eventType: assert.nonEmptyString(result.eventType, 'eventType'),
    pageKey: typeof result.pageKey === 'string' && result.pageKey.trim() ? result.pageKey.trim() : null,
    startAt: assert.nonEmptyString(result.startAt, 'startAt'),
    endAt: assert.nonEmptyString(result.endAt, 'endAt'),
    status,
  }
}

/** GET /api/v1/app-events/{appEventId} — 비로그인 상태에서도 조회 가능한 이벤트 메타 */
export async function getPublicAppEvent(appEventId, { signal } = {}) {
  const result = await publicApiRequest(`/api/v1/app-events/${appEventId}`, { signal })
  return parseAppEvent(result)
}
