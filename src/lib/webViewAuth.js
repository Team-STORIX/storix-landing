const AUTH_EVENT_NAME = 'STORIX_AUTH'

let accessToken = null
let version = 0
const subscribers = new Set()

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
  const nextToken = typeof token === 'string' && token.trim() ? token.trim() : null

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

function handleAuthEvent(event) {
  setWebViewAccessToken(event?.detail?.accessToken)
}

if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_EVENT_NAME, handleAuthEvent)
}

export { AUTH_EVENT_NAME }
