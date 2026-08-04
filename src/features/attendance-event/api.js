import { ApiError, apiRequest } from '../../lib/apiClient.js'
import { normalizeDateKey } from '../../lib/dateKey.js'

const BASE_PATH = '/api/v1/attendance-event'

function assertNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError(`출석 응답의 ${field} 값이 올바르지 않습니다.`, {
      code: 'INVALID_RESPONSE',
    })
  }

  return value
}

function assertBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw new ApiError(`출석 응답의 ${field} 값이 올바르지 않습니다.`, {
      code: 'INVALID_RESPONSE',
    })
  }

  return value
}

function assertDateKey(value, field) {
  const dateKey = normalizeDateKey(value)

  if (!dateKey) {
    throw new ApiError(`출석 응답의 ${field} 값이 올바르지 않습니다.`, {
      code: 'INVALID_RESPONSE',
    })
  }

  return dateKey
}

function parseAttendanceEventStatus(result) {
  if (!result || typeof result !== 'object') {
    throw new ApiError('출석 현황 응답이 올바르지 않습니다.', {
      code: 'INVALID_RESPONSE',
    })
  }

  if (!Array.isArray(result.attendedDates)) {
    throw new ApiError('출석 날짜 응답이 올바르지 않습니다.', {
      code: 'INVALID_RESPONSE',
    })
  }

  return {
    appEventId: assertNumber(result.appEventId, 'appEventId'),
    eventStartDate: assertDateKey(result.eventStartDate, 'eventStartDate'),
    eventEndDate: assertDateKey(result.eventEndDate, 'eventEndDate'),
    attendedDates: result.attendedDates.map((date) => assertDateKey(date, 'attendedDates')),
    totalAttendedDays: assertNumber(result.totalAttendedDays, 'totalAttendedDays'),
    attendedToday: assertBoolean(result.attendedToday, 'attendedToday'),
    issuedTickets: assertNumber(result.issuedTickets, 'issuedTickets'),
    eventActive: assertBoolean(result.eventActive, 'eventActive'),
  }
}

function parseAttendanceCheckInResult(result) {
  if (!result || typeof result !== 'object') {
    throw new ApiError('출석 체크 응답이 올바르지 않습니다.', {
      code: 'INVALID_RESPONSE',
    })
  }

  return {
    attendedDate: assertDateKey(result.attendedDate, 'attendedDate'),
    totalAttendedDays: assertNumber(result.totalAttendedDays, 'totalAttendedDays'),
    newlyIssuedTickets: assertNumber(result.newlyIssuedTickets, 'newlyIssuedTickets'),
    issuedTickets: assertNumber(result.issuedTickets, 'issuedTickets'),
  }
}

export async function getAttendanceEventStatus({ signal } = {}) {
  const result = await apiRequest(BASE_PATH, { signal })
  return parseAttendanceEventStatus(result)
}

export async function checkInAttendanceEvent({ signal } = {}) {
  const result = await apiRequest(`${BASE_PATH}/check-in`, {
    method: 'POST',
    signal,
  })

  return parseAttendanceCheckInResult(result)
}
