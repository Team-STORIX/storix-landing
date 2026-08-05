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
