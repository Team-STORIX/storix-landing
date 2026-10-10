import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getWebViewAuthSnapshot,
  subscribeToWebViewAuth,
} from '../lib/webViewAuth.js'
import {
  closeEventPage,
  isStorixWebView,
  postStorixWebViewMessage,
  reportEventError,
} from '../lib/webViewBridge.js'
import {
  confirmAppEvent,
  drawStoryCardEvent,
  getAppEventModalRequired,
  getStoryCardEventStatus,
  searchStoryCardLuckyWorkId,
} from '../features/story-card-event/api.js'
import {
  formatStoryCardDate,
  getLuckyWorkId,
  getLuckyWorkLabel,
  getStoryCardMessageLines,
  STORY_CARD_FALLBACK_MESSAGE,
} from '../features/story-card-event/storyCard.js'
import {
  createStoryCardFinalImage,
  waitForAnimationFrame,
} from '../features/story-card-event/storyCardImage.js'
import { useCardShare } from '../features/story-card-event/useCardShare.js'
import '../story-card-event.css'

const SHARE_MESSAGE = 'STORIX 오늘의 스토리 카드'
const DOCUMENT_TITLE = '오늘의 스토리 카드 이벤트 | STORIX'
const DOCUMENT_CLASS = 'storyCardDocument'

const STORY_CARD_CHOICES = [
  { key: 'left', label: '왼쪽 카드', videoSrc: '/events/story-card/left.mp4?v=20260902' },
  { key: 'center', label: '가운데 카드', videoSrc: '/events/story-card/centre.mp4?v=20260902' },
  { key: 'right', label: '오른쪽 카드', videoSrc: '/events/story-card/right.mp4?v=20260902' },
]

const isDev = import.meta.env.DEV

const preloadedVideoSources = new Set()

function preloadStoryCardVideo(src) {
  if (typeof document === 'undefined' || preloadedVideoSources.has(src)) return

  preloadedVideoSources.add(src)
  const link = document.createElement('link')
  link.rel = 'preload'
  link.as = 'video'
  link.href = src
  document.head.appendChild(link)
}

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

/** 스토리 카드 페이지는 뒤로가기 대신 항상 웹뷰 닫기 / 랜딩 홈으로 보낸다. */
const handleClose = () => closeEventPage({ useHistory: false })

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

/**
 * 결과 카드의 PNG 를 카드 객체 단위로 캐시한다.
 * 같은 카드에 대한 동시 요청은 한 번만 렌더링하고 그 Promise 를 공유한다.
 */
function useFinalCardImage(card, enabled) {
  const imageRef = useRef({ card: null, url: '' })
  const promiseRef = useRef({ card: null, promise: null })

  const render = (targetCard) => {
    const promise = createStoryCardFinalImage(targetCard)
    promiseRef.current = { card: targetCard, promise }

    return promise.finally(() => {
      if (promiseRef.current.promise === promise) {
        promiseRef.current = { card: null, promise: null }
      }
    })
  }

  const getFinalCardImage = async (targetCard) => {
    if (!targetCard) throw new Error('Story card data is unavailable')
    if (imageRef.current.card === targetCard && imageRef.current.url) {
      return imageRef.current.url
    }
    if (promiseRef.current.card === targetCard && promiseRef.current.promise) {
      return promiseRef.current.promise
    }

    const url = await render(targetCard)
    imageRef.current = { card: targetCard, url }
    return url
  }

  // 카드가 화면에 나타나면 미리 렌더링해 저장/공유 지연을 줄인다.
  useEffect(() => {
    imageRef.current = { card: null, url: '' }
    promiseRef.current = { card: null, promise: null }
    if (!enabled || !card) return undefined

    let cancelled = false
    render(card)
      .then((url) => {
        if (!cancelled) imageRef.current = { card, url }
      })
      .catch((error) => {
        if (cancelled) return
        console.error('[story-card] Initial final PNG generation failed', {
          message: error instanceof Error ? error.message : undefined,
        })
      })

    return () => {
      cancelled = true
    }
  }, [enabled, card])

  return getFinalCardImage
}

export default function StoryCardEventPage({ appEventId = null, event = null }) {
  const [authSnapshot, setAuthSnapshot] = useState(getWebViewAuthSnapshot)
  const [selectedChoice, setSelectedChoice] = useState(null)
  const [drawStatus, setDrawStatus] = useState('idle')
  const [drawnCard, setDrawnCard] = useState(null)
  const [saveModalVisible, setSaveModalVisible] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [entered, setEntered] = useState(false)
  const [guideMode, setGuideMode] = useState('entry')
  const drawControllerRef = useRef(null)
  const statusControllerRef = useRef(null)
  const modalRequiredControllerRef = useRef(null)
  const animationEndedRef = useRef(false)
  const drawFailedRef = useRef(false)
  const isIOS = isIOSDevice()
  const { saveToGallery, shareImage, shareToTwitter, isMediaBusy } = useCardShare()

  const showCardFront = drawStatus === 'done' && drawnCard
  const getFinalCardImage = useFinalCardImage(drawnCard, Boolean(showCardFront))

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

  useEffect(() => {
    const previousTitle = document.title
    document.title = DOCUMENT_TITLE
    document.documentElement.classList.add(DOCUMENT_CLASS)

    return () => {
      document.title = previousTitle
      document.documentElement.classList.remove(DOCUMENT_CLASS)
    }
  }, [])

  // 진입 시 안내 모달 노출 여부 확인. 인증/이벤트가 바뀌면 처음부터 다시 시작한다.
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
        if (modalRequired) {
          window.requestAnimationFrame(() => {
            confirmAppEvent(normalizedAppEventId).catch((error) => {
              if (isDev) {
                console.warn('[story-card] app event confirm failed', {
                  status: error?.status,
                  code: error?.code,
                  message: error instanceof Error ? error.message : undefined,
                })
              }
            })
          })
        }
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

  // 이미 오늘 카드를 뽑았으면 결과 카드를 바로 보여준다.
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
        reportEventError(error, `스토리카드 상태 조회 실패${error?.status ? ` (${error.status})` : ''}`)
      })
      .finally(() => {
        if (statusControllerRef.current === controller) {
          statusControllerRef.current = null
        }
      })

    return () => controller.abort()
  }, [entered, authSnapshot.version])

  useEffect(() => {
    if (!entered || drawnCard) return
    STORY_CARD_CHOICES.forEach((choice) => preloadStoryCardVideo(choice.videoSrc))
  }, [entered, drawnCard])

  const closeGuide = () => {
    setShowGuide(false)
    if (guideMode !== 'help') setEntered(true)
  }

  const handleHelpClick = () => {
    setGuideMode(showCardFront ? 'resultHelp' : 'help')
    setShowGuide(true)
  }

  const resetDraw = () => {
    setSelectedChoice(null)
    setDrawnCard(null)
    setDrawStatus('idle')
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
      await waitForAnimationFrame()
      const nextCard = await drawStoryCardEvent({ signal: controller.signal })
      setDrawnCard(nextCard)
      if (animationEndedRef.current) {
        setDrawStatus('done')
      }
    } catch (error) {
      drawFailedRef.current = true
      reportEventError(error, `스토리카드 발급 실패${error?.status ? ` (${error.status})` : ''}`)
      if (animationEndedRef.current) {
        resetDraw()
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
      resetDraw()
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
    try {
      return await getFinalCardImage(drawnCard)
    } catch (error) {
      console.error('[story-card] Final PNG unavailable', {
        message: error instanceof Error ? error.message : undefined,
        stack: error instanceof Error ? error.stack : undefined,
      })
      return null
    }
  }

  const handleSave = () => {
    void saveToGallery(captureCard, () => setSaveModalVisible(true))
  }

  const handleShare = () => {
    void shareImage(captureCard, SHARE_MESSAGE)
  }

  const handleTwitterShare = () => {
    void shareToTwitter(captureCard, SHARE_MESSAGE)
  }

  const resultAiImageUrl = drawnCard?.aiImageUrl?.trim() || drawnCard?.imageUrl?.trim() || ''
  const resultBackgroundImageUrl = drawnCard?.backgroundImageUrl?.trim() || ''
  const resultIconImageUrl = drawnCard?.iconImageUrl?.trim() || ''
  const resultDateLabel = formatStoryCardDate(drawnCard?.drawnOn)
  const resultMessageLines = getStoryCardMessageLines(drawnCard)
  const luckyWorkId = getLuckyWorkId(drawnCard?.luckyWork)
  const luckyWorkLabel = getLuckyWorkLabel(drawnCard?.luckyWork)

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
      if (isDev) {
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

  const isRevealing = drawStatus === 'drawing' || drawStatus === 'revealing'

  return (
    <main className={`storyCardEventPage${showCardFront ? ' storyCardEventPage-front' : ''}`}>
      <header className="storyCardTopBar">
        <button
          className="storyCardTopBarIconButton"
          type="button"
          aria-label="뒤로가기"
          onClick={handleClose}
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
                disabled={isRevealing}
              >
                <img
                  src="/events/story-card/single-card.png"
                  alt=""
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>

          <div className="storyCardVideoPreload" aria-hidden="true">
            {STORY_CARD_CHOICES.map((choice) => (
              <video
                key={choice.videoSrc}
                src={choice.videoSrc}
                muted
                playsInline
                preload="auto"
                webkit-playsinline="true"
              />
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
                  : STORY_CARD_FALLBACK_MESSAGE}
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
              disabled={isMediaBusy}
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
              disabled={isMediaBusy}
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
                disabled={isMediaBusy}
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
          onClick={closeGuide}
        >
          {guideMode === 'resultHelp' ? (
            <section
              className="storyCardGuideModal storyCardGuideModal-result"
              role="dialog"
              aria-modal="true"
              aria-label="오늘의 스토리 카드 안내"
              onClick={(clickEvent) => clickEvent.stopPropagation()}
            >
              <img
                className="storyCardGuideImage"
                src="/events/story-card/popup-ok.png?v=20260901b"
                alt="오늘의 스토리 카드 안내"
              />
              <button
                className="storyCardGuideAction storyCardGuideAction-result"
                type="button"
                aria-label="확인"
                onClick={closeGuide}
              />
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
                onClick={closeGuide}
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
