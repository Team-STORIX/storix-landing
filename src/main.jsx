import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const LANDING_IMAGE = '/landing.png'
const IOS_INSTALL_URL = 'https://apps.apple.com/app/storix/id0000000000'
const ANDROID_INSTALL_URL =
  'https://play.google.com/store/apps/details?id=com.storix.app'

function getInstallUrl() {
  const userAgent = window.navigator.userAgent.toLowerCase()

  if (/iphone|ipad|ipod/.test(userAgent)) {
    return IOS_INSTALL_URL
  }

  return ANDROID_INSTALL_URL
}

function App() {
  return (
    <main className="landing">
      <img className="landingImage" src={LANDING_IMAGE} alt="" />
      <a className="installButton" href={getInstallUrl()}>
        {'\uC571 \uC124\uCE58\uD558\uAE30'}
      </a>
    </main>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
