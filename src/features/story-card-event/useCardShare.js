import { useCallback, useState } from 'react'
import {
  createProfileCardShare,
  postProfileCardImagePresignedUrl,
  uploadProfileCardImage,
} from './profileCardShareApi.js'
import {
  isStorixWebView,
  postStorixWebViewMessage,
} from '../../lib/webViewBridge.js'

const SHARE_MESSAGE = 'STORIX 오늘의 스토리 카드'
const STORIX_SHARE_URL = 'https://www.storix.kr/'
const TWITTER_WEB_INTENT_URL = 'https://twitter.com/intent/tweet'

export function useCardShare() {
  const [isSaving, setIsSaving] = useState(false)
  const [isSharing, setIsSharing] = useState(false)

  const saveToGallery = useCallback(async (
    captureImage,
    onSuccess,
    message = SHARE_MESSAGE,
    analytics,
  ) => {
    try {
      setIsSaving(true)

      const image = await captureImage()
      if (!image) {
        window.alert('이미지를 생성할 수 없습니다.')
        return
      }

      if (isStorixWebView()) {
        await saveImageWithNativeBridge(image)
      } else {
        if (typeof image !== 'string') {
          window.alert('이미지를 생성할 수 없습니다.')
          return
        }
        downloadUri(image, 'storix-story-card.png')
      }
      await trackCardExport(analytics)
      onSuccess?.()
    } catch (error) {
      console.error('Save to gallery error:', error)
      window.alert('이미지 저장 중 오류가 발생했습니다.')
    } finally {
      setIsSaving(false)
    }
  }, [])

  const shareImage = useCallback(async (
    captureImage,
    message = SHARE_MESSAGE,
    analytics,
  ) => {
    try {
      setIsSharing(true)

      const image = await captureImage()
      if (!image) {
        window.alert('이미지를 생성할 수 없습니다.')
        return
      }

      if (isStorixWebView()) {
        await shareImageWithNativeBridge(image, message, 'default')
        await trackCardShareSheet(analytics)
        return
      }

      if (typeof image !== 'string') {
        window.alert('이미지를 생성할 수 없습니다.')
        return
      }

      const file = await dataUriToFile(image, 'storix-story-card.png')
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: message,
          text: getShareMessage(message),
          files: [file],
        })
        await trackCardShareSheet(analytics)
        return
      }

      if (navigator.share) {
        await navigator.share({
          title: message,
          text: getShareMessage(message),
          url: STORIX_SHARE_URL,
        })
        await trackCardShareSheet(analytics)
        return
      }

      downloadUri(image, 'storix-story-card.png')
      await trackCardShareSheet(analytics)
    } catch (error) {
      console.error('Share error:', error)
      window.alert('이미지 공유 중 오류가 발생했습니다.')
    } finally {
      setIsSharing(false)
    }
  }, [])

  const shareToTwitter = useCallback(async (
    captureImage,
    message = SHARE_MESSAGE,
    analytics,
  ) => {
    try {
      setIsSharing(true)

      const image = await captureImage()
      if (isStorixWebView() && image) {
        await shareImageWithNativeBridge(image, message, 'twitter')
        await trackTwitterShare(analytics)
        return
      }

      const shareUrl =
        typeof image === 'string' ? await createWebShareUrlSafely(image) : undefined
      openTwitterWebIntent(shareUrl, message)
      await trackTwitterShare(analytics)
    } catch (error) {
      console.error('Twitter share error:', error)
      openTwitterWebIntent(undefined, message)
    } finally {
      setIsSharing(false)
    }
  }, [])

  return {
    saveToGallery,
    shareImage,
    shareToTwitter,
    isSaving,
    isSharing,
  }
}

function saveImageWithNativeBridge(image) {
  const payload = getNativeImagePayload(image)
  if (!payload) return Promise.reject(new Error('Invalid native image payload'))

  return sendImageActionWithNativeBridge(
    'SAVE_STORY_CARD_IMAGE',
    'SAVE_STORY_CARD_IMAGE_RESULT',
    payload,
  )
}

function shareImageWithNativeBridge(image, message, target) {
  const payload = getNativeImagePayload(image)
  if (!payload) return Promise.reject(new Error('Invalid native image payload'))

  return sendImageActionWithNativeBridge(
    'SHARE_STORY_CARD_IMAGE',
    'SHARE_STORY_CARD_IMAGE_RESULT',
    { ...payload, message, target },
  )
}

function getNativeImagePayload(image) {
  if (typeof image === 'string') return { uri: image }
  if (image?.rect) return { rect: image.rect }
  return null
}

function sendImageActionWithNativeBridge(type, resultType, payload) {
  return new Promise((resolve, reject) => {
    const requestId = `story-card-${type.toLowerCase()}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`

    const cleanup = () => {
      window.removeEventListener('message', handleMessage)
      window.removeEventListener('STORIX_NATIVE_MESSAGE', handleNativeMessage)
      window.clearTimeout(timeoutId)
      payload.cleanup?.()
    }

    const handleResult = (rawData) => {
      try {
        const message =
          typeof rawData === 'string' ? JSON.parse(rawData) : rawData

        if (
          message?.type !== resultType ||
          message?.payload?.requestId !== requestId
        ) {
          return
        }

        cleanup()
        if (message.payload.success) resolve()
        else reject(new Error(`Native ${type} failed`))
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
      reject(new Error(`Native ${type} timed out`))
    }, 15000)

    window.addEventListener('message', handleMessage)
    window.addEventListener('STORIX_NATIVE_MESSAGE', handleNativeMessage)

    const sent = postStorixWebViewMessage({
      type,
      payload: { requestId, ...withoutCleanup(payload) },
    })

    if (!sent) {
      cleanup()
      reject(new Error('Native bridge unavailable'))
    }
  })
}

function withoutCleanup(payload) {
  const { cleanup, ...nativePayload } = payload
  return nativePayload
}

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

  await uploadProfileCardImage({
    url: presigned.url,
    uri,
    contentType,
  })

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
  const query = shareUrl
    ? `text=${text}&url=${encodeURIComponent(shareUrl)}`
    : `text=${text}`

  window.open(`${TWITTER_WEB_INTENT_URL}?${query}`, '_blank', 'noopener,noreferrer')
}

async function trackCardExport(analytics) {
  if (!analytics) return
}

async function trackCardShareSheet(analytics) {
  if (!analytics) return
}

async function trackTwitterShare(analytics) {
  if (!analytics) return
  await trackCardShareSheet(analytics)
}
