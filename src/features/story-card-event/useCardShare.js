import { useCallback, useRef, useState } from 'react'
import {
  createProfileCardShare,
  postProfileCardImagePresignedUrl,
  uploadProfileCardImage,
} from './profileCardShareApi.js'
import { isStorixWebView, requestNativeAction } from '../../lib/webViewBridge.js'

const SHARE_MESSAGE = 'STORIX 오늘의 스토리 카드'
const STORIX_SHARE_URL = 'https://www.storix.kr/'
const TWITTER_WEB_INTENT_URL = 'https://twitter.com/intent/tweet'
const DOWNLOAD_FILENAME = 'storix-story-card.png'
const INVALID_IMAGE_MESSAGE = '이미지를 생성할 수 없습니다.'

/**
 * 스토리 카드 이미지 저장 / 공유 / X 공유.
 * captureImage 는 PNG data URL 을 돌려주는 비동기 함수다.
 * 앱 웹뷰에서는 네이티브 브릿지로, 브라우저에서는 Web Share / 다운로드로 처리한다.
 */
export function useCardShare() {
  const [isSaving, setIsSaving] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const mediaRequestInFlightRef = useRef(false)

  /** 저장/공유가 동시에 두 번 돌지 않도록 감싼다. */
  const runExclusive = useCallback(async (setBusy, task) => {
    if (mediaRequestInFlightRef.current) return
    mediaRequestInFlightRef.current = true
    setBusy(true)

    try {
      await task()
    } finally {
      setBusy(false)
      mediaRequestInFlightRef.current = false
    }
  }, [])

  const saveToGallery = useCallback(
    (captureImage, onSuccess) =>
      runExclusive(setIsSaving, async () => {
        try {
          const image = await captureImage()
          if (!image) {
            window.alert(INVALID_IMAGE_MESSAGE)
            return
          }

          if (isStorixWebView()) {
            await saveImageWithNativeBridge(image)
          } else {
            if (typeof image !== 'string') {
              window.alert(INVALID_IMAGE_MESSAGE)
              return
            }
            downloadUri(image, DOWNLOAD_FILENAME)
          }
          onSuccess?.()
        } catch (error) {
          console.error('Save to gallery error:', error)
          window.alert('이미지 저장 중 오류가 발생했습니다.')
        }
      }),
    [runExclusive],
  )

  const shareImage = useCallback(
    (captureImage, message = SHARE_MESSAGE) =>
      runExclusive(setIsSharing, async () => {
        try {
          const image = await captureImage()
          if (!image) {
            window.alert(INVALID_IMAGE_MESSAGE)
            return
          }

          if (isStorixWebView()) {
            await shareImageWithNativeBridge(image, message, 'default')
            return
          }

          if (typeof image !== 'string') {
            window.alert(INVALID_IMAGE_MESSAGE)
            return
          }

          const file = await dataUriToFile(image, DOWNLOAD_FILENAME)
          if (file && navigator.canShare?.({ files: [file] })) {
            await navigator.share({ title: message, text: getShareMessage(message), files: [file] })
            return
          }

          if (navigator.share) {
            await navigator.share({ title: message, text: getShareMessage(message), url: STORIX_SHARE_URL })
            return
          }

          downloadUri(image, DOWNLOAD_FILENAME)
        } catch (error) {
          console.error('Share error:', error)
          window.alert('이미지 공유 중 오류가 발생했습니다.')
        }
      }),
    [runExclusive],
  )

  const shareToTwitter = useCallback(
    (captureImage, message = SHARE_MESSAGE) =>
      runExclusive(setIsSharing, async () => {
        try {
          const image = await captureImage()
          if (isStorixWebView() && image) {
            await shareImageWithNativeBridge(image, message, 'twitter')
            return
          }

          const shareUrl = typeof image === 'string' ? await createWebShareUrlSafely(image) : undefined
          openTwitterWebIntent(shareUrl, message)
        } catch (error) {
          console.error('Twitter share error:', error)
          openTwitterWebIntent(undefined, message)
        }
      }),
    [runExclusive],
  )

  return {
    saveToGallery,
    shareImage,
    shareToTwitter,
    isSaving,
    isSharing,
    isMediaBusy: isSaving || isSharing,
  }
}

// ---------- native bridge ----------

function getNativeImagePayload(image) {
  if (typeof image === 'string') return { uri: image }
  return null
}

function sendImageActionWithNativeBridge(type, resultType, payload) {
  return requestNativeAction({
    type,
    resultType,
    requestIdPrefix: `story-card-${type.toLowerCase()}`,
    payload,
  })
}

function saveImageWithNativeBridge(image) {
  const payload = getNativeImagePayload(image)
  if (!payload) return Promise.reject(new Error('Invalid native image payload'))

  return sendImageActionWithNativeBridge('SAVE_STORY_CARD_IMAGE', 'SAVE_STORY_CARD_IMAGE_RESULT', payload)
}

function shareImageWithNativeBridge(image, message, target) {
  const payload = getNativeImagePayload(image)
  if (!payload) return Promise.reject(new Error('Invalid native image payload'))

  return sendImageActionWithNativeBridge('SHARE_STORY_CARD_IMAGE', 'SHARE_STORY_CARD_IMAGE_RESULT', {
    ...payload,
    message,
    target,
  })
}

// ---------- browser fallbacks ----------

function downloadUri(uri, filename) {
  const anchor = document.createElement('a')
  anchor.href = uri
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

async function dataUriToFile(uri, filename) {
  if (!uri.startsWith('data:image/')) return null

  const response = await fetch(uri)
  const blob = await response.blob()
  return new File([blob], filename, { type: blob.type || 'image/png' })
}

function getShareMessage(message) {
  return `${message} ${STORIX_SHARE_URL}`
}

async function uploadProfileCardForWebShare(uri) {
  const contentType = 'image/png'
  const presigned = await postProfileCardImagePresignedUrl(contentType)

  await uploadProfileCardImage({ url: presigned.url, uri, contentType })

  const share = await createProfileCardShare(presigned.objectKey)
  return share.shareUrl
}

async function createWebShareUrlSafely(uri) {
  try {
    return await uploadProfileCardForWebShare(uri)
  } catch (error) {
    if (import.meta.env.DEV) {
      console.log('[cardShare] web share URL creation failed', {
        message: error instanceof Error ? error.message : undefined,
      })
    }
    return undefined
  }
}

function openTwitterWebIntent(shareUrl, message = SHARE_MESSAGE) {
  const text = encodeURIComponent(getShareMessage(message))
  const query = shareUrl ? `text=${text}&url=${encodeURIComponent(shareUrl)}` : `text=${text}`

  window.open(`${TWITTER_WEB_INTENT_URL}?${query}`, '_blank', 'noopener,noreferrer')
}
