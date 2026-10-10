/** 스토리 카드 데이터에서 화면/이미지 렌더링에 필요한 값을 뽑는 순수 함수들 */

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export const STORY_CARD_FALLBACK_MESSAGE = '나만의 스토리 카드'

/** 'YYYY-MM-DD…' → 'M.DD WED' */
export function formatStoryCardDate(value) {
  if (typeof value !== 'string' || !value.trim()) return ''

  const [year, month, day] = value.trim().slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return ''

  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return ''

  return `${month}.${String(day).padStart(2, '0')} ${WEEKDAYS[date.getDay()]}`
}

/** 카드 메시지를 최대 2줄로 정리한다. messageLines 가 없으면 message 한 줄을 쓴다. */
export function getStoryCardMessageLines(card, maxLines = 2) {
  const lines =
    Array.isArray(card?.messageLines) && card.messageLines.length > 0
      ? card.messageLines
      : card?.message
        ? [card.message]
        : []

  return lines
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .slice(0, maxLines)
}

export function getLuckyWorkLabel(luckyWork) {
  return luckyWork?.title?.trim() || luckyWork?.displayLabel?.trim() || ''
}

function toPositiveWorksId(value) {
  const worksId = Number(value)
  return Number.isSafeInteger(worksId) && worksId > 0 ? worksId : null
}

function extractWorksIdFromPath(pathname) {
  const match = pathname.match(/\/works?\/(\d+)/)
  return match ? toPositiveWorksId(match[1]) : null
}

/** luckyWork 의 ID 필드 → landingUrl 쿼리 → landingUrl 경로 순으로 작품 ID 를 찾는다. */
export function getLuckyWorkId(luckyWork) {
  if (!luckyWork) return null

  const directId = toPositiveWorksId(luckyWork.worksId ?? luckyWork.workId ?? luckyWork.id)
  if (directId) return directId

  const landingUrl = luckyWork.landingUrl?.trim()
  if (!landingUrl) return null

  try {
    const url = new URL(landingUrl)
    const queryId = toPositiveWorksId(
      url.searchParams.get('worksId') || url.searchParams.get('workId') || url.searchParams.get('id'),
    )
    return queryId ?? extractWorksIdFromPath(url.pathname)
  } catch {
    return extractWorksIdFromPath(landingUrl)
  }
}
