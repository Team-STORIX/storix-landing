import { ApiError, publicApiRequest } from '../../lib/apiClient.js'

const APP_EVENT_STATUSES = new Set(['SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELED'])

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(`이벤트 응답의 ${field} 값이 올바르지 않습니다.`, {
      code: 'INVALID_RESPONSE',
    })
  }

  return value
}

function parseAppEvent(result) {
  if (!result || typeof result !== 'object') {
    throw new ApiError('이벤트 상세 응답이 올바르지 않습니다.', {
      code: 'INVALID_RESPONSE',
    })
  }

  if (!Number.isSafeInteger(result.id) || result.id <= 0) {
    throw new ApiError('이벤트 응답의 id 값이 올바르지 않습니다.', {
      code: 'INVALID_RESPONSE',
    })
  }

  const status = assertNonEmptyString(result.status, 'status')
  if (!APP_EVENT_STATUSES.has(status)) {
    throw new ApiError('지원하지 않는 이벤트 상태입니다.', {
      code: 'UNSUPPORTED_EVENT_STATUS',
    })
  }

  return {
    id: result.id,
    name: assertNonEmptyString(result.name, 'name'),
    description: assertNonEmptyString(result.description, 'description'),
    eventType: assertNonEmptyString(result.eventType, 'eventType'),
    pageKey: typeof result.pageKey === 'string' && result.pageKey.trim()
      ? result.pageKey.trim()
      : null,
    startAt: assertNonEmptyString(result.startAt, 'startAt'),
    endAt: assertNonEmptyString(result.endAt, 'endAt'),
    status,
  }
}

export async function getPublicAppEvent(appEventId, { signal } = {}) {
  const result = await publicApiRequest(`/api/v1/app-events/${appEventId}`, { signal })
  return parseAppEvent(result)
}
