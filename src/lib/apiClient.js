import {
  clearWebViewAccessToken,
  getWebViewAccessToken,
} from './webViewAuth.js'

const viteEnv = import.meta.env || {}

const DEFAULT_API_BASE_URL = viteEnv.DEV
  ? 'https://dev.storix.kr'
  : '/api/prod'

function isDevPreviewHost() {
  if (typeof window === 'undefined') return false

  const hostname = window.location.hostname.toLowerCase()
  return hostname.includes('-git-dev-')
}

// URL 쿼리로 API 서버 오버라이드 가능 (예: ?api=dev)
function getApiBaseUrl() {
  const params = new URLSearchParams(window.location.search)
  const apiParam = params.get('api')

  if (apiParam === 'dev') return viteEnv.DEV ? 'https://dev.storix.kr' : '/api/dev'
  if (apiParam === 'prod') return viteEnv.DEV ? 'https://api.storix.kr' : '/api/prod'

  if (viteEnv.VITE_API_BASE_URL) return viteEnv.VITE_API_BASE_URL.replace(/\/$/, '')
  if (isDevPreviewHost()) return '/api/dev'

  return DEFAULT_API_BASE_URL.replace(/\/$/, '')
}

const API_BASE_URL = getApiBaseUrl()

export class ApiError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message, { cause })
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export class AuthenticationRequiredError extends ApiError {
  constructor() {
    super('로그인이 필요합니다.', { status: 401, code: 'AUTH_REQUIRED' })
    this.name = 'AuthenticationRequiredError'
  }
}

async function readJson(response) {
  const text = await response.text()

  if (!text) return null

  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ApiError('서버 응답을 확인할 수 없습니다.', {
      status: response.status,
      code: 'INVALID_JSON',
      cause,
    })
  }
}

async function request(path, { method = 'GET', signal, authenticated, body: requestBody }) {
  const token = authenticated ? getWebViewAccessToken() : null

  if (authenticated && !token) throw new AuthenticationRequiredError()

  let response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(requestBody !== undefined ? { body: JSON.stringify(requestBody) } : {}),
    })
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause

    throw new ApiError('네트워크 연결을 확인해주세요.', {
      code: 'NETWORK_ERROR',
      cause,
    })
  }

  const body = await readJson(response)

  if (!response.ok || body?.isSuccess === false) {
    if (authenticated && response.status === 401) {
      clearWebViewAccessToken()
    }

    throw new ApiError(body?.message || '요청을 처리하지 못했습니다.', {
      status: response.status,
      code: body?.code,
    })
  }

  if (!body || !Object.prototype.hasOwnProperty.call(body, 'result')) {
    throw new ApiError('서버 응답에 result가 없습니다.', {
      status: response.status,
      code: 'INVALID_RESPONSE',
    })
  }

  return body.result
}

export function apiRequest(path, options = {}) {
  return request(path, { ...options, authenticated: true })
}

export function publicApiRequest(path, options = {}) {
  return request(path, { ...options, authenticated: false })
}

export { API_BASE_URL }
