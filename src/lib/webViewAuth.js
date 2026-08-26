const AUTH_EVENT_NAME = 'STORIX_AUTH'

function normalizeAccessToken(token) {
  return typeof token === 'string' && token.trim() ? token.trim() : null
}

const injectedAuth = typeof window !== 'undefined'
  ? window.__STORIX_AUTH__
  : null

let accessToken = normalizeAccessToken(injectedAuth?.accessToken)
let version = 0
const subscribers = new Set()

function createAbortError() {
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError')
  }

  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function getSnapshot() {
  return {
    authenticated: Boolean(accessToken),
    version,
  }
}

function notifySubscribers() {
  const snapshot = getSnapshot()
  subscribers.forEach((subscriber) => subscriber(snapshot))
}

export function setWebViewAccessToken(token) {
  const nextToken = normalizeAccessToken(token)

  if (nextToken === accessToken) return

  accessToken = nextToken
  version += 1
  notifySubscribers()
}

export function clearWebViewAccessToken() {
  setWebViewAccessToken(null)
}

export function getWebViewAccessToken() {
  return accessToken
}

export function getWebViewAuthSnapshot() {
  return getSnapshot()
}

export function subscribeToWebViewAuth(subscriber) {
  subscribers.add(subscriber)
  return () => subscribers.delete(subscriber)
}

export function waitForWebViewAccessToken({
  previousToken = null,
  signal,
  timeoutMs = 10000,
} = {}) {
  const currentToken = getWebViewAccessToken()

  if (currentToken && currentToken !== previousToken) {
    return Promise.resolve(currentToken)
  }

  if (signal?.aborted) {
    return Promise.reject(createAbortError())
  }

  return new Promise((resolve, reject) => {
    let timeoutId = null

    const cleanup = () => {
      unsubscribe()
      signal?.removeEventListener('abort', handleAbort)
      if (timeoutId != null) window.clearTimeout(timeoutId)
    }

    const handleAbort = () => {
      cleanup()
      reject(createAbortError())
    }

    const unsubscribe = subscribeToWebViewAuth(() => {
      const nextToken = getWebViewAccessToken()
      if (!nextToken || nextToken === previousToken) return

      cleanup()
      resolve(nextToken)
    })

    if (signal) {
      signal.addEventListener('abort', handleAbort, { once: true })
    }

    timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for refreshed accessToken.'))
    }, timeoutMs)
  })
}

function handleAuthEvent(event) {
  setWebViewAccessToken(event?.detail?.accessToken)
}

if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_EVENT_NAME, handleAuthEvent)

  if (typeof window.ReactNativeWebView?.postMessage === 'function') {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'WEBVIEW_READY',
    }))
  }
}

export { AUTH_EVENT_NAME }
