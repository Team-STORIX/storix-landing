import {
  clearWebViewAccessToken,
  getWebViewAccessToken,
} from './webViewAuth.js'

// Temporary QA override: restore VITE_API_BASE_URL before production deployment.
const API_BASE_URL = 'https://dev.storix.kr'

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

async function request(path, { method = 'GET', signal, authenticated }) {
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
