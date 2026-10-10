import { ApiError } from './apiClient.js'
import { normalizeDateKey } from './dateKey.js'

export function invalidResponse(message, code = 'INVALID_RESPONSE') {
  return new ApiError(message, { code })
}

/**
 * 응답 필드 검증기 모음.
 * scope 는 에러 메시지 앞에 붙는 응답 이름이다. (예: '출석' → "출석 응답의 x 값이 올바르지 않습니다.")
 */
export function createResponseAsserts(scope) {
  const fail = (field) => invalidResponse(`${scope} 응답의 ${field} 값이 올바르지 않습니다.`)

  return {
    object(value, message) {
      if (!value || typeof value !== 'object') throw invalidResponse(message)
      return value
    },
    number(value, field) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw fail(field)
      return value
    },
    boolean(value, field) {
      if (typeof value !== 'boolean') throw fail(field)
      return value
    },
    string(value, field) {
      if (typeof value !== 'string') throw fail(field)
      return value
    },
    nonEmptyString(value, field) {
      if (typeof value !== 'string' || value.trim() === '') throw fail(field)
      return value
    },
    dateKey(value, field) {
      const dateKey = normalizeDateKey(value)
      if (!dateKey) throw fail(field)
      return dateKey
    },
  }
}

/** 양의 정수 앱 이벤트 ID 로 변환한다. 아니면 ApiError(INVALID_APP_EVENT_ID). */
export function assertAppEventId(appEventId) {
  const eventId = Number(appEventId)
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    throw new ApiError('앱 이벤트 ID가 올바르지 않습니다.', { code: 'INVALID_APP_EVENT_ID' })
  }
  return eventId
}
