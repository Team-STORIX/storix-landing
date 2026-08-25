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

function pickString(value, fields) {
  for (const field of fields) {
    const candidate = value?.[field]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return ''
}

function pickBoolean(value, fields, fallback = false) {
  for (const field of fields) {
    const candidate = value?.[field]
    if (typeof candidate === 'boolean') return candidate
  }
  return fallback
}

function getImageCandidates(value) {
  const images =
    value?.images ??
    value?.imageUrls ??
    value?.cardImages ??
    value?.storyCardImages ??
    []

  if (!Array.isArray(images)) return []

  return images
    .map((image) => {
      if (typeof image === 'string') return image
      if (!image || typeof image !== 'object') return ''
      return pickString(image, ['url', 'imageUrl', 'src', 'fileUrl'])
    })
    .filter(Boolean)
}

function assertNullableCard(value) {
  if (value == null) return null
  return parseStoryCard(value)
}

function parseLuckyWork(value) {
  if (!value || typeof value !== 'object') return null
  const rawWorksId = value.worksId ?? value.workId ?? value.id
  const worksId = Number(rawWorksId)

  return {
    worksId: Number.isSafeInteger(worksId) && worksId > 0 ? worksId : null,
    displayLabel: pickString(value, ['displayLabel', 'worksName', 'workName', 'title', 'name']),
    worksType: pickString(value, ['worksType', 'workType', 'type']),
    title: pickString(value, ['title', 'worksName', 'workName', 'name', 'displayLabel']),
    platform: pickString(value, ['platform', 'platformName']),
    landingUrl: pickString(value, ['landingUrl', 'url', 'link']),
  }
}

function parseStoryCard(result) {
  if (!result || typeof result !== 'object') {
    throw new ApiError('스토리 카드 응답이 올바르지 않습니다.', {
      code: 'INVALID_RESPONSE',
    })
  }

  const imageCandidates = getImageCandidates(result)
  const drawnOn = pickString(result, ['drawnOn', 'drawDate', 'drawnDate', 'serviceDate', 'date', 'createdAt'])
  const genre = pickString(result, ['genre', 'genreName', 'category', 'categoryName'])
  const immersion = pickString(result, ['immersion', 'immersionLevel', 'immersionPower', 'mood'])

  return {
    drawnOn,
    alreadyDrawn: pickBoolean(result, ['alreadyDrawn', 'drawnToday', 'isDrawn'], true),
    genre,
    aiImageUrl: pickString(result, ['aiImageUrl', 'mainImageUrl', 'imageUrl', 'cardImageUrl']) || imageCandidates[0] || '',
    backgroundImageUrl:
      pickString(result, ['backgroundImageUrl', 'backgroundUrl', 'bgImageUrl']) || imageCandidates[1] || '',
    iconImageUrl: pickString(result, ['iconImageUrl', 'iconUrl', 'badgeImageUrl']) || imageCandidates[2] || '',
    imageUrl:
      pickString(result, ['imageUrl', 'aiImageUrl', 'mainImageUrl', 'cardImageUrl']) || imageCandidates[0] || '',
    message: pickString(result, ['message', 'description', 'summary']),
    messageLines: Array.isArray(result.messageLines)
      ? result.messageLines.filter((line) => typeof line === 'string')
      : [],
    immersion,
    luckyWork: parseLuckyWork(result.luckyWork ?? result.work ?? result.works ?? result.recommendedWork),
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

function parseModalRequired(result) {
  if (!result || typeof result !== 'object') {
    throw new ApiError('스토리 카드 안내 모달 응답이 올바르지 않습니다.', {
      code: 'INVALID_RESPONSE',
    })
  }

  return {
    modalRequired: assertBoolean(result.modalRequired, 'modalRequired'),
  }
}

export async function getAppEventModalRequired(appEventId, { signal } = {}) {
  const eventId = Number(appEventId)
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    throw new ApiError('앱 이벤트 ID가 올바르지 않습니다.', {
      code: 'INVALID_APP_EVENT_ID',
    })
  }

  const result = await apiRequest(`/api/v1/app-events/${eventId}/modal-required`, {
    signal,
  })
  return parseModalRequired(result)
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

export async function searchStoryCardLuckyWorkId({ keyword, worksType, signal } = {}) {
  const trimmedKeyword = typeof keyword === 'string' ? keyword.trim() : ''
  if (!trimmedKeyword) return null

  const params = new URLSearchParams({
    keyword: trimmedKeyword,
    sort: 'NAME',
    page: '0',
  })

  if (typeof worksType === 'string' && worksType.trim()) {
    params.append('worksTypes', worksType.trim())
  }

  const result = await apiRequest(`/api/v2/search/works?${params.toString()}`, {
    signal,
  })
  const page = result?.result ?? result
  const content = Array.isArray(page?.content) ? page.content : []
  const normalizedKeyword = trimmedKeyword.replace(/\s+/g, '').toLowerCase()

  const exactMatch = content.find((item) => {
    const worksName = typeof item?.worksName === 'string' ? item.worksName : ''
    return worksName.replace(/\s+/g, '').toLowerCase() === normalizedKeyword
  })
  const candidate = exactMatch ?? content[0]
  const worksId = Number(candidate?.worksId)

  return Number.isSafeInteger(worksId) && worksId > 0 ? worksId : null
}
