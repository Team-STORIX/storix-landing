import { useEffect, useState } from 'react'
import { getPublicAppEvent } from '../features/app-event/api.js'
import { ApiError } from '../lib/apiClient.js'
import { isStorixWebView, postStorixWebViewMessage } from '../lib/webViewBridge.js'
import AttendanceEventPage from './AttendanceEventPage.jsx'
import '../event-router.css'

const PAGES = {
  'attendance-2026-08-10': AttendanceEventPage,
}

const DEFAULT_BY_TYPE = {
  ATTENDANCE: AttendanceEventPage,
}

function closeEventPage() {
  if (isStorixWebView()) {
    postStorixWebViewMessage({ type: 'CLOSE_WEBVIEW' })
    return
  }

  window.location.assign('/')
}

function EventStatePage({ title, description, actionLabel = '확인' }) {
  return (
    <main className="eventStatePage">
      <section className="eventStateCard" role="status">
        <div className="eventStateMark" aria-hidden="true">✦</div>
        <h1>{title}</h1>
        <p>{description}</p>
        <button type="button" onClick={closeEventPage}>{actionLabel}</button>
      </section>
    </main>
  )
}

function EventEndedPage({ event }) {
  return (
    <EventStatePage
      title="종료된 이벤트입니다"
      description={`${event.name} 이벤트가 종료되었습니다.`}
    />
  )
}

function EventFallbackPage() {
  return (
    <EventStatePage
      title="이벤트 페이지를 준비 중입니다"
      description="현재 버전에서 지원하지 않는 이벤트입니다. 잠시 후 다시 확인해주세요."
    />
  )
}

export default function AppEventRouter({ appEventId }) {
  const [state, setState] = useState({ status: 'loading', event: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', event: null, error: null })

    getPublicAppEvent(appEventId, { signal: controller.signal })
      .then((event) => setState({ status: 'ready', event, error: null }))
      .catch((error) => {
        if (error?.name === 'AbortError') return
        setState({ status: 'error', event: null, error })
      })

    return () => controller.abort()
  }, [appEventId])

  if (state.status === 'loading') {
    return (
      <main className="eventStatePage">
        <div className="eventLoading" role="status" aria-label="이벤트 불러오는 중" />
      </main>
    )
  }

  if (state.status === 'error') {
    const isNotFound = state.error instanceof ApiError && state.error.status === 404
    return (
      <EventStatePage
        title={isNotFound ? '이벤트를 찾을 수 없습니다' : '이벤트를 불러오지 못했습니다'}
        description={isNotFound
          ? '존재하지 않거나 아직 시작하지 않은 이벤트입니다.'
          : '네트워크 상태를 확인한 뒤 다시 접속해주세요.'}
      />
    )
  }

  const event = state.event

  if (event.status === 'ENDED' || event.status === 'CANCELED') {
    return <EventEndedPage event={event} />
  }

  if (event.status !== 'ACTIVE') {
    return (
      <EventStatePage
        title="아직 시작하지 않은 이벤트입니다"
        description="이벤트 시작 후 다시 참여해주세요."
      />
    )
  }

  const Page = PAGES[event.pageKey] ?? DEFAULT_BY_TYPE[event.eventType] ?? EventFallbackPage
  return <Page appEventId={appEventId} event={event} />
}
