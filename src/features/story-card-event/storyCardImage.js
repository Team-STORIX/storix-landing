import { isStorixWebView, requestNativeAction } from '../../lib/webViewBridge.js'
import { formatStoryCardDate, getLuckyWorkLabel, getStoryCardMessageLines, STORY_CARD_FALLBACK_MESSAGE } from './storyCard.js'

/**
 * 화면에 그려진 .storyCardFront 를 캔버스로 다시 그려 저장/공유용 PNG(data URL)를 만든다.
 * 레이아웃 수치는 실제 DOM 의 computed style 에서 읽어 화면과 동일하게 맞춘다.
 */

const PIXEL_RATIO = 2
const MAX_RENDER_ATTEMPTS = 3
const IMAGE_LOAD_TIMEOUT_MS = 10000
const NATIVE_CONVERT_TIMEOUT_MS = 30000

const isDev = import.meta.env.DEV

function debug(...args) {
  if (isDev) console.log(...args)
}

function waitForAnimationFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

function waitForDelay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function waitForImageElement(image) {
  if (image.complete) {
    if (image.naturalWidth <= 0) {
      return Promise.reject(new Error(`Displayed image failed to load: ${image.currentSrc || image.src}`))
    }
    return image.decode?.().catch(() => undefined) ?? Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Displayed image timed out: ${image.currentSrc || image.src}`))
    }, IMAGE_LOAD_TIMEOUT_MS)

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      image.removeEventListener('load', handleLoad)
      image.removeEventListener('error', handleError)
    }
    const handleLoad = async () => {
      cleanup()
      try {
        await image.decode?.()
        resolve()
      } catch (error) {
        reject(error)
      }
    }
    const handleError = () => {
      cleanup()
      reject(new Error(`Displayed image failed to load: ${image.currentSrc || image.src}`))
    }

    image.addEventListener('load', handleLoad, { once: true })
    image.addEventListener('error', handleError, { once: true })
  })
}

async function waitForStoryCardReady() {
  await document.fonts?.ready

  const cardElement = document.querySelector('.storyCardFront')
  if (!cardElement) throw new Error('Story card element is unavailable')

  const displayedImages = Array.from(cardElement.querySelectorAll('img'))
  await Promise.all(displayedImages.map(waitForImageElement))
  await waitForAnimationFrame()
  await waitForAnimationFrame()
}

function loadCanvasImage(src) {
  if (!src) return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = async () => {
      try {
        await image.decode?.()
        resolve(image)
      } catch (error) {
        reject(error)
      }
    }
    image.onerror = reject
    image.src = src
  })
}

/** 원격 이미지를 네이티브에서 data URL 로 변환한다. 일부만 성공해도 성공한 것은 돌려준다. */
function convertImagesWithNativeBridge(entries) {
  if (!isStorixWebView() || entries.length === 0) {
    return Promise.resolve({ success: true, images: {}, errors: [] })
  }

  return requestNativeAction({
    type: 'CONVERT_STORY_CARD_IMAGES',
    resultType: 'CONVERT_STORY_CARD_IMAGES_RESULT',
    requestIdPrefix: 'story-card-images',
    payload: { images: entries },
    timeoutMs: NATIVE_CONVERT_TIMEOUT_MS,
    parseResult: (payload) => {
      const images = payload.images && typeof payload.images === 'object' ? payload.images : {}
      const errors = Array.isArray(payload.errors) ? payload.errors : []
      const missingKeys = entries
        .map(({ key }) => key)
        .filter((key) => typeof images[key] !== 'string' || !images[key])

      return {
        success: payload.success !== false && errors.length === 0 && missingKeys.length === 0,
        images,
        errors: [...errors, ...missingKeys.map((key) => ({ key, code: 'IMAGE_RESULT_MISSING' }))],
      }
    },
  }).catch((error) => {
    // 네이티브 브릿지가 없거나 시간 초과면 아래 fetch 폴백으로 넘어간다.
    if (error?.message === 'Native bridge unavailable') {
      throw new Error('Native image conversion bridge unavailable')
    }
    throw error
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

  debug('[story-card] Image sources', {
    topBackground: sources.topBackground,
    aiImage: sources.aiImage?.substring(0, 100),
    bodyBackground: sources.bodyBackground?.substring(0, 100),
    iconImage: sources.iconImage?.substring(0, 100),
  })

  const remoteEntries = Object.entries(sources)
    .filter(([, url]) => /^https?:\/\//i.test(url))
    .map(([key, url]) => ({ key, url }))

  const nativeResult = await convertImagesWithNativeBridge(remoteEntries)

  // 부분 성공 허용: 성공한 이미지는 사용하고, 실패한 것만 fetch로 재시도
  const resolvedEntries = await Promise.all(
    Object.entries(sources).map(async ([key, url]) => {
      if (!url) return [key, '']
      if (nativeResult.images[key]) return [key, nativeResult.images[key]]
      return [key, await fetchImageAsDataUrl(url)]
    }),
  )

  return Object.fromEntries(resolvedEntries)
}

// ---------- canvas drawing helpers ----------

function drawRoundedRect(ctx, x, y, width, height, radii) {
  const maxRadius = Math.max(0, Math.min(width, height) / 2)
  const clampRadius = (value) => Math.min(Math.max(Number(value) || 0, 0), maxRadius)
  const radius = {
    topLeft: 0,
    topRight: 0,
    bottomRight: 0,
    bottomLeft: 0,
    ...(typeof radii === 'number'
      ? { topLeft: radii, topRight: radii, bottomRight: radii, bottomLeft: radii }
      : radii),
  }
  radius.topLeft = clampRadius(radius.topLeft)
  radius.topRight = clampRadius(radius.topRight)
  radius.bottomRight = clampRadius(radius.bottomRight)
  radius.bottomLeft = clampRadius(radius.bottomLeft)

  ctx.beginPath()
  ctx.moveTo(x + radius.topLeft, y)
  ctx.lineTo(x + width - radius.topRight, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius.topRight)
  ctx.lineTo(x + width, y + height - radius.bottomRight)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius.bottomRight, y + height)
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
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
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
  const { font, textColor, backgroundColor, horizontalPadding, height, width: fixedWidth, radius } = options
  ctx.font = font
  const width = fixedWidth ?? Math.ceil(ctx.measureText(text).width + horizontalPadding * 2)
  drawRoundedRect(ctx, x, centerY - height / 2, width, height, radius ?? height / 2)
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

/** DOM 요소의 computed style 에서 px 값을 읽어 캔버스 배율로 환산한다. */
function readPx(element, property, fallbackPx) {
  const raw = element ? window.getComputedStyle(element)[property] : undefined
  const parsed = parseFloat(raw || '')
  return (Number.isFinite(parsed) ? parsed : fallbackPx) * PIXEL_RATIO
}

function readHeight(element) {
  return element ? Math.round(element.getBoundingClientRect().height * PIXEL_RATIO) : 0
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
  const width = Math.round(cardRect.width * PIXEL_RATIO)
  const height = Math.round(cardRect.height * PIXEL_RATIO)

  const heroElement = cardElement.querySelector('.storyCardFrontHero')
  const blackBoxElement = cardElement.querySelector('.storyCardFrontBlackBox')
  const bodyElement = cardElement.querySelector('.storyCardFrontBody')

  const heroHeight = readHeight(heroElement)
  const blackBoxHeight = readHeight(blackBoxElement)
  const bodyHeight = readHeight(bodyElement)

  const cardRadius = readPx(cardElement, 'borderRadius', 20)
  const sectionRadius = 16 * PIXEL_RATIO // CSS 고정값

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const imageSources = await resolveCanvasImageSources(card)
  const [topBackground, aiImage, bodyBackground, iconImage, arrowImage] = await Promise.all([
    loadCanvasImage(imageSources.topBackground),
    loadCanvasImage(imageSources.aiImage),
    loadCanvasImage(imageSources.bodyBackground),
    loadCanvasImage(imageSources.iconImage),
    loadCanvasImage(imageSources.arrowImage),
  ])

  ctx.save()
  drawRoundedRect(ctx, 0, 0, width, height, cardRadius)
  ctx.clip()

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  // Hero 영역 전체(핑크 배경 + 이미지들)에 하단 라운딩 적용
  ctx.save()
  drawRoundedRect(ctx, 0, 0, width, heroHeight, {
    topLeft: 0,
    topRight: 0,
    bottomRight: sectionRadius,
    bottomLeft: sectionRadius,
  })
  ctx.clip()
  ctx.fillStyle = '#ff4093'
  ctx.fillRect(0, 0, width, heroHeight)
  drawImageCover(ctx, topBackground, 0, 0, width, heroHeight)
  drawImageContainBottom(ctx, aiImage, 0, 0, width, heroHeight)
  ctx.restore()

  // 검정 박스 (날짜 + 아이콘)
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
  const dateTextWrapper = cardElement.querySelector('.storyCardFrontDateText')
  const dateTextElement = cardElement.querySelector('.storyCardFrontDateText strong')
  const subtitleElement = cardElement.querySelector('.storyCardFrontDateText span')

  const horizontalPadding = readPx(blackBoxElement, 'paddingLeft', 16)
  const textX = horizontalPadding
  const dateFontSize = readPx(dateTextElement, 'fontSize', 22)
  const subtitleFontSize = readPx(subtitleElement, 'fontSize', 14)
  const dateGap = readPx(dateTextWrapper, 'gap', 2)
  const dateStartY = blackY + (blackBoxHeight - dateFontSize - dateGap - subtitleFontSize) / 2

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.font = `400 ${dateFontSize}px Bitram, SUIT, sans-serif`
  ctx.fillText(dateLabel, textX, dateStartY)
  ctx.font = `400 ${subtitleFontSize}px Bitram, SUIT, sans-serif`
  ctx.fillText("TODAY'S STORY CARD", textX, dateStartY + dateFontSize + dateGap)

  if (iconImage) {
    const iconSize = 50 * PIXEL_RATIO // CSS 고정값: 50px
    const iconX = width - horizontalPadding - iconSize
    const iconY = blackY + (blackBoxHeight - iconSize) / 2

    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(iconImage, iconX, iconY, iconSize, iconSize)
    ctx.restore()
  }

  // 본문 (메시지 + 정보 행)
  const bodyY = blackY + blackBoxHeight
  const bodyRadii = { topLeft: 0, topRight: 0, bottomRight: sectionRadius, bottomLeft: sectionRadius }
  drawRoundedRect(ctx, 0, bodyY, width, bodyHeight, bodyRadii)
  ctx.fillStyle = '#ff7ab8'
  ctx.fill()
  ctx.save()
  drawRoundedRect(ctx, 0, bodyY, width, bodyHeight, bodyRadii)
  ctx.clip()
  drawImageCover(ctx, bodyBackground, 0, bodyY, width, bodyHeight)
  ctx.restore()

  const messageElement = cardElement.querySelector('.storyCardFrontMessage')
  const messageMarginTop = readPx(messageElement, 'marginTop', 30)
  const messageFontSize = readPx(messageElement, 'fontSize', 12)
  const messageLineHeightRaw = messageElement ? parseFloat(window.getComputedStyle(messageElement).lineHeight) : NaN
  const messageLineHeight = Number.isFinite(messageLineHeightRaw)
    ? messageLineHeightRaw * PIXEL_RATIO
    : messageFontSize * 1.4
  const messageY = bodyY + messageMarginTop + messageLineHeight / 2
  const visibleMessageLines = getStoryCardMessageLines(card)

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 ${messageFontSize}px SUIT, sans-serif`
  drawTextLines(
    ctx,
    visibleMessageLines.length > 0 ? visibleMessageLines : [STORY_CARD_FALLBACK_MESSAGE],
    width / 2,
    messageY,
    width - horizontalPadding * 2,
    messageLineHeight,
    2,
  )

  const rows = [
    ['오늘의 몰입력', card.immersion || '-'],
    ['오늘의 장르', card.genre || '-'],
    ['행운의 작품', getLuckyWorkLabel(card.luckyWork) || '-'],
  ]

  const infoRowsElement = cardElement.querySelector('.storyCardFrontInfoRows')
  const firstInfoRow = cardElement.querySelector('.storyCardFrontInfoRow')
  const firstChip = cardElement.querySelector('.storyCardFrontInfoChip')

  const infoBottom = readPx(infoRowsElement, 'bottom', 30)
  const infoRowGap = readPx(infoRowsElement, 'gap', 12)
  const infoFontSize = readPx(firstChip, 'fontSize', 11)
  const chipHorizontalPadding = readPx(firstChip, 'paddingLeft', 10)
  const fixedChipWidth = readPx(firstChip, 'width', 86)
  const chipHeight = readPx(firstChip, 'height', 24)
  const chipRadius = firstChip ? readPx(firstChip, 'borderRadius', 999) : chipHeight / 2
  const chipValueGap = readPx(firstInfoRow, 'gap', 8)

  // 맨 아래 행부터 위로 올라가며 각 행의 중심 y 를 계산한다.
  const lastRowCenter = bodyY + bodyHeight - infoBottom - chipHeight / 2
  const rowCenters = [
    lastRowCenter - (chipHeight + infoRowGap) * 2,
    lastRowCenter - (chipHeight + infoRowGap),
    lastRowCenter,
  ]
  const chipX = horizontalPadding
  const valueFont = `800 ${infoFontSize}px SUIT, sans-serif`
  const arrowSize = 16 * PIXEL_RATIO // CSS 고정값: 16px
  const arrowGap = 2 * PIXEL_RATIO // CSS 고정값: 2px

  rows.forEach(([label, value], index) => {
    const centerY = rowCenters[index]
    const renderedChipWidth = drawPillText(ctx, label, chipX, centerY, {
      font: valueFont,
      textColor: '#ff4093',
      backgroundColor: '#000000',
      horizontalPadding: chipHorizontalPadding,
      height: chipHeight,
      width: fixedChipWidth,
      radius: chipRadius,
    })

    const isLuckyWorkRow = index === rows.length - 1
    const hasArrow = isLuckyWorkRow && Boolean(arrowImage)
    const valueX = chipX + renderedChipWidth + chipValueGap
    const maxValueWidth = width - horizontalPadding - valueX - (hasArrow ? arrowSize + arrowGap : 0)
    ctx.fillStyle = '#131112'
    ctx.font = valueFont
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    drawEllipsizedText(ctx, value, valueX, centerY, maxValueWidth)

    if (hasArrow) {
      const textWidth = Math.min(ctx.measureText(value).width, maxValueWidth)
      ctx.drawImage(arrowImage, valueX + textWidth + arrowGap, centerY - arrowSize / 2, arrowSize, arrowSize)
    } else if (isLuckyWorkRow) {
      console.warn('[story-card] Arrow not drawn', { hasArrowImage: !!arrowImage })
    }
  })

  debug('[story-card] Canvas rendered with DOM measurements', {
    cardSize: { width, height },
    sections: { heroHeight, blackBoxHeight, bodyHeight },
  })

  ctx.restore()
  return canvas.toDataURL('image/png')
}

/**
 * 카드가 화면에 완전히 그려진 뒤 PNG 를 생성한다. 이미지 로딩 등으로 실패하면 최대 3회 재시도한다.
 */
export async function createStoryCardFinalImage(card) {
  let lastError = null

  for (let attempt = 1; attempt <= MAX_RENDER_ATTEMPTS; attempt += 1) {
    try {
      await waitForStoryCardReady()
      const imageUrl = await createStoryCardShareImage(card)
      if (!imageUrl?.startsWith('data:image/png')) {
        throw new Error('Story card renderer did not return a PNG')
      }

      debug('[story-card] Final PNG ready', { attempt, byteLength: imageUrl.length })
      return imageUrl
    } catch (error) {
      lastError = error
      console.warn('[story-card] Final PNG attempt failed', {
        attempt,
        message: error instanceof Error ? error.message : undefined,
      })
      if (attempt < MAX_RENDER_ATTEMPTS) await waitForDelay(attempt * 400)
    }
  }

  throw lastError ?? new Error('Story card PNG generation failed')
}

export { waitForAnimationFrame }
