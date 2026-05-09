import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const INSTALL_URL = 'https://github.com/Team-STORIX'

function App() {
  return (
    <main className="landing">
      <picture className="landingPicture">
        <source srcSet="/mobile.svg" media="(max-width: 767px)" />
        <img className="landingImage" src="/pc.svg" alt="" />
      </picture>
      <a
        className="downloadHotspot"
        href={INSTALL_URL}
        aria-label="앱 다운로드하기"
      />
    </main>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
