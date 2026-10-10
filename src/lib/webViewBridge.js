export function postStorixWebViewMessage(message) {
  const bridge = window.ReactNativeWebView

  if (typeof bridge?.postMessage !== 'function') return false

  try {
    bridge.postMessage(JSON.stringify(message))
    return true
  } catch {
    return false
  }
}

export function isStorixWebView() {
  return typeof window.ReactNativeWebView?.postMessage === 'function'
}

/**
 * 이벤트 페이지를 닫는다.
 * 앱 웹뷰에서는 네이티브에 CLOSE_WEBVIEW 를 보내고,
 * 브라우저에서는 (옵션에 따라) 뒤로가기 또는 랜딩 홈으로 이동한다.
 */
export function closeEventPage({ useHistory = true } = {}) {
  if (isStorixWebView()) {
    postStorixWebViewMessage({ type: 'CLOSE_WEBVIEW' })
    return
  }

  if (useHistory && window.history.length > 1) {
    window.history.back()
    return
  }

  window.location.assign('/')
}

/**
 * API 실패를 앱에 알린다. 인증 만료(401)는 LOGIN_REQUIRED, 그 외는 EVENT_ERROR 로 전달한다.
 */
export function reportEventError(error, message) {
  if (error?.status === 401) {
    postStorixWebViewMessage({ type: 'LOGIN_REQUIRED' })
    return
  }

  postStorixWebViewMessage({
    type: 'EVENT_ERROR',
    payload: { code: error?.code, message },
  })
}

function createRequestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * 네이티브에 요청을 보내고 같은 requestId 의 응답 메시지를 기다린다.
 * 응답은 window 'message' 이벤트(data) 또는 'STORIX_NATIVE_MESSAGE' 커스텀 이벤트(detail)로 온다.
 *
 * @param {object} options
 * @param {string} options.type            요청 메시지 type
 * @param {string} options.resultType      응답 메시지 type
 * @param {object} [options.payload]       requestId 외에 함께 보낼 payload
 * @param {string} [options.requestIdPrefix]
 * @param {number} [options.timeoutMs]
 * @param {(payload: object) => any} [options.parseResult]
 *   응답 payload 를 결과값으로 변환한다. 기본값은 success 가 아니면 실패로 처리한다.
 */
export function requestNativeAction({
  type,
  resultType,
  payload = {},
  requestIdPrefix = type.toLowerCase(),
  timeoutMs = 15000,
  parseResult,
}) {
  return new Promise((resolve, reject) => {
    const requestId = createRequestId(requestIdPrefix)

    const cleanup = () => {
      window.removeEventListener('message', handleMessage)
      window.removeEventListener('STORIX_NATIVE_MESSAGE', handleNativeMessage)
      window.clearTimeout(timeoutId)
    }

    const handleResult = (rawData) => {
      let message
      try {
        message = typeof rawData === 'string' ? JSON.parse(rawData) : rawData
      } catch {
        return // Ignore unrelated bridge messages.
      }

      if (message?.type !== resultType || message?.payload?.requestId !== requestId) {
        return
      }

      cleanup()

      try {
        if (parseResult) {
          resolve(parseResult(message.payload))
        } else if (message.payload.success) {
          resolve()
        } else {
          reject(new Error(`Native ${type} failed`))
        }
      } catch (error) {
        reject(error)
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
    }, timeoutMs)

    window.addEventListener('message', handleMessage)
    window.addEventListener('STORIX_NATIVE_MESSAGE', handleNativeMessage)

    const sent = postStorixWebViewMessage({
      type,
      payload: { requestId, ...payload },
    })

    if (!sent) {
      cleanup()
      reject(new Error('Native bridge unavailable'))
    }
  })
}
