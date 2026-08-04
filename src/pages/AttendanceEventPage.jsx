import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../lib/apiClient.js'
import { getDateKeysInRange } from '../lib/dateKey.js'
import {
  getWebViewAuthSnapshot,
  subscribeToWebViewAuth,
} from '../lib/webViewAuth.js'
import { postStorixWebViewMessage } from '../lib/webViewBridge.js'
import {
  checkInAttendanceEvent,
  getAttendanceEventStatus,
} from '../features/attendance-event/api.js'
import '../attendance-event.css'

const MAX_STAMP_COUNT = 12

function getAttendanceErrorMessage(error) {
  if (!(error instanceof ApiError)) {
    return '출석 처리에 실패했습니다. 잠시 후 다시 시도해주세요.'
  }

  switch (error.status) {
    case 400:
      return '현재 참여할 수 없는 이벤트입니다.'
    case 401:
      return '로그인이 필요합니다. STORIX 앱에서 참여해주세요.'
    case 404:
      return '진행 중인 출석 이벤트가 없습니다.'
    case 409:
      return '오늘 이미 출석했습니다.'
    default:
      return error.code === 'NETWORK_ERROR'
        ? '네트워크 연결을 확인한 뒤 다시 시도해주세요.'
        : '출석 처리에 실패했습니다. 잠시 후 다시 시도해주세요.'
  }
}

export default function AttendanceEventPage() {
  const [authSnapshot, setAuthSnapshot] = useState(getWebViewAuthSnapshot)
  const [status, setStatus] = useState(null)
  const [isStatusLoading, setIsStatusLoading] = useState(false)
  const [isCheckInPending, setIsCheckInPending] = useState(false)
  const [statusError, setStatusError] = useState(null)
  const [checkInFeedback, setCheckInFeedback] = useState(null)
  const checkInControllerRef = useRef(null)

  useEffect(() => {
    const previousTitle = document.title
    document.title = '앱 런칭 기념 출석 이벤트 | STORIX'

    return () => {
      document.title = previousTitle
    }
  }, [])

  useEffect(() => subscribeToWebViewAuth(setAuthSnapshot), [])

  useEffect(() => () => checkInControllerRef.current?.abort(), [])

  const loadStatus = useCallback(async ({ signal, showLoading = true } = {}) => {
    if (showLoading) setIsStatusLoading(true)
    setStatusError(null)

    try {
      const nextStatus = await getAttendanceEventStatus({ signal })
      setStatus(nextStatus)
      return nextStatus
    } catch (error) {
      if (error?.name === 'AbortError') return null

      const message = getAttendanceErrorMessage(error)
      setStatusError(message)

      if (error?.status === 401) {
        postStorixWebViewMessage({ type: 'LOGIN_REQUIRED' })
      } else {
        postStorixWebViewMessage({
          type: 'EVENT_ERROR',
          payload: { code: error?.code, message },
        })
      }

      return null
    } finally {
      if (showLoading) setIsStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authSnapshot.authenticated) {
      setStatus(null)
      setStatusError(null)
      setCheckInFeedback(null)
      setIsStatusLoading(false)
      return undefined
    }

    checkInControllerRef.current?.abort()
    const controller = new AbortController()
    checkInControllerRef.current = controller
    loadStatus({ signal: controller.signal })

    return () => controller.abort()
  }, [authSnapshot.authenticated, authSnapshot.version, loadStatus])

  const stampDates = useMemo(
    () => status
      ? getDateKeysInRange(status.eventStartDate, status.eventEndDate, MAX_STAMP_COUNT)
      : Array.from({ length: MAX_STAMP_COUNT }, () => null),
    [status],
  )

  const attendedDateKeys = useMemo(
    () => new Set(status?.attendedDates || []),
    [status],
  )

  const stampStatus = stampDates.map(
    (dateKey) => dateKey != null && attendedDateKeys.has(dateKey),
  )

  const isCheckInDisabled =
    !authSnapshot.authenticated ||
    isStatusLoading ||
    isCheckInPending ||
    !status ||
    !status.eventActive ||
    status.attendedToday

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back()
      return
    }

    window.location.assign('/')
  }

  const handleCheckIn = async () => {
    if (isCheckInDisabled) return

    const controller = new AbortController()
    setIsCheckInPending(true)
    setCheckInFeedback(null)

    try {
      const result = await checkInAttendanceEvent({ signal: controller.signal })

      setStatus((currentStatus) => currentStatus
        ? {
            ...currentStatus,
            attendedToday: true,
            attendedDates: currentStatus.attendedDates.includes(result.attendedDate)
              ? currentStatus.attendedDates
              : [...currentStatus.attendedDates, result.attendedDate],
            totalAttendedDays: result.totalAttendedDays,
            issuedTickets: result.issuedTickets,
          }
        : currentStatus)

      setCheckInFeedback({
        type: 'success',
        message: result.newlyIssuedTickets > 0
          ? `출석 완료! 응모권 ${result.newlyIssuedTickets}장을 받았습니다.`
          : '오늘 출석이 완료되었습니다.',
      })

      postStorixWebViewMessage({
        type: 'ATTENDANCE_COMPLETED',
        payload: {
          totalAttendedDays: result.totalAttendedDays,
          newlyIssuedTickets: result.newlyIssuedTickets,
          issuedTickets: result.issuedTickets,
        },
      })

      await loadStatus({ showLoading: false })
    } catch (error) {
      if (error?.name === 'AbortError') return

      const message = getAttendanceErrorMessage(error)
      setCheckInFeedback({ type: 'error', message })

      if (error?.status === 409) {
        await loadStatus({ showLoading: false })
      } else if (error?.status === 401) {
        postStorixWebViewMessage({ type: 'LOGIN_REQUIRED' })
      } else {
        postStorixWebViewMessage({
          type: 'EVENT_ERROR',
          payload: { code: error?.code, message },
        })
      }
    } finally {
      if (checkInControllerRef.current === controller) {
        checkInControllerRef.current = null
      }
      setIsCheckInPending(false)
    }
  }

  const buttonLabel = isCheckInPending
    ? '출석 처리 중'
    : status?.attendedToday
      ? '오늘 출석 완료'
      : '오늘치 출석 도장 찍기'
  const isCheckInCompleted = isCheckInPending || status?.attendedToday

  return (
    <main className="attendanceEventPage">
      <header className="attendanceHeader">
        <button
          className="attendanceBackButton"
          type="button"
          onClick={handleBack}
          aria-label="뒤로가기"
        >
          <img src="/events/attendance/back.svg" alt="" />
        </button>
        <h1>앱 런칭 기념 출석 이벤트</h1>
        <span className="attendanceHeaderSpacer" aria-hidden="true" />
      </header>

      <section className="attendanceStampSection">
        <img
          className="attendanceSectionLabel"
          src="/events/attendance/attendance-title.png"
          alt="출석 이벤트"
        />

        <div
          className="attendanceStampBoard"
          aria-label={`${stampStatus.length}일 중 ${stampStatus.filter(Boolean).length}일 출석`}
        >
          {stampStatus.map((isStamped, index) => {
            const dateKey = stampDates[index]
            const dayLabel = dateKey || `${index + 1}일차`

            return (
              <img
                key={dateKey || index}
                className="attendanceStamp"
                src={`/events/attendance/stamp-${isStamped ? 'on' : 'off'}.svg`}
                alt={isStamped ? `${dayLabel} 출석 완료` : `${dayLabel} 미출석`}
              />
            )
          })}
        </div>

        <button
          className={`attendanceCheckInButton${isCheckInCompleted ? ' attendanceCheckInButtonCompleted' : ''}`}
          type="button"
          onClick={handleCheckIn}
          disabled={isCheckInDisabled}
        >
          {isCheckInPending && <span className="attendanceSpinner" aria-hidden="true" />}
          {buttonLabel}
        </button>

        {!authSnapshot.authenticated && (
          <p className="attendanceInlineStatus attendanceInlineStatusAuth" role="status">
            로그인이 필요한 이벤트입니다.<br />STORIX 앱에서 참여해주세요.
          </p>
        )}

        {authSnapshot.authenticated && isStatusLoading && (
          <p className="attendanceInlineStatus" role="status">출석 정보를 불러오고 있습니다.</p>
        )}

        {authSnapshot.authenticated && statusError && (
          <div className="attendanceInlineStatus attendanceInlineStatusError" role="alert">
            <p>{statusError}</p>
            <button type="button" onClick={() => loadStatus()}>다시 시도</button>
          </div>
        )}

        {status && !status.eventActive && !statusError && (
          <p className="attendanceInlineStatus" role="status">종료된 출석 이벤트입니다.</p>
        )}

        {checkInFeedback && (
          <p
            className={`attendanceInlineStatus attendanceInlineStatus${checkInFeedback.type === 'success' ? 'Success' : 'Error'}`}
            role={checkInFeedback.type === 'error' ? 'alert' : 'status'}
          >
            {checkInFeedback.message}
          </p>
        )}
      </section>

      <section className="attendanceDetailSection">
        <div className="attendanceCopyBlock">
          <h2>매일 STORIX에 출석하고<br />웹툰·웹소설 캐시 받아가세요</h2>
          <p>3일, 7일, 12일 출석할수록<br />당첨 확률이 올라갑니다!</p>
        </div>

        <div className="attendanceRewardSection">
          <img
            className="attendanceGiftCard"
            src="/events/attendance/giftCard.png"
            alt="카카오페이지 캐시 또는 리디 캐시 상품권"
          />
          <p className="attendanceRewardDescription">
            총 <strong>5명을 추첨</strong>해<br />
            카카오페이지 캐시 또는 리디 캐시 <strong>2만원권</strong> 지급
          </p>
        </div>
      </section>

      <section className="attendanceNoticeSection">
        <h2>*유의사항</h2>
        <p>• 출석은 1일 1회만 가능합니다.</p>
        <p>• 응모권은 조건 달성 시 자동 지급됩니다.</p>
        <p>• 부정 참여가 확인될 경우 당첨이 취소될 수 있습니다.</p>
        <p>• 이벤트 종료 후 당첨자를 발표합니다.</p>
      </section>
    </main>
  )
}
