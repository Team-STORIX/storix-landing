import { useCallback, useState } from 'react'
import {
  createProfileCardShare,
  postProfileCardImagePresignedUrl,
  uploadProfileCardImage,
} from './profileCardShareApi.js'

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

      const uri = await captureImage()
      if (!uri) {
        window.alert('이미지를 생성할 수 없습니다.')
        return
      }

      downloadUri(uri, 'storix-story-card.png')
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

      const uri = await captureImage()
      if (!uri) {
        window.alert('이미지를 생성할 수 없습니다.')
        return
      }

      const shareData = {
        title: message,
        text: getShareMessage(message),
        url: STORIX_SHARE_URL,
      }

      if (navigator.share) {
        await navigator.share(shareData)
        await trackCardShareSheet(analytics)
        return
      }

      downloadUri(uri, 'storix-story-card.png')
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

      const uri = await captureImage()
      const shareUrl = uri ? await createWebShareUrlSafely(uri) : undefined
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

function downloadUri(uri, filename) {
  const anchor = document.createElement('a')
  anchor.href = uri
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
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
