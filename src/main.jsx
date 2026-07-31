import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const IOS_DOWNLOAD_URL = 'https://apps.apple.com/kr/app/%EC%8A%A4%ED%86%A0%EB%A6%AD%EC%8A%A4-storix/id6762126035'
const ANDROID_DOWNLOAD_URL = 'https://play.google.com/store/apps/details?id=kr.storix.android'

function App() {
  return (
    <main className="landing">
      <div className="landingFrame">
        <picture className="landingPicture">
          <source srcSet="/mobile.png" media="(max-width: 767px)" />
          <img className="landingImage" src="/pc.png" alt="" />
        </picture>
        <a
          className="downloadHotspot ios"
          href={IOS_DOWNLOAD_URL}
          aria-label="iOS download"
        />
        <a
          className="downloadHotspot android"
          href={ANDROID_DOWNLOAD_URL}
          aria-label="Android download"
        />
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
