import { apiRequest } from '../../lib/apiClient.js'
import { createResponseAsserts, invalidResponse } from '../../lib/apiAssert.js'

const BASE_PATH = '/api/v1/attendance-event'

const assert = createResponseAsserts('출석')

function parseAttendanceEventStatus(result) {
  assert.object(result, '출석 현황 응답이 올바르지 않습니다.')

  if (!Array.isArray(result.attendedDates)) {
    throw invalidResponse('출석 날짜 응답이 올바르지 않습니다.')
  }

  return {
    appEventId: assert.number(result.appEventId, 'appEventId'),
    eventStartDate: assert.dateKey(result.eventStartDate, 'eventStartDate'),
    eventEndDate: assert.dateKey(result.eventEndDate, 'eventEndDate'),
    attendedDates: result.attendedDates.map((date) => assert.dateKey(date, 'attendedDates')),
    totalAttendedDays: assert.number(result.totalAttendedDays, 'totalAttendedDays'),
    attendedToday: assert.boolean(result.attendedToday, 'attendedToday'),
    issuedTickets: assert.number(result.issuedTickets, 'issuedTickets'),
    eventActive: assert.boolean(result.eventActive, 'eventActive'),
  }
}

function parseAttendanceCheckInResult(result) {
  assert.object(result, '출석 체크 응답이 올바르지 않습니다.')

  return {
    attendedDate: assert.dateKey(result.attendedDate, 'attendedDate'),
    totalAttendedDays: assert.number(result.totalAttendedDays, 'totalAttendedDays'),
    newlyIssuedTickets: assert.number(result.newlyIssuedTickets, 'newlyIssuedTickets'),
    issuedTickets: assert.number(result.issuedTickets, 'issuedTickets'),
  }
}

/** GET /api/v1/attendance-event */
export async function getAttendanceEventStatus({ signal } = {}) {
  const result = await apiRequest(BASE_PATH, { signal })
  return parseAttendanceEventStatus(result)
}

/** POST /api/v1/attendance-event/check-in */
export async function checkInAttendanceEvent({ signal } = {}) {
  const result = await apiRequest(`${BASE_PATH}/check-in`, { method: 'POST', signal })
  return parseAttendanceCheckInResult(result)
}
