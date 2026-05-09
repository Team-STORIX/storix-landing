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
      <a className="installButton" href={INSTALL_URL}>
        {'\uC571 \uB2E4\uC6B4\uB85C\uB4DC\uD558\uAE30'}
      </a>
    </main>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
