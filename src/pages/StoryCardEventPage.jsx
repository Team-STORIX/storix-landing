import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getWebViewAuthSnapshot,
  subscribeToWebViewAuth,
} from '../lib/webViewAuth.js'
import {
  isStorixWebView,
  postStorixWebViewMessage,
} from '../lib/webViewBridge.js'
import {
  drawStoryCardEvent,
  getAppEventModalRequired,
  getStoryCardEventStatus,
  searchStoryCardLuckyWorkId,
} from '../features/story-card-event/api.js'
import { useCardShare } from '../features/story-card-event/useCardShare.js'
import '../story-card-event.css'

const STORY_CARD_CHOICES = [
  { key: 'left', label: '왼쪽 카드', videoSrc: '/events/story-card/left.mp4' },
  { key: 'center', label: '가운데 카드', videoSrc: '/events/story-card/centre.mp4' },
  { key: 'right', label: '오른쪽 카드', videoSrc: '/events/story-card/right.mp4' },
]

function closeEventPage() {
  if (isStorixWebView()) {
    postStorixWebViewMessage({ type: 'CLOSE_WEBVIEW' })
    return
  }

  window.location.assign('/')
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = window.atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function hashString(value) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

function getAccountStorageKeyPart(accessToken) {
  if (!accessToken) return 'anonymous'

  try {
    const [, payload] = accessToken.split('.')
    if (payload) {
      const claims = JSON.parse(decodeBase64Url(payload))
      const accountId =
        claims.userId ??
        claims.memberId ??
        claims.accountId ??
        claims.id ??
        claims.sub

      if (accountId != null) return String(accountId)
    }
  } catch {
    // Fall back to a stable local token hash until the account-level API lands.
  }

  return `token-${hashString(accessToken)}`
}

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

function createFallbackStoryCard() {
  return {
    drawnOn: '',
    alreadyDrawn: false,
    genre: '오늘의 카드',
    aiImageUrl: '',
    backgroundImageUrl: '',
    iconImageUrl: '',
    imageUrl: '',
    message: '나만의 스토리 카드',
    messageLines: [],
    immersion: '',
    luckyWork: null,
  }
}

function formatStoryCardDate(value) {
  if (typeof value !== 'string' || !value.trim()) return ''

  const [year, month, day] = value.trim().slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return ''

  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return ''

  const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][date.getDay()]
  return `${month}.${String(day).padStart(2, '0')} ${weekday}`
}

function getLuckyWorkId(luckyWork) {
  if (!luckyWork) return null
  const directId = Number(luckyWork.worksId ?? luckyWork.workId ?? luckyWork.id)
  if (Number.isSafeInteger(directId) && directId > 0) {
    return directId
  }

  const landingUrl = luckyWork.landingUrl?.trim()
  if (!landingUrl) return null

  try {
    const url = new URL(landingUrl)
    const queryId = Number(url.searchParams.get('worksId') || url.searchParams.get('workId') || url.searchParams.get('id'))
    if (Number.isSafeInteger(queryId) && queryId > 0) return queryId

    const pathname = url.pathname
    const match = pathname.match(/\/works?\/(\d+)/)
    if (!match) return null

    const worksId = Number(match[1])
    return Number.isSafeInteger(worksId) && worksId > 0 ? worksId : null
  } catch {
    const match = landingUrl.match(/\/works?\/(\d+)/)
    if (!match) return null

    const worksId = Number(match[1])
    return Number.isSafeInteger(worksId) && worksId > 0 ? worksId : null
  }
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function createFallbackCardDataUrl(card) {
  const title = escapeXml(card?.genre?.trim() || '오늘의 카드')
  const message = escapeXml(card?.message?.trim() || '나만의 스토리 카드')
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="1080" viewBox="0 0 720 1080">
      <rect width="720" height="1080" rx="40" fill="#ffffff"/>
      <rect x="40" y="40" width="640" height="1000" rx="32" fill="#131112"/>
      <text x="360" y="450" text-anchor="middle" fill="#ffffff" font-size="44" font-family="sans-serif" font-weight="700">${title}</text>
      <text x="360" y="532" text-anchor="middle" fill="#cdc4c8" font-size="28" font-family="sans-serif">${message}</text>
    </svg>
  `

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function loadCanvasImage(src) {
  if (!src) return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

function convertImagesWithNativeBridge(entries) {
  if (!isStorixWebView() || entries.length === 0) {
    return Promise.resolve({})
  }

  return new Promise((resolve) => {
    const requestId = `story-card-images-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`

    const cleanup = () => {
      window.removeEventListener('message', handleMessage)
      window.removeEventListener('STORIX_NATIVE_MESSAGE', handleNativeMessage)
      window.clearTimeout(timeoutId)
    }

    const handleResult = (rawData) => {
      try {
        const message =
          typeof rawData === 'string' ? JSON.parse(rawData) : rawData
        if (
          message?.type !== 'CONVERT_STORY_CARD_IMAGES_RESULT' ||
          message?.payload?.requestId !== requestId
        ) {
          return
        }

        cleanup()
        resolve(message.payload.images && typeof message.payload.images === 'object'
          ? message.payload.images
          : {})
      } catch {
        // Ignore unrelated bridge messages.
      }
    }

    function handleMessage(event) {
      handleResult(event.data)
    }

    function handleNativeMessage(event) {
      handleResult(event.detail)
    }

    const timeoutId = window.setTimeout(() => {
      cleanup()
      resolve({})
    }, 15000)

    window.addEventListener('message', handleMessage)
    window.addEventListener('STORIX_NATIVE_MESSAGE', handleNativeMessage)

    const sent = postStorixWebViewMessage({
      type: 'CONVERT_STORY_CARD_IMAGES',
      payload: { requestId, images: entries },
    })

    if (!sent) {
      cleanup()
      resolve({})
    }
  })
}

async function fetchImageAsDataUrl(src) {
  if (!src || src.startsWith('data:image/')) return src

  const response = await fetch(src)
  if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`)
  const blob = await response.blob()

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function resolveCanvasImageSources(card) {
  const sources = {
    topBackground: '/events/story-card/top-background.png',
    aiImage: card.aiImageUrl?.trim() || card.imageUrl?.trim() || '',
    bodyBackground: card.backgroundImageUrl?.trim() || '',
    iconImage: card.iconImageUrl?.trim() || '',
    arrowImage: '/events/story-card/icon-arrow-forward-xsmall.svg',
  }

  console.log('[story-card] Image sources', {
    topBackground: sources.topBackground,
    aiImage: sources.aiImage?.substring(0, 100),
    bodyBackground: sources.bodyBackground?.substring(0, 100),
    iconImage: sources.iconImage?.substring(0, 100),
    cardData: {
      aiImageUrl: card.aiImageUrl?.substring(0, 100),
      imageUrl: card.imageUrl?.substring(0, 100),
      backgroundImageUrl: card.backgroundImageUrl?.substring(0, 100),
    },
  })

  const remoteEntries = Object.entries(sources)
    .filter(([, url]) => /^https?:\/\//i.test(url))
    .map(([key, url]) => ({ key, url }))

  const nativeImages = await convertImagesWithNativeBridge(remoteEntries)

  const resolvedEntries = await Promise.all(
    Object.entries(sources).map(async ([key, url]) => {
      if (!url) return [key, '']
      if (nativeImages[key]) return [key, nativeImages[key]]

      try {
        return [key, await fetchImageAsDataUrl(url)]
      } catch {
        return [key, url]
      }
    }),
  )

  return Object.fromEntries(resolvedEntries)
}

function drawRoundedRect(ctx, x, y, width, height, radii) {
  const radius = {
    topLeft: 0,
    topRight: 0,
    bottomRight: 0,
    bottomLeft: 0,
    ...(typeof radii === 'number'
      ? {
          topLeft: radii,
          topRight: radii,
          bottomRight: radii,
          bottomLeft: radii,
        }
      : radii),
  }

  ctx.beginPath()
  ctx.moveTo(x + radius.topLeft, y)
  ctx.lineTo(x + width - radius.topRight, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius.topRight)
  ctx.lineTo(x + width, y + height - radius.bottomRight)
  ctx.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radius.bottomRight,
    y + height,
  )
  ctx.lineTo(x + radius.bottomLeft, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bottomLeft)
  ctx.lineTo(x, y + radius.topLeft)
  ctx.quadraticCurveTo(x, y, x + radius.topLeft, y)
  ctx.closePath()
}

function drawImageCover(ctx, image, x, y, width, height) {
  if (!image) return

  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  ctx.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  )
}

function drawImageContainBottom(ctx, image, x, y, width, height) {
  if (!image) return

  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + height - drawHeight, drawWidth, drawHeight)
}

function drawTextLine(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''

  words.forEach((word) => {
    const nextLine = line ? `${line} ${word}` : word
    if (ctx.measureText(nextLine).width <= maxWidth || !line) {
      line = nextLine
      return
    }
    lines.push(line)
    line = word
  })
  if (line) lines.push(line)

  const visibleLines = lines.slice(0, maxLines)
  if (lines.length > maxLines && visibleLines.length > 0) {
    const lastIndex = visibleLines.length - 1
    let truncated = visibleLines[lastIndex]
    while (truncated.length > 0 && ctx.measureText(`${truncated}...`).width > maxWidth) {
      truncated = truncated.slice(0, -1)
    }
    visibleLines[lastIndex] = `${truncated}...`
  }

  const startY = y - ((visibleLines.length - 1) * lineHeight) / 2
  visibleLines.forEach((visibleLine, index) => {
    ctx.fillText(visibleLine, x, startY + index * lineHeight)
  })
}

function drawTextLines(ctx, lines, x, y, maxWidth, lineHeight, maxLines = 2) {
  const visibleLines = lines
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .slice(0, maxLines)

  const startY = y - ((visibleLines.length - 1) * lineHeight) / 2
  visibleLines.forEach((visibleLine, index) => {
    drawTextLine(ctx, visibleLine, x, startY + index * lineHeight, maxWidth, lineHeight, 1)
  })
}

function drawPillText(ctx, text, x, centerY, options) {
  const {
    font,
    textColor,
    backgroundColor,
    horizontalPadding,
    height,
    width: fixedWidth,
  } = options
  ctx.font = font
  const width = fixedWidth ?? Math.ceil(ctx.measureText(text).width + horizontalPadding * 2)
  drawRoundedRect(ctx, x, centerY - height / 2, width, height, height / 2)
  ctx.fillStyle = backgroundColor
  ctx.fill()
  ctx.fillStyle = textColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + width / 2, centerY + 1)
  return width
}

function drawEllipsizedText(ctx, text, x, y, maxWidth) {
  let output = String(text || '-')
  while (output.length > 1 && ctx.measureText(output).width > maxWidth) {
    output = output.slice(0, -1)
  }
  if (output !== text && output.length > 3) {
    output = `${output.slice(0, -3)}...`
  }
  ctx.fillText(output, x, y)
}

async function createStoryCardShareImage(card) {
  if (!card) return null

  await document.fonts?.ready

  // 실제 DOM에서 크기 읽기
  const cardElement = document.querySelector('.storyCardFront')
  if (!cardElement) {
    console.warn('[story-card] Card element not found for measurement')
    return null
  }

  const cardRect = cardElement.getBoundingClientRect()
  const actualCardWidth = cardRect.width
  const actualCardHeight = cardRect.height

  // 고해상도를 위해 2배 스케일
  const pixelRatio = 2
  const width = Math.round(actualCardWidth * pixelRatio)
  const height = Math.round(actualCardHeight * pixelRatio)

  // 실제 DOM 요소들의 크기 읽기
  const heroElement = cardElement.querySelector('.storyCardFrontHero')
  const blackBoxElement = cardElement.querySelector('.storyCardFrontBlackBox')
  const bodyElement = cardElement.querySelector('.storyCardFrontBody')

  const heroHeight = heroElement ? Math.round(heroElement.getBoundingClientRect().height * pixelRatio) : 0
  const blackBoxHeight = blackBoxElement ? Math.round(blackBoxElement.getBoundingClientRect().height * pixelRatio) : 0
  const bodyHeight = bodyElement ? Math.round(bodyElement.getBoundingClientRect().height * pixelRatio) : 0

  // 실제 CSS에서 계산된 border-radius 읽기
  const cardStyles = window.getComputedStyle(cardElement)
  const cardRadius = parseFloat(cardStyles.borderRadius || '20') * pixelRatio
  const sectionRadius = 16 * pixelRatio  // CSS에서 고정값

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const imageSources = await resolveCanvasImageSources(card)
  const [
    topBackground,
    aiImage,
    bodyBackground,
    iconImage,
    arrowImage,
  ] = await Promise.all([
    loadCanvasImage(imageSources.topBackground).catch(() => null),
    loadCanvasImage(imageSources.aiImage).catch(() => null),
    loadCanvasImage(imageSources.bodyBackground).catch(() => null),
    loadCanvasImage(imageSources.iconImage).catch(() => null),
    loadCanvasImage(imageSources.arrowImage).catch(() => null),
  ])

  ctx.save()
  drawRoundedRect(ctx, 0, 0, width, height, cardRadius)
  ctx.clip()

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  // ✅ Hero 영역 전체(핑크 배경 + 이미지들)에 하단 라운딩 적용
  ctx.save()
  drawRoundedRect(ctx, 0, 0, width, heroHeight, {
    topLeft: 0,
    topRight: 0,
    bottomRight: sectionRadius,
    bottomLeft: sectionRadius,
  })
  ctx.clip()

  // 핑크색 배경
  ctx.fillStyle = '#ff4093'
  ctx.fillRect(0, 0, width, heroHeight)

  // 배경 이미지
  drawImageCover(ctx, topBackground, 0, 0, width, heroHeight)

  // AI 이미지
  drawImageContainBottom(ctx, aiImage, 0, 0, width, heroHeight)

  ctx.restore()

  const blackY = heroHeight
  drawRoundedRect(ctx, 0, blackY, width, blackBoxHeight, {
    topLeft: sectionRadius,
    topRight: sectionRadius,
    bottomRight: 0,
    bottomLeft: 0,
  })
  ctx.fillStyle = '#131112'
  ctx.fill()

  const dateLabel = formatStoryCardDate(card.drawnOn)

  // 실제 DOM에서 스타일 읽기
  const blackBoxStyles = blackBoxElement ? window.getComputedStyle(blackBoxElement) : null
  const dateTextElement = cardElement.querySelector('.storyCardFrontDateText strong')
  const subtitleElement = cardElement.querySelector('.storyCardFrontDateText span')

  const horizontalPadding = blackBoxStyles ? parseFloat(blackBoxStyles.paddingLeft || '16') * pixelRatio : 32
  const textX = horizontalPadding

  const dateFontSize = dateTextElement ? parseFloat(window.getComputedStyle(dateTextElement).fontSize || '22') * pixelRatio : 44
  const subtitleFontSize = subtitleElement ? parseFloat(window.getComputedStyle(subtitleElement).fontSize || '14') * pixelRatio : 28

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  // 실제 DOM에서 gap 읽기
  const dateTextWrapper = cardElement.querySelector('.storyCardFrontDateText')
  const dateGap = dateTextWrapper ? parseFloat(window.getComputedStyle(dateTextWrapper).gap || '2') * pixelRatio : 4
  const dateStartY = blackY + (blackBoxHeight - dateFontSize - dateGap - subtitleFontSize) / 2

  ctx.font = `400 ${dateFontSize}px Bitram, SUIT, sans-serif`
  ctx.fillText(dateLabel, textX, dateStartY)
  ctx.font = `400 ${subtitleFontSize}px Bitram, SUIT, sans-serif`
  ctx.fillText("TODAY'S STORY CARD", textX, dateStartY + dateFontSize + dateGap)

  if (iconImage) {
    // CSS 고정값: width: 50px, height: 50px
    const iconSize = 50 * pixelRatio
    const iconX = width - horizontalPadding - iconSize
    const iconY = blackY + (blackBoxHeight - iconSize) / 2

    // ✅ 고품질 렌더링: 원본 이미지를 직접 스케일링
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(iconImage, iconX, iconY, iconSize, iconSize)
    ctx.restore()
  }

  const bodyY = blackY + blackBoxHeight
  drawRoundedRect(ctx, 0, bodyY, width, bodyHeight, {
    topLeft: 0,
    topRight: 0,
    bottomRight: sectionRadius,
    bottomLeft: sectionRadius,
  })
  ctx.fillStyle = '#ff7ab8'
  ctx.fill()
  ctx.save()
  drawRoundedRect(ctx, 0, bodyY, width, bodyHeight, {
    topLeft: 0,
    topRight: 0,
    bottomRight: sectionRadius,
    bottomLeft: sectionRadius,
  })
  ctx.clip()
  drawImageCover(ctx, bodyBackground, 0, bodyY, width, bodyHeight)
  ctx.restore()

  const messageLines =
    Array.isArray(card.messageLines) && card.messageLines.length > 0
      ? card.messageLines
      : card.message
        ? [card.message]
        : []
  const visibleMessageLines = messageLines
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .slice(0, 2)

  // 실제 DOM에서 메시지 스타일 읽기
  const messageElement = cardElement.querySelector('.storyCardFrontMessage')
  const messageStyles = messageElement ? window.getComputedStyle(messageElement) : null
  const messageMarginTop = messageStyles ? parseFloat(messageStyles.marginTop || '30') * pixelRatio : 60
  const messageHorizontalMargin = horizontalPadding
  const messageFontSize = messageStyles ? parseFloat(messageStyles.fontSize || '12') * pixelRatio : 24
  const messageLineHeight = messageStyles ? parseFloat(messageStyles.lineHeight || messageFontSize * 1.4) * pixelRatio : messageFontSize * 1.4

  // 메시지 위치: marginTop을 기준으로 첫 줄의 중심 계산
  const messageY = bodyY + messageMarginTop + messageLineHeight / 2

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 ${messageFontSize}px SUIT, sans-serif`
  drawTextLines(
    ctx,
    visibleMessageLines.length > 0 ? visibleMessageLines : ['나만의 스토리 카드'],
    width / 2,
    messageY,
    width - messageHorizontalMargin * 2,
    messageLineHeight,
    2,
  )

  const rows = [
    ['오늘의 몰입력', card.immersion || '-'],
    ['오늘의 장르', card.genre || '-'],
    ['행운의 작품', card.luckyWork?.title?.trim() || card.luckyWork?.displayLabel?.trim() || '-'],
  ]

  // 실제 DOM에서 info rows 스타일 읽기
  const infoRowsElement = cardElement.querySelector('.storyCardFrontInfoRows')
  const infoRowsStyles = infoRowsElement ? window.getComputedStyle(infoRowsElement) : null
  const firstInfoRow = cardElement.querySelector('.storyCardFrontInfoRow')
  const firstChip = cardElement.querySelector('.storyCardFrontInfoChip')
  const firstChipStyles = firstChip ? window.getComputedStyle(firstChip) : null

  const infoBottom = infoRowsStyles ? parseFloat(infoRowsStyles.bottom || '30') * pixelRatio : 60
  const infoRowGap = infoRowsStyles ? parseFloat(infoRowsStyles.gap || '12') * pixelRatio : 24
  const infoFontSize = firstChipStyles ? parseFloat(firstChipStyles.fontSize || '11') * pixelRatio : 22
  const chipHorizontalPadding = firstChipStyles ? parseFloat(firstChipStyles.paddingLeft || '10') * pixelRatio : 20
  const fixedChipWidth = firstChipStyles ? parseFloat(firstChipStyles.width || '86') * pixelRatio : 172
  const chipHeight = firstChipStyles ? parseFloat(firstChipStyles.height || '24') * pixelRatio : 48
  const chipValueGap = firstInfoRow ? parseFloat(window.getComputedStyle(firstInfoRow).gap || '8') * pixelRatio : 16

  // Row 중심점 계산: 각 row의 높이(chipHeight)를 고려해서 간격 계산
  // 맨 아래 row부터 시작해서 위로 올라감
  const rowCenters = [
    bodyY + bodyHeight - infoBottom - chipHeight / 2 - (chipHeight + infoRowGap) * 2,  // 첫번째 (맨 위)
    bodyY + bodyHeight - infoBottom - chipHeight / 2 - (chipHeight + infoRowGap),      // 두번째
    bodyY + bodyHeight - infoBottom - chipHeight / 2,                                   // 세번째 (맨 아래)
  ]
  const chipX = horizontalPadding
  const valueFont = `800 ${infoFontSize}px SUIT, sans-serif`

  rows.forEach(([label, value], index) => {
    const centerY = rowCenters[index]
    const renderedChipWidth = drawPillText(ctx, label, chipX, centerY, {
      font: valueFont,
      textColor: '#ff4093',
      backgroundColor: '#000000',
      horizontalPadding: chipHorizontalPadding,
      height: chipHeight,
      width: fixedChipWidth,
    })

    const valueX = chipX + renderedChipWidth + chipValueGap
    // CSS 고정값: arrow width 16px
    const arrowSize = index === 2 && arrowImage ? 16 * pixelRatio : 0
    const maxValueWidth = width - horizontalPadding - valueX - arrowSize - (arrowSize > 0 ? 2 * pixelRatio : 0)
    ctx.fillStyle = '#131112'
    ctx.font = valueFont
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    drawEllipsizedText(ctx, value, valueX, centerY, maxValueWidth)

    if (arrowImage && index === 2 && arrowSize > 0) {
      const textWidth = Math.min(ctx.measureText(value).width, maxValueWidth)
      // CSS 고정값: gap 2px
      const arrowGap = 2 * pixelRatio
      const arrowX = valueX + textWidth + arrowGap
      const arrowY = centerY - arrowSize / 2

      console.log('[story-card] Drawing arrow', {
        index,
        arrowSize,
        position: { x: arrowX, y: arrowY },
        arrowImage: !!arrowImage,
      })

      ctx.drawImage(
        arrowImage,
        arrowX,
        arrowY,
        arrowSize,
        arrowSize,
      )
    } else if (index === 2) {
      console.warn('[story-card] Arrow not drawn', {
        hasArrowImage: !!arrowImage,
        arrowSize,
        index,
      })
    }
  })

  console.log('[story-card] Canvas rendered with DOM measurements', {
    cardSize: { width, height },
    pixelRatio,
    actualSize: { width: actualCardWidth, height: actualCardHeight },
    sections: { heroHeight, blackBoxHeight, bodyHeight },
    message: {
      fontSize: messageFontSize,
      lineHeight: messageLineHeight,
      marginTop: messageMarginTop,
      y: messageY,
    },
    infoRows: {
      fontSize: infoFontSize,
      gap: infoRowGap,
      chipHeight,
      bottom: infoBottom,
      centers: rowCenters.map(y => Math.round(y)),
    }
  })

  ctx.restore()
  return canvas.toDataURL('image/png')
}

function XLogo({ size = 20, color = '#131112' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"
        fill={color}
      />
    </svg>
  )
}

function StoryCardGuideIcon({ type }) {
  if (type === 'sparkle') {
    return (
      <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
        <path
          d="M17 2C19.2 10.2 23.8 14.8 32 17C23.8 19.2 19.2 23.8 17 32C14.8 23.8 10.2 19.2 2 17C10.2 14.8 14.8 10.2 17 2Z"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (type === 'megaphone') {
    return (
      <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
        <path
          d="M6 14.5H13L27 8V26L13 19.5H6V14.5Z"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path d="M13 19.5V28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <path
        d="M5 8.5H13.5C15.4 8.5 17 10.1 17 12V28C17 25.8 15.2 24 13 24H5V8.5Z"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M29 8.5H20.5C18.6 8.5 17 10.1 17 12V28C17 25.8 18.8 24 21 24H29V8.5Z"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function StoryCardEventPage({ appEventId = null, event = null }) {
  const [authSnapshot, setAuthSnapshot] = useState(getWebViewAuthSnapshot)
  const [selectedChoice, setSelectedChoice] = useState(null)
  const [drawStatus, setDrawStatus] = useState('idle')
  const [drawnCard, setDrawnCard] = useState(null)
  const [saveModalVisible, setSaveModalVisible] = useState(false)
  const drawControllerRef = useRef(null)
  const statusControllerRef = useRef(null)
  const modalRequiredControllerRef = useRef(null)
  const animationEndedRef = useRef(false)
  const drawFailedRef = useRef(false)
  const isIOS = isIOSDevice()
  const { saveToGallery, shareImage, shareToTwitter, isSaving, isSharing } =
    useCardShare()

  useEffect(() => subscribeToWebViewAuth(setAuthSnapshot), [])

  useEffect(
    () => () => {
      drawControllerRef.current?.abort()
      statusControllerRef.current?.abort()
      modalRequiredControllerRef.current?.abort()
    },
    [],
  )

  const selectedChoiceConfig = useMemo(
    () => STORY_CARD_CHOICES.find((choice) => choice.key === selectedChoice) ?? null,
    [selectedChoice],
  )

  const normalizedAppEventId = useMemo(() => {
    const eventId = Number(appEventId ?? event?.id)
    return Number.isSafeInteger(eventId) && eventId > 0 ? eventId : null
  }, [appEventId, event?.id])

  const [showGuide, setShowGuide] = useState(false)
  const [entered, setEntered] = useState(false)
  const [guideMode, setGuideMode] = useState('entry')

  useEffect(() => {
    const previousTitle = document.title
    document.title = '오늘의 스토리 카드 이벤트 | STORIX'
    document.documentElement.classList.add('storyCardDocument')

    return () => {
      document.title = previousTitle
      document.documentElement.classList.remove('storyCardDocument')
    }
  }, [])

  useEffect(() => {
    setGuideMode('entry')
    setShowGuide(false)
    setEntered(false)
    setSelectedChoice(null)
    setDrawStatus('idle')
    setDrawnCard(null)
    animationEndedRef.current = false
    drawFailedRef.current = false

    modalRequiredControllerRef.current?.abort()

    if (!normalizedAppEventId) {
      setEntered(true)
      return undefined
    }

    if (!authSnapshot.authenticated) {
      if (!isStorixWebView()) {
        setEntered(true)
      }
      return undefined
    }

    const controller = new AbortController()
    modalRequiredControllerRef.current = controller

    getAppEventModalRequired(normalizedAppEventId, { signal: controller.signal })
      .then(({ modalRequired }) => {
        setShowGuide(modalRequired)
        setEntered(!modalRequired)
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return
        setShowGuide(false)
        setEntered(true)
      })
      .finally(() => {
        if (modalRequiredControllerRef.current === controller) {
          modalRequiredControllerRef.current = null
        }
      })

    return () => controller.abort()
  }, [normalizedAppEventId, authSnapshot.authenticated, authSnapshot.version])

  useEffect(() => {
    if (!entered) return undefined

    statusControllerRef.current?.abort()
    const controller = new AbortController()
    statusControllerRef.current = controller

    getStoryCardEventStatus({ signal: controller.signal })
      .then((status) => {
        if (status.drawnToday && status.card) {
          setDrawnCard(status.card)
          setDrawStatus('done')
          setSelectedChoice(null)
        }
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return
        if (error?.status === 401) {
          postStorixWebViewMessage({ type: 'LOGIN_REQUIRED' })
          return
        }
        postStorixWebViewMessage({
          type: 'EVENT_ERROR',
          payload: {
            code: error?.code,
            message: `스토리카드 상태 조회 실패${error?.status ? ` (${error.status})` : ''}`,
          },
        })
      })
      .finally(() => {
        if (statusControllerRef.current === controller) {
          statusControllerRef.current = null
        }
      })

    return () => controller.abort()
  }, [entered, authSnapshot.version])

  const handleBackdropClick = () => {
    if (guideMode === 'help') {
      setShowGuide(false)
      return
    }

    setShowGuide(false)
    setEntered(true)
  }

  const handleStartClick = () => {
    if (guideMode === 'help') {
      setShowGuide(false)
      return
    }

    setShowGuide(false)
    setEntered(true)
  }

  const handleHelpClick = () => {
    setGuideMode(showCardFront ? 'resultHelp' : 'help')
    setShowGuide(true)
  }

  const handleCardSelect = async (choice) => {
    if (drawStatus === 'drawing' || drawStatus === 'revealing' || drawnCard) return

    drawControllerRef.current?.abort()
    const controller = new AbortController()
    drawControllerRef.current = controller

    setSelectedChoice(choice)
    setDrawStatus('revealing')
    animationEndedRef.current = false
    drawFailedRef.current = false

    try {
      const nextCard = await drawStoryCardEvent({ signal: controller.signal })
      setDrawnCard(nextCard)
      if (animationEndedRef.current) {
        setDrawStatus('done')
      }
    } catch (error) {
      drawFailedRef.current = true
      if (error?.status === 401) {
        postStorixWebViewMessage({ type: 'LOGIN_REQUIRED' })
      } else {
        postStorixWebViewMessage({
          type: 'EVENT_ERROR',
          payload: {
            code: error?.code,
            message: `스토리카드 발급 실패${error?.status ? ` (${error.status})` : ''}`,
          },
        })
      }
      if (animationEndedRef.current) {
        setSelectedChoice(null)
        setDrawnCard(null)
        setDrawStatus('idle')
      }
    } finally {
      if (drawControllerRef.current === controller) {
        drawControllerRef.current = null
      }
    }
  }

  const handleAnimationEnded = () => {
    animationEndedRef.current = true

    if (drawFailedRef.current) {
      setSelectedChoice(null)
      setDrawnCard(null)
      setDrawStatus('idle')
      return
    }

    if (drawnCard) {
      setDrawStatus('done')
    }
  }

  const handleAnimationUnavailable = () => {
    if (animationEndedRef.current) return
    handleAnimationEnded()
  }

  const captureCard = async () => {
    // ✅ Canvas 렌더링 방식만 사용 (DOM 변경 없음)
    try {
      const imageUrl = await createStoryCardShareImage(drawnCard)
      if (imageUrl) {
        console.log('[story-card] ✅ Canvas capture success', {
          urlLength: imageUrl.length,
          urlPrefix: imageUrl.substring(0, 50)
        })
        return imageUrl
      }
    } catch (error) {
      console.error('[story-card] ❌ Canvas capture failed', {
        message: error instanceof Error ? error.message : undefined,
        stack: error instanceof Error ? error.stack : undefined,
      })
      // Fallback to SVG (rect 방식 제거 - DOM 변경 방지)
      return createFallbackCardDataUrl(drawnCard)
    }

    // 최종 fallback: SVG
    console.warn('[story-card] ❌ Using fallback SVG')
    return createFallbackCardDataUrl(drawnCard)
  }

  const handleSave = () => {
    console.log('[story-card] 💾 Save button clicked')
    void saveToGallery(captureCard, () => setSaveModalVisible(true), 'STORIX 오늘의 스토리 카드')
  }

  const handleShare = () => {
    console.log('[story-card] 📤 Share button clicked')
    void shareImage(captureCard, 'STORIX 오늘의 스토리 카드')
  }

  const handleTwitterShare = () => {
    console.log('[story-card] 🐦 Twitter share button clicked')
    void shareToTwitter(captureCard, 'STORIX 오늘의 스토리 카드')
  }

  const showCardFront = drawStatus === 'done' && drawnCard
  const resultAiImageUrl = drawnCard?.aiImageUrl?.trim() || drawnCard?.imageUrl?.trim() || ''
  const resultBackgroundImageUrl = drawnCard?.backgroundImageUrl?.trim() || ''
  const resultIconImageUrl = drawnCard?.iconImageUrl?.trim() || ''
  const resultDateLabel = formatStoryCardDate(drawnCard?.drawnOn)
  const resultMessageLines =
    Array.isArray(drawnCard?.messageLines) && drawnCard.messageLines.length > 0
      ? drawnCard.messageLines.map((line) => String(line || '').trim()).filter(Boolean).slice(0, 2)
      : drawnCard?.message
        ? [String(drawnCard.message).trim()].filter(Boolean)
        : []
  const luckyWorkId = getLuckyWorkId(drawnCard?.luckyWork)
  const luckyWorkLabel =
    drawnCard?.luckyWork?.title?.trim() ||
    drawnCard?.luckyWork?.displayLabel?.trim() ||
    ''

  // 디버깅 로그
  useEffect(() => {
    if (showCardFront && drawnCard) {
      console.log('[story-card] Card displayed', {
        luckyWorkId,
        luckyWorkLabel,
        luckyWork: drawnCard.luckyWork,
      })
    }
  }, [showCardFront, drawnCard, luckyWorkId, luckyWorkLabel])

  const openWorksDetail = (worksId) => {
    if (!worksId) return false

    if (isStorixWebView()) {
      postStorixWebViewMessage({
        type: 'OPEN_WORKS_DETAIL',
        payload: { worksId },
      })
      return true
    }

    window.location.assign(`/works/${worksId}`)
    return true
  }

  const handleLuckyWorkClick = async () => {
    if (openWorksDetail(luckyWorkId)) return

    try {
      const searchedWorksId = await searchStoryCardLuckyWorkId({
        keyword: luckyWorkLabel,
        worksType: drawnCard?.luckyWork?.worksType,
      })
      if (openWorksDetail(searchedWorksId)) return
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[story-card] lucky work search failed', {
          message: error instanceof Error ? error.message : undefined,
        })
      }
    }

    if (isStorixWebView()) {
      postStorixWebViewMessage({ type: 'EVENT_ERROR', payload: { message: '작품 정보를 찾을 수 없습니다.' } })
      return
    }

    window.alert('작품 정보를 찾을 수 없습니다.')
  }

  return (
    <main className={`storyCardEventPage${showCardFront ? ' storyCardEventPage-front' : ''}`}>
      <header className="storyCardTopBar">
        <button
          className="storyCardTopBarIconButton"
          type="button"
          aria-label="뒤로가기"
          onClick={closeEventPage}
        >
          <img
            src={showCardFront ? '/events/story-card/icon-x.svg' : '/events/story-card/icon-arrow-back.svg'}
            alt=""
            aria-hidden="true"
          />
        </button>
        <h1 className="storyCardTopBarTitle">오늘의 스토리카드</h1>
        <button
          className="storyCardTopBarIconButton"
          type="button"
          aria-label="안내"
          onClick={handleHelpClick}
        >
          <img
            src="/events/story-card/icon-help.svg"
            alt=""
            aria-hidden="true"
          />
        </button>
      </header>

      {entered && !showCardFront ? (
        <section className="storyCardContent">
          <div className="storyCardIntro">
            <h2>카드를 한 장 선택하세요</h2>
            <p>하루의 행운을 가져다줄 퀘스트를 알려드려요</p>
          </div>

          <div className="storyCardDeck" aria-label="스토리 카드 선택">
            {STORY_CARD_CHOICES.map((choice) => (
              <button
                className={`storyCardChoice storyCardChoice-${choice.key}`}
                type="button"
                key={choice.key}
                aria-label={choice.label}
                onClick={() => handleCardSelect(choice.key)}
                disabled={drawStatus === 'drawing' || drawStatus === 'revealing'}
              >
                <img
                  src="/events/story-card/single-card.png"
                  alt=""
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {showCardFront ? (
        <section className="storyCardFrontPage">
          <article className="storyCardFront" aria-label="오늘의 스토리 카드">
            <div className="storyCardFrontHero">
              <img
                className="storyCardFrontBackgroundImage"
                src="/events/story-card/top-background.png"
                alt=""
                aria-hidden="true"
              />
              {resultAiImageUrl ? (
                <img
                  className="storyCardFrontAiImage"
                  src={resultAiImageUrl}
                  alt=""
                  aria-hidden="true"
                />
              ) : null}
            </div>

            <div className="storyCardFrontBlackBox">
              <div className="storyCardFrontDateText">
                <strong>{resultDateLabel}</strong>
                <span>TODAY'S STORY CARD</span>
              </div>
              {resultIconImageUrl ? (
                <img
                  className="storyCardFrontIconImage"
                  src={resultIconImageUrl}
                  alt=""
                  aria-hidden="true"
                />
              ) : null}
            </div>

            <div className="storyCardFrontBody">
              {resultBackgroundImageUrl ? (
                <img
                  className="storyCardFrontBodyImage"
                  src={resultBackgroundImageUrl}
                  alt=""
                  aria-hidden="true"
                />
              ) : null}
              <p className="storyCardFrontMessage">
                {resultMessageLines.length > 0
                  ? resultMessageLines.map((line, index) => (
                      <span key={`${line}-${index}`}>{line}</span>
                    ))
                  : '나만의 스토리 카드'}
              </p>
              <div className="storyCardFrontInfoRows">
                <div className="storyCardFrontInfoRow">
                  <span className="storyCardFrontInfoChip">오늘의 몰입력</span>
                  <strong className="storyCardFrontInfoValue">{drawnCard.immersion || '-'}</strong>
                </div>
                <div className="storyCardFrontInfoRow">
                  <span className="storyCardFrontInfoChip">오늘의 장르</span>
                  <strong className="storyCardFrontInfoValue">{drawnCard.genre || '-'}</strong>
                </div>
                <div className="storyCardFrontInfoRow">
                  <span className="storyCardFrontInfoChip">행운의 작품</span>
                  <button
                    className="storyCardFrontLuckyWork"
                    type="button"
                    onClick={handleLuckyWorkClick}
                    disabled={!luckyWorkLabel}
                  >
                    <span>{luckyWorkLabel || '-'}</span>
                    {luckyWorkLabel ? (
                      <img
                        src="/events/story-card/icon-arrow-forward-xsmall.svg"
                        alt=""
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                </div>
              </div>
            </div>
          </article>

          <div className={`storyCardShareActions${isIOS ? ' storyCardShareActions-ios' : ''}`}>
            <button
              className="storyCardShareAction"
              type="button"
              onClick={handleSave}
              disabled={isSaving}
            >
              <span className="storyCardShareActionCircle">
                <img src="/events/story-card/icon-download.svg" alt="" aria-hidden="true" />
              </span>
              <span className="storyCardShareActionText">저장</span>
            </button>
            <button
              className="storyCardShareAction"
              type="button"
              onClick={handleShare}
              disabled={isSharing}
            >
              <span className="storyCardShareActionCircle">
                <img src="/events/story-card/icon-share.svg" alt="" aria-hidden="true" />
              </span>
              <span className="storyCardShareActionText">공유</span>
            </button>
            {!isIOS ? (
              <button
                className="storyCardShareAction"
                type="button"
                onClick={handleTwitterShare}
                disabled={isSharing}
              >
                <span className="storyCardShareActionCircle">
                  <XLogo size={20} color="#ffffff" />
                </span>
                <span className="storyCardShareActionText">X로 공유</span>
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {selectedChoiceConfig && drawStatus === 'revealing' ? (
        <div className="storyCardAnimationOverlay" aria-hidden="true">
          <video
            key={selectedChoiceConfig.key}
            className="storyCardAnimationVideo"
            src={selectedChoiceConfig.videoSrc}
            autoPlay
            muted
            playsInline
            preload="auto"
            webkit-playsinline="true"
            onEnded={handleAnimationEnded}
            onError={handleAnimationUnavailable}
            onStalled={handleAnimationUnavailable}
          />
        </div>
      ) : null}

      {showGuide ? (
        <div
          className="storyCardGuideBackdrop"
          role="presentation"
          onClick={handleBackdropClick}
        >
          {guideMode === 'resultHelp' ? (
            <section
              className="storyCardGuideModal storyCardGuideModal-result"
              role="dialog"
              aria-modal="true"
              aria-label="오늘의 스토리 카드 안내"
              onClick={(clickEvent) => clickEvent.stopPropagation()}
            >
              <h2 className="storyCardGuideTitle">오늘의 스토리 카드</h2>
              <p className="storyCardGuideLead">
                장르와 한마디, 행운의 작품을
                <br />
                카드 한 장에 담았어요.
              </p>

              <div className="storyCardGuideList">
                <div className="storyCardGuideItem">
                  <span className="storyCardGuideItemIcon">
                    <StoryCardGuideIcon type="sparkle" />
                  </span>
                  <div>
                    <h3>세 장 중 한 장을 골라요</h3>
                    <p>끌리는 카드를 열면 오늘의 이야기가 펼쳐져요.</p>
                  </div>
                </div>
                <div className="storyCardGuideItem">
                  <span className="storyCardGuideItemIcon">
                    <StoryCardGuideIcon type="megaphone" />
                  </span>
                  <div>
                    <h3>매일 아침 새로운 카드가 와요</h3>
                    <p>
                      오전 6시에 바뀌어요.
                      <br />
                      그전까지 오늘 카드는 언제든 다시 볼 수 있어요.
                    </p>
                  </div>
                </div>
                <div className="storyCardGuideItem">
                  <span className="storyCardGuideItemIcon">
                    <StoryCardGuideIcon type="book" />
                  </span>
                  <div>
                    <h3>행운의 작품도 만나보세요</h3>
                    <p>작품명을 누르면 작품 정보와 독자 리뷰를 볼 수 있어요.</p>
                  </div>
                </div>
              </div>

              <button className="storyCardGuideConfirm" type="button" onClick={handleStartClick}>
                확인
              </button>
              <p className="storyCardGuideNotice">이미지는 생성형 AI를 활용해 제작되었습니다.</p>
            </section>
          ) : (
            <section
              className="storyCardGuideModal"
              role="dialog"
              aria-modal="true"
              aria-label="오늘의 스토리 카드 안내"
              onClick={(clickEvent) => clickEvent.stopPropagation()}
            >
              <img
                className="storyCardGuideImage"
                src="/events/story-card/storycard-popup.png?v=20260824"
                alt="오늘의 스토리 카드 안내"
              />
              <button
                className="storyCardGuideAction"
                type="button"
                aria-label="카드 고르러 가기"
                onClick={handleStartClick}
              />
            </section>
          )}
        </div>
      ) : null}

      {saveModalVisible ? (
        <div
          className="storyCardSaveModalBackdrop"
          role="presentation"
          onClick={() => setSaveModalVisible(false)}
        >
          <section
            className="storyCardSaveModal"
            role="dialog"
            aria-modal="true"
            aria-label="저장 완료"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
          >
            <h2>저장 완료</h2>
            <p>카드를 갤러리에 저장했어요!</p>
            <button type="button" onClick={() => setSaveModalVisible(false)}>
              확인
            </button>
          </section>
        </div>
      ) : null}
    </main>
  )
}
