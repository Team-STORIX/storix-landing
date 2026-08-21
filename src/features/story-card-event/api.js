import { ApiError, apiRequest } from '../../lib/apiClient.js'

function assertString(value, field) {
  if (typeof value !== 'string') {
    throw new ApiError(`스토리 카드 응답의 ${field} 값이 올바르지 않습니다.`, {
      code: 'INVALID_RESPONSE',
    })
  }

  return value
}

function assertBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw new ApiError(`스토리 카드 응답의 ${field} 값이 올바르지 않습니다.`, {
      code: 'INVALID_RESPONSE',
    })
  }

  return value
}

function assertNullableCard(value) {
  if (value == null) return null
  return parseStoryCard(value)
}

function parseLuckyWork(value) {
  if (!value || typeof value !== 'object') return null

  return {
    displayLabel: typeof value.displayLabel === 'string' ? value.displayLabel : '',
    worksType: typeof value.worksType === 'string' ? value.worksType : '',
    title: typeof value.title === 'string' ? value.title : '',
    platform: typeof value.platform === 'string' ? value.platform : '',
    landingUrl: typeof value.landingUrl === 'string' ? value.landingUrl : '',
  }
}

function parseStoryCard(result) {
  if (!result || typeof result !== 'object') {
    throw new ApiError('스토리 카드 응답이 올바르지 않습니다.', {
      code: 'INVALID_RESPONSE',
    })
  }

  return {
    drawnOn: assertString(result.drawnOn, 'drawnOn'),
    alreadyDrawn: assertBoolean(result.alreadyDrawn, 'alreadyDrawn'),
    genre: assertString(result.genre, 'genre'),
    imageUrl: typeof result.imageUrl === 'string' ? result.imageUrl : '',
    message: typeof result.message === 'string' ? result.message : '',
    messageLines: Array.isArray(result.messageLines)
      ? result.messageLines.filter((line) => typeof line === 'string')
      : [],
    immersion: typeof result.immersion === 'string' ? result.immersion : '',
    luckyWork: parseLuckyWork(result.luckyWork),
  }
}

function parseStoryCardStatus(result) {
  if (!result || typeof result !== 'object') {
    throw new ApiError('스토리 카드 현황 응답이 올바르지 않습니다.', {
      code: 'INVALID_RESPONSE',
    })
  }

  return {
    appEventId: typeof result.appEventId === 'number' ? result.appEventId : null,
    eventStartDate: assertString(result.eventStartDate, 'eventStartDate'),
    eventEndDate: assertString(result.eventEndDate, 'eventEndDate'),
    serviceDate: assertString(result.serviceDate, 'serviceDate'),
    eventActive: assertBoolean(result.eventActive, 'eventActive'),
    drawnToday: assertBoolean(result.drawnToday, 'drawnToday'),
    card: assertNullableCard(result.card),
  }
}

export async function getStoryCardEventStatus({ signal } = {}) {
  const result = await apiRequest('/api/v1/story-card-event', { signal })
  return parseStoryCardStatus(result)
}

export async function drawStoryCardEvent({ signal } = {}) {
  const result = await apiRequest('/api/v1/story-card-event/draw', {
    method: 'POST',
    signal,
  })
  return parseStoryCard(result)
}
