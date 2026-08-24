import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getWebViewAccessToken,
  getWebViewAuthSnapshot,
  subscribeToWebViewAuth,
} from '../lib/webViewAuth.js'
import {
  isStorixWebView,
  postStorixWebViewMessage,
} from '../lib/webViewBridge.js'
import {
  drawStoryCardEvent,
  getStoryCardEventStatus,
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

function getGuideSeen(key) {
  try {
    return window.localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function setGuideSeen(key) {
  try {
    window.localStorage.setItem(key, 'true')
  } catch {
    // Ignore storage failures; the upcoming account-level API will own this.
  }
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
    imageUrl: '',
    message: '나만의 스토리 카드',
    messageLines: [],
    immersion: '',
    luckyWork: null,
  }
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

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export default function StoryCardEventPage({ appEventId = null, event = null }) {
  const [authSnapshot, setAuthSnapshot] = useState(getWebViewAuthSnapshot)
  const [selectedChoice, setSelectedChoice] = useState(null)
  const [drawStatus, setDrawStatus] = useState('idle')
  const [drawnCard, setDrawnCard] = useState(null)
  const [saveModalVisible, setSaveModalVisible] = useState(false)
  const drawControllerRef = useRef(null)
  const statusControllerRef = useRef(null)
  const animationEndedRef = useRef(false)
  const drawFailedRef = useRef(false)
  const isIOS = isIOSDevice()
  const { saveToGallery, shareImage, shareToTwitter, isSaving, isSharing } =
    useCardShare()

  useEffect(() => subscribeToWebViewAuth(setAuthSnapshot), [])

  useEffect(() => () => {
    drawControllerRef.current?.abort()
    statusControllerRef.current?.abort()
  }, [])

  const selectedChoiceConfig = useMemo(
    () => STORY_CARD_CHOICES.find((choice) => choice.key === selectedChoice) ?? null,
    [selectedChoice],
  )

  const guideStorageKey = useMemo(() => {
    const eventKey = appEventId ?? event?.id ?? event?.pageKey ?? 'default'
    const accountKey = getAccountStorageKeyPart(getWebViewAccessToken())
    return `storix:story-card-guide-seen:${accountKey}:${eventKey}`
  }, [appEventId, event?.id, event?.pageKey, authSnapshot.version])

  const [showGuide, setShowGuide] = useState(() => !getGuideSeen(guideStorageKey))
  const [entered, setEntered] = useState(() => getGuideSeen(guideStorageKey))
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
    const seen = getGuideSeen(guideStorageKey)
    setShowGuide(!seen)
    setEntered(seen)
    setGuideMode('entry')
  }, [guideStorageKey])

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
      .catch(() => undefined)
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

    setGuideSeen(guideStorageKey)
    setShowGuide(false)
    closeEventPage()
  }

  const handleStartClick = () => {
    if (guideMode === 'help') {
      setShowGuide(false)
      return
    }

    setGuideSeen(guideStorageKey)
    setShowGuide(false)
    setEntered(true)
  }

  const handleHelpClick = () => {
    setGuideMode('help')
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
    } catch {
      drawFailedRef.current = true
      if (animationEndedRef.current) {
        setDrawnCard(createFallbackStoryCard())
        setDrawStatus('done')
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
      setDrawnCard(createFallbackStoryCard())
      setDrawStatus('done')
      return
    }

    if (drawnCard) {
      setDrawStatus('done')
    }
  }

  const handleSave = () => {
    void saveToGallery(captureCard, () => setSaveModalVisible(true), 'STORIX 오늘의 스토리 카드')
  }

  const handleShare = () => {
    void shareImage(captureCard, 'STORIX 오늘의 스토리 카드')
  }

  const handleTwitterShare = () => {
    void shareToTwitter(captureCard, 'STORIX 오늘의 스토리 카드')
  }

  const captureCard = async () => {
    if (drawnCard?.imageUrl?.trim()) return drawnCard.imageUrl.trim()
    return createFallbackCardDataUrl(drawnCard)
  }

  const showCardFront = drawStatus === 'done' && drawnCard

  return (
    <main className={`storyCardEventPage${showCardFront ? ' storyCardEventPage-front' : ''}`}>
      <header className="storyCardTopBar">
        <button
          className="storyCardTopBarIconButton"
          type="button"
          aria-label="홈으로 돌아가기"
          onClick={closeEventPage}
        >
          <img
            src={showCardFront ? '/events/story-card/icon-x.png' : '/events/story-card/icon-arrow-back.svg'}
            alt=""
            aria-hidden="true"
          />
        </button>
        <h1 className="storyCardTopBarTitle">오늘의 스토리카드</h1>
        <button
          className="storyCardTopBarIconButton"
          type="button"
          aria-label="도움말"
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
            {drawnCard.imageUrl ? (
              <img src={drawnCard.imageUrl} alt="" />
            ) : (
              <div className="storyCardFrontFallback">
                <strong>{drawnCard.genre || '오늘의 카드'}</strong>
                <span>{drawnCard.message || '나만의 스토리 카드'}</span>
              </div>
            )}
          </article>

          <div className={`storyCardShareActions${isIOS ? ' storyCardShareActions-ios' : ''}`}>
            <button
              className="storyCardShareAction"
              type="button"
              onClick={handleSave}
              disabled={isSaving}
            >
              <span className="storyCardShareActionCircle">
                {isSaving ? (
                  <span className="storyCardActionSpinner" aria-hidden="true" />
                ) : (
                  <img src="/events/story-card/icon-download.svg" alt="" aria-hidden="true" />
                )}
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
                {isSharing ? (
                  <span className="storyCardActionSpinner" aria-hidden="true" />
                ) : (
                  <img src="/events/story-card/icon-share.svg" alt="" aria-hidden="true" />
                )}
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
                  {isSharing ? (
                    <span className="storyCardActionSpinner" aria-hidden="true" />
                  ) : (
                    <XLogo size={20} color="#131112" />
                  )}
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
            onEnded={handleAnimationEnded}
          />
        </div>
      ) : null}

      {showGuide ? (
        <div
          className="storyCardGuideBackdrop"
          role="presentation"
          onClick={handleBackdropClick}
        >
          <section
            className="storyCardGuideModal"
            role="dialog"
            aria-modal="true"
            aria-label="오늘의 스토리 카드 안내"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
          >
            <img
              className="storyCardGuideImage"
              src="/events/story-card/storycard-popup.png"
              alt="오늘의 스토리 카드 안내"
            />
            <button
              className="storyCardGuideAction"
              type="button"
              aria-label="카드 고르러 가기"
              onClick={handleStartClick}
            />
          </section>
        </div>
      ) : null}

      {saveModalVisible ? (
        <div className="storyCardSaveModalBackdrop" role="presentation">
          <section
            className="storyCardSaveModal"
            role="dialog"
            aria-modal="true"
            aria-label="저장 완료"
          >
            <img
              src="/events/story-card/image-gallery-saved.svg"
              alt="이미지가 저장되었습니다."
            />
            <button type="button" onClick={() => setSaveModalVisible(false)}>
              확인
            </button>
          </section>
        </div>
      ) : null}
    </main>
  )
}
